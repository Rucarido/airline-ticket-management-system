-- =============================================================================
-- schema.sql — Airline Ticket Reservation System
-- Run with:
--   psql postgresql://<username>:<password>@localhost:5432/airline_ticketing_db -f backend/db/schema.sql
--
-- Order matters: tables that are referenced by FK must exist first.
-- Drop order is reverse of create order.
-- =============================================================================


-- =============================================================================
-- SECTION 0: CLEAN SLATE
-- Drop everything in reverse dependency order so you can re-run this file
-- cleanly during development without manual cleanup.
-- =============================================================================

DROP TABLE IF EXISTS waitlist       CASCADE;
DROP TABLE IF EXISTS bookings       CASCADE;
DROP TABLE IF EXISTS pricing_rules  CASCADE;
DROP TABLE IF EXISTS seat_map       CASCADE;
DROP TABLE IF EXISTS passengers     CASCADE;
DROP TABLE IF EXISTS flights        CASCADE;
DROP TABLE IF EXISTS airports       CASCADE;

-- Drop custom types too (CASCADE handles dependent columns)
DROP TYPE IF EXISTS booking_status  CASCADE;
DROP TYPE IF EXISTS waitlist_status CASCADE;
DROP TYPE IF EXISTS seat_class      CASCADE;
DROP TYPE IF EXISTS loyalty_tier    CASCADE;
DROP TYPE IF EXISTS flight_status   CASCADE;


-- =============================================================================
-- SECTION 1: ENUM TYPES
-- Enums enforce a fixed set of allowed values at the DB level — stricter than
-- a VARCHAR with a CHECK constraint because they're named types the whole
-- schema can reuse, and PostgreSQL validates them on INSERT/UPDATE.
-- =============================================================================

-- Flight lifecycle states
CREATE TYPE flight_status AS ENUM ('scheduled', 'boarding', 'departed', 'arrived', 'cancelled');

-- Seat class — the three cabin tiers
CREATE TYPE seat_class AS ENUM ('economy', 'business', 'first');

-- Loyalty program membership
CREATE TYPE loyalty_tier AS ENUM ('none', 'silver', 'gold');

-- Booking lifecycle
CREATE TYPE booking_status AS ENUM ('confirmed', 'cancelled', 'waitlisted');

-- Waitlist slot lifecycle
CREATE TYPE waitlist_status AS ENUM ('waiting', 'pending_confirmation', 'expired');


-- =============================================================================
-- TABLE 1: airports
--
-- Stores IATA airport codes. Every flight references this table TWICE
-- (once for origin, once for destination), so it must exist first.
--
-- Why iata_code as PK instead of a surrogate SERIAL?
--   IATA codes are already globally unique 3-letter identifiers (BOM, DEL, etc.)
--   Using them as the PK means the FK in flights is human-readable:
--   "origin = 'BOM'" is immediately understandable; "origin_id = 7" is not.
--   This is called a "natural key" — appropriate when the natural identifier
--   is stable, short, and universally meaningful.
-- =============================================================================

CREATE TABLE airports (
    iata_code   CHAR(3)      PRIMARY KEY,        -- e.g. 'BOM', 'DEL', 'SIN'
    city        VARCHAR(100) NOT NULL,
    country     VARCHAR(100) NOT NULL
);


-- =============================================================================
-- TABLE 2: flights
--
-- Core schedule table. Each row is one flight departure.
--
-- Column choices:
--   origin / destination  — named to match IATA convention and the project spec.
--     They reference airports(iata_code) which means you can write:
--     WHERE origin = 'BOM' AND destination = 'DEL' — readable SQL.
--
--   base_price            — the floor price before dynamic pricing multipliers.
--     The stored procedure calculate_dynamic_price() reads this and applies
--     demand + time multipliers on top of it. We never store the dynamic price
--     in this table because it changes constantly — we compute it on demand.
--
--   total_seats           — fixed capacity of the aircraft. 120 by default
--     (matches the 20 rows × 6 seats per row in our seat_map seed).
--     We do NOT store available_seats here — see explanation below.
--
-- Why NOT store available_seats in flights?
--   Your draft had available_seats as a column. This creates a "dual write"
--   problem: every time you INSERT a booking or mark a seat reserved in
--   seat_map, you'd also need to UPDATE flights.available_seats in the same
--   transaction. If one write succeeds and the other fails, the data is
--   inconsistent. The correct approach is to DERIVE available seat count
--   from seat_map at query time:
--     COUNT(*) FILTER (WHERE is_reserved = FALSE AND class = 'economy')
--   This is what the flight search query does — one join gives you live counts.
--
-- Index on (origin, destination, departure_time):
--   The most common query in the system is "find flights from X to Y on date D".
--   Without an index PostgreSQL does a full sequential scan of all flights.
--   With this composite index it jumps directly to matching rows (index scan).
--   The EXPLAIN ANALYZE demo in Stage 5 proves this difference.
-- =============================================================================

CREATE TABLE flights (
    flight_id       SERIAL          PRIMARY KEY,
    flight_number   VARCHAR(10)     NOT NULL,
    origin          CHAR(3)         NOT NULL REFERENCES airports(iata_code)
                                        ON DELETE RESTRICT
                                        ON UPDATE CASCADE,
    destination     CHAR(3)         NOT NULL REFERENCES airports(iata_code)
                                        ON DELETE RESTRICT
                                        ON UPDATE CASCADE,
    departure_time  TIMESTAMPTZ     NOT NULL,
    arrival_time    TIMESTAMPTZ     NOT NULL,
    base_price      DECIMAL(10, 2)  NOT NULL,
    total_seats     INT             NOT NULL DEFAULT 120,
    status          flight_status   NOT NULL DEFAULT 'scheduled',

    -- A flight cannot depart from and arrive at the same airport
    CONSTRAINT chk_flights_different_airports CHECK (origin <> destination),

    -- Arrival must be strictly after departure
    CONSTRAINT chk_flights_valid_times CHECK (arrival_time > departure_time),

    -- Price must be a positive amount
    CONSTRAINT chk_flights_positive_price CHECK (base_price > 0),

    -- Total seats must be a realistic positive number
    CONSTRAINT chk_flights_positive_seats CHECK (total_seats > 0),

    -- No duplicate flight numbers departing from the same place at the same moment
    CONSTRAINT uq_flights_number_origin_departure UNIQUE (flight_number, origin, departure_time)
);

-- THE key index — makes flight search (the most frequent query) fast.
-- Composite because all three columns appear together in the WHERE clause.
CREATE INDEX idx_flights_route ON flights (origin, destination, departure_time);


-- =============================================================================
-- TABLE 3: seat_map
--
-- One row per physical seat on a specific flight.
-- For 5 flights × 20 rows × 6 seats = 600 rows total after seeding.
--
-- is_reserved vs Redis hold:
--   is_reserved = TRUE  →  permanent. Set inside an ACID transaction at booking.
--   Redis hold:hold:{id} →  temporary, 10-minute TTL. Set before the transaction.
--   The seat map API returns BOTH: is_reserved (from this table) and is_held
--   (derived from Redis MGET). A seat is only truly booked when is_reserved = TRUE.
--
-- Why store is_aisle, is_window, is_exit_row?
--   These drive the priority seating recommendation logic.
--   Seniors (age ≥ 65) and passengers with accessibility needs get recommended
--   aisle seats. Exit rows are NEVER recommended for them (aviation regulation:
--   only able-bodied adults may occupy exit rows). These booleans make that
--   filter a simple WHERE clause.
--
-- The UNIQUE constraint on (flight_id, row_num, seat_letter):
--   Prevents inserting duplicate seats. The seed DO block loops over all
--   flights, rows, and letters — this constraint is the safety net.
-- =============================================================================

CREATE TABLE seat_map (
    seat_id         SERIAL          PRIMARY KEY,
    flight_id       INT             NOT NULL REFERENCES flights(flight_id)
                                        ON DELETE CASCADE,
    row_num         INT             NOT NULL,
    seat_letter     CHAR(1)         NOT NULL,
    class           seat_class      NOT NULL,
    is_aisle        BOOLEAN         NOT NULL DEFAULT FALSE,
    is_window       BOOLEAN         NOT NULL DEFAULT FALSE,
    is_exit_row     BOOLEAN         NOT NULL DEFAULT FALSE,
    is_reserved     BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Physical seat identity is unique within a flight
    CONSTRAINT uq_seat_position UNIQUE (flight_id, row_num, seat_letter)
);

-- Index makes the seat-map query fast: "give me all seats for flight 1
-- in economy class that are not yet reserved". All three columns in WHERE.
CREATE INDEX idx_seat_flight_class ON seat_map (flight_id, class, is_reserved);


-- =============================================================================
-- TABLE 4: passengers
--
-- User accounts. Stores credentials and profile data.
--
-- password_hash: we NEVER store plaintext passwords. bcryptjs hashes the
--   password before INSERT. The hash is a fixed 60-char string starting with "$2b$".
--
-- dob (date of birth): used to calculate age at booking time for priority scoring.
--   Age ≥ 65 → +40 priority points; age ≤ 5 → +35 points.
--
-- accessibility: simple boolean flag. TRUE → +30 priority points.
--   A production system would have more detail; for this project a flag suffices.
--
-- loyalty_tier: drives priority score (+15 for gold, +8 for silver) and could
--   also drive discount logic in future.
-- =============================================================================

CREATE TABLE passengers (
    passenger_id    SERIAL          PRIMARY KEY,
    full_name       VARCHAR(100)    NOT NULL,
    email           VARCHAR(150)    NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,
    dob             DATE            NOT NULL,
    passport_num    VARCHAR(20),                 -- optional for MVP demo
    loyalty_tier    loyalty_tier    NOT NULL DEFAULT 'none',
    accessibility   BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Email must be unique — it's the login identifier
    CONSTRAINT uq_passengers_email UNIQUE (email)
);


-- =============================================================================
-- TABLE 5: bookings
--
-- Confirmed (or cancelled/waitlisted) reservations.
-- One booking = one passenger, one flight, one seat.
--
-- booking_ref (PNR): the 6-character alphanumeric code shown to the user.
--   Generated in the backend (not in SQL) and must be globally unique.
--
-- price_snapshot JSONB:
--   At booking time, we capture a JSON object with the price breakdown:
--   { "price": 4200, "class": "economy", "multiplier": 1.2, "locked_at": "..." }
--   WHY? Because base_price in flights can change, pricing_rules can change,
--   but a confirmed booking's price must never change retroactively. This JSONB
--   column is the immutable record of exactly what the passenger was shown and
--   agreed to pay. It also serves as an audit trail.
--
-- final_price DECIMAL: the actual price paid. Redundant with price_snapshot
--   but kept as a proper numeric column for SQL aggregations (SUM, AVG, etc.)
--   without needing to parse JSON.
--
-- The trigger trg_promote_waitlist fires AFTER UPDATE OF status ON this table.
-- When status changes 'confirmed' → 'cancelled', the trigger runs
-- fn_promote_waitlist() which finds the top waitlist candidate and promotes them.
-- =============================================================================

CREATE TABLE bookings (
    booking_id      SERIAL          PRIMARY KEY,
    passenger_id    INT             NOT NULL REFERENCES passengers(passenger_id)
                                        ON DELETE RESTRICT,
    flight_id       INT             NOT NULL REFERENCES flights(flight_id)
                                        ON DELETE RESTRICT,
    seat_id         INT             NOT NULL REFERENCES seat_map(seat_id)
                                        ON DELETE RESTRICT,
    booking_ref     VARCHAR(6)      NOT NULL,
    status          booking_status  NOT NULL DEFAULT 'confirmed',
    final_price     DECIMAL(10, 2)  NOT NULL,
    price_snapshot  JSONB           NOT NULL,    -- immutable price record at booking time
    booked_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- PNR must be globally unique
    CONSTRAINT uq_bookings_ref UNIQUE (booking_ref),

    -- A seat can only have ONE confirmed booking at a time
    -- (cancelled ones are kept for history, so we only restrict 'confirmed')
    CONSTRAINT uq_bookings_seat_confirmed UNIQUE (seat_id, status)
);


-- =============================================================================
-- TABLE 6: pricing_rules
--
-- Data that drives the calculate_dynamic_price() stored procedure.
-- Keeping rules in a table (not hardcoded in the function) means you can
-- change pricing strategy by updating rows — no code change required.
--
-- How it works:
--   When occupancy % for a flight+class crosses demand_threshold_pct,
--   the multiplier is applied to base_price.
--   Example rows for flight 1, economy:
--     (50.0, 1.2) → when 50%+ seats are taken, price = base × 1.2 (20% up)
--     (75.0, 1.5) → when 75%+ seats are taken, price = base × 1.5 (50% up)
--     (90.0, 2.0) → when 90%+ seats are taken, price = base × 2.0 (doubled)
--   The stored procedure picks the HIGHEST threshold that is ≤ current occupancy.
--
-- flight_id can be NULL to define a global default rule that applies to
-- all flights not covered by a specific rule.
-- =============================================================================

CREATE TABLE pricing_rules (
    rule_id                 SERIAL          PRIMARY KEY,
    flight_id               INT             REFERENCES flights(flight_id)
                                                ON DELETE CASCADE,   -- NULL = global rule
    class                   seat_class      NOT NULL,
    demand_threshold_pct    FLOAT           NOT NULL
                                                CHECK (demand_threshold_pct > 0
                                                   AND demand_threshold_pct <= 100),
    multiplier              FLOAT           NOT NULL
                                                CHECK (multiplier >= 1.0)  -- never discount
);


-- =============================================================================
-- TABLE 7: waitlist
--
-- Queue of passengers who want a seat on a full flight.
-- When a booking is cancelled, the DB trigger promotes the top entry.
--
-- priority_score: calculated from passenger DOB, accessibility, loyalty tier.
--   The passenger with the HIGHEST score + EARLIEST added_at wins the slot.
--   This is computed in the backend (calcPriority()) and stored here so the
--   DB trigger can ORDER BY it without needing to recalculate.
--
-- status lifecycle:
--   'waiting'               → actively queued
--   'pending_confirmation'  → promoted by trigger; passenger has limited time to confirm
--   'expired'               → window passed, not promoted further
-- =============================================================================

CREATE TABLE waitlist (
    waitlist_id     SERIAL          PRIMARY KEY,
    passenger_id    INT             NOT NULL REFERENCES passengers(passenger_id)
                                        ON DELETE CASCADE,
    flight_id       INT             NOT NULL REFERENCES flights(flight_id)
                                        ON DELETE CASCADE,
    class           seat_class      NOT NULL,
    priority_score  FLOAT           NOT NULL DEFAULT 0,
    status          waitlist_status NOT NULL DEFAULT 'waiting',
    added_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- A passenger can only be on the waitlist ONCE per flight+class
    CONSTRAINT uq_waitlist_passenger_flight_class UNIQUE (passenger_id, flight_id, class)
);


-- =============================================================================
-- VERIFICATION QUERIES (run these in pgAdmin Query Tool after executing this file)
-- =============================================================================
--
-- \dt                          → should list all 7 tables
-- \di                          → should list idx_flights_route + idx_seat_flight_class
-- \dT                          → should list all 5 custom ENUM types
-- SELECT * FROM airports;      → empty (seed.sql not run yet)
--
-- Or in pgAdmin:
--   Left panel → Databases → airline_ticketing_db → Schemas → public → Tables
--   You should see: airports, flights, seat_map, passengers, bookings,
--                   pricing_rules, waitlist
--
-- =============================================================================