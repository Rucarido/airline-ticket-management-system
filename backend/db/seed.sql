-- =============================================================================
-- seed.sql — Airline Ticket Reservation System
-- Run AFTER schema.sql:
--   psql postgresql://admin:project@123@localhost:5432/airline_ticketing_db -f backend/db/seed.sql
--
-- This file populates the database with realistic sample data:
--   1. 6 Airports (Domestic Indian hubs + International hubs)
--   2. 5 Scheduled Flights (spanning 1 to 10 days in the future)
--   3. Dynamic Pricing Rules (50%, 75%, 90% occupancy tiers per flight & class)
--   4. Seat Map (120 physical seats for each of the 5 flights = 600 seats)
--   5. Sample Passengers (Regular, Senior >65, Accessibility, Child, Loyalty tiers)
--      All sample passengers have password: Password123!
--   6. Initial Booking & Waitlist entries for immediate trigger & verification tests
-- =============================================================================

-- Clear existing data in reverse dependency order before seeding
TRUNCATE TABLE waitlist, bookings, pricing_rules, seat_map, passengers, flights, airports RESTART IDENTITY CASCADE;


-- =============================================================================
-- SECTION 1: AIRPORTS
-- =============================================================================
-- Using real 3-letter IATA codes as natural primary keys.

INSERT INTO airports (iata_code, city, country) VALUES
    ('BOM', 'Mumbai', 'India'),
    ('DEL', 'New Delhi', 'India'),
    ('BLR', 'Bengaluru', 'India'),
    ('HYD', 'Hyderabad', 'India'),
    ('DXB', 'Dubai', 'United Arab Emirates'),
    ('SIN', 'Singapore', 'Singapore');


-- =============================================================================
-- SECTION 2: FLIGHTS
-- =============================================================================
-- Departure and arrival times use dynamic intervals relative to NOW()
-- so that time-to-departure calculations always work reliably regardless
-- of when you execute this script.

INSERT INTO flights (
    flight_id, flight_number, origin, destination,
    departure_time, arrival_time, base_price, total_seats, status
) VALUES
    -- Flight 1: BOM -> DEL (3.5 days out — baseline price testing without urgency)
    (1, 'AI-101', 'BOM', 'DEL',
     NOW() + INTERVAL '3 days 12 hours',
     NOW() + INTERVAL '3 days 14 hours 15 minutes',
     4200.00, 120, 'scheduled'),

    -- Flight 2: DEL -> BLR (5 days out)
    (2, '6E-205', 'DEL', 'BLR',
     NOW() + INTERVAL '5 days',
     NOW() + INTERVAL '5 days 2 hours 45 minutes',
     4800.00, 120, 'scheduled'),

    -- Flight 3: BLR -> HYD (1.5 days out — triggers < 3 days time multiplier 1.3)
    (3, 'UK-812', 'BLR', 'HYD',
     NOW() + INTERVAL '1 day 12 hours',
     NOW() + INTERVAL '1 day 13 hours 15 minutes',
     3100.00, 120, 'scheduled'),

    -- Flight 4: BOM -> DXB (International, 7 days out)
    (4, 'EK-501', 'BOM', 'DXB',
     NOW() + INTERVAL '7 days',
     NOW() + INTERVAL '7 days 3 hours 30 minutes',
     14500.00, 120, 'scheduled'),

    -- Flight 5: DEL -> SIN (International, 10 days out)
    (5, 'SQ-403', 'DEL', 'SIN',
     NOW() + INTERVAL '10 days',
     NOW() + INTERVAL '10 days 5 hours 30 minutes',
     22000.00, 120, 'scheduled');

-- Reset the flight_id sequence to continue after 5
ALTER SEQUENCE flights_flight_id_seq RESTART WITH 6;


-- =============================================================================
-- SECTION 3: PRICING RULES
-- =============================================================================
-- Each flight and class has 3 demand tiers:
--   When occupancy >= 50% -> 1.2x price
--   When occupancy >= 75% -> 1.5x price
--   When occupancy >= 90% -> 2.0x price

INSERT INTO pricing_rules (flight_id, class, demand_threshold_pct, multiplier)
SELECT
    f.flight_id,
    c.cabin_class,
    t.threshold,
    t.multiplier
FROM
    flights f
CROSS JOIN
    (VALUES ('economy'::seat_class), ('business'::seat_class), ('first'::seat_class)) AS c(cabin_class)
CROSS JOIN
    (VALUES
        (50.0, 1.20),
        (75.0, 1.50),
        (90.0, 2.00)
    ) AS t(threshold, multiplier);


-- =============================================================================
-- SECTION 4: SEAT MAP (PL/pgSQL DO Block)
-- =============================================================================
-- Standard narrow-body aircraft layout: 20 rows × 6 seats (A to F) = 120 seats.
-- Generated for all 5 flights = 600 total seats.
--
-- Layout logic:
--   Rows 1-2   : 'first' class (12 seats)
--   Rows 3-5   : 'business' class (18 seats)
--   Rows 6-20  : 'economy' class (90 seats)
--   Columns A,F: Window seats
--   Columns C,D: Aisle seats
--   Columns B,E: Middle seats
--   Row 10     : Emergency exit row (is_exit_row = TRUE)

DO $$
DECLARE
    f_id      INT;
    r         INT;
    letter    CHAR(1);
    letters   CHAR(1)[] := ARRAY['A', 'B', 'C', 'D', 'E', 'F'];
    s_class   seat_class;
    is_aisle  BOOLEAN;
    is_win    BOOLEAN;
    is_exit   BOOLEAN;
BEGIN
    FOR f_id IN 1..5 LOOP
        FOR r IN 1..20 LOOP

            -- Assign cabin class based on row number
            IF r <= 2 THEN
                s_class := 'first';
            ELSIF r <= 5 THEN
                s_class := 'business';
            ELSE
                s_class := 'economy';
            END IF;

            -- Row 10 is the emergency exit row
            is_exit := (r = 10);

            -- Loop through each column letter A through F
            FOREACH letter IN ARRAY letters LOOP
                is_win   := (letter = 'A' OR letter = 'F');
                is_aisle := (letter = 'C' OR letter = 'D');

                INSERT INTO seat_map (
                    flight_id,
                    row_num,
                    seat_letter,
                    class,
                    is_aisle,
                    is_window,
                    is_exit_row,
                    is_reserved
                ) VALUES (
                    f_id,
                    r,
                    letter,
                    s_class,
                    is_aisle,
                    is_win,
                    is_exit,
                    FALSE
                );
            END LOOP;
        END LOOP;
    END LOOP;
END $$;


-- =============================================================================
-- SECTION 5: SAMPLE PASSENGERS
-- =============================================================================
-- All passwords are hashed with bcrypt (salt rounds = 10) for 'Password123!'
-- Hash: $2b$10$z9wDGgANbvQJmrZIivjv.e9.dMWmfKH7JGLXkT14rvlfuRUPkd/9S
--
-- Test personas for Priority Seating algorithm:
--   1. Rahul Sharma   - Regular adult (Score: 0)
--   2. Shanti Patel   - Senior >65 + Silver tier (Score: 40 + 8 = 48 -> Recommended aisle)
--   3. Arjun Mehta    - Accessibility + Gold tier (Score: 30 + 15 = 45 -> Recommended aisle)
--   4. Anya Kapoor    - Toddler <=5 (Score: 35)

INSERT INTO passengers (
    passenger_id, full_name, email, password_hash,
    dob, passport_num, loyalty_tier, accessibility
) VALUES
    (1, 'Rahul Sharma', 'rahul@example.com',
     '$2b$10$z9wDGgANbvQJmrZIivjv.e9.dMWmfKH7JGLXkT14rvlfuRUPkd/9S',
     '1995-06-15', 'N1234567', 'none', FALSE),

    (2, 'Shanti Patel', 'shanti@example.com',
     '$2b$10$z9wDGgANbvQJmrZIivjv.e9.dMWmfKH7JGLXkT14rvlfuRUPkd/9S',
     '1954-08-20', 'P9876543', 'silver', FALSE),

    (3, 'Arjun Mehta', 'arjun@example.com',
     '$2b$10$z9wDGgANbvQJmrZIivjv.e9.dMWmfKH7JGLXkT14rvlfuRUPkd/9S',
     '1989-12-10', 'A5544332', 'gold', TRUE),

    (4, 'Anya Kapoor', 'anya@example.com',
     '$2b$10$z9wDGgANbvQJmrZIivjv.e9.dMWmfKH7JGLXkT14rvlfuRUPkd/9S',
     '2023-01-01', 'K1122334', 'none', FALSE);

ALTER SEQUENCE passengers_passenger_id_seq RESTART WITH 5;


-- =============================================================================
-- SECTION 6: INITIAL BOOKING & WAITLIST SAMPLES
-- =============================================================================
-- Create 1 sample confirmed booking on Flight 1 (Seat row 6, letter C -> 6C, economy)
-- This allows testing cancellation and waitlist promotion immediately.

-- Reserve seat 6C on Flight 1
UPDATE seat_map
SET    is_reserved = TRUE
WHERE  flight_id = 1 AND row_num = 6 AND seat_letter = 'C';

-- Insert the matching confirmed booking
INSERT INTO bookings (
    booking_id,
    passenger_id,
    flight_id,
    seat_id,
    booking_ref,
    status,
    final_price,
    price_snapshot,
    booked_at
)
SELECT
    1,
    1,
    1,
    s.seat_id,
    'PNR101',
    'confirmed',
    4200.00,
    '{"base_price": 4200.00, "demand_mult": 1.0, "time_mult": 1.0, "final_price": 4200.00}'::jsonb,
    NOW() - INTERVAL '1 hour'
FROM seat_map s
WHERE s.flight_id = 1 AND s.row_num = 6 AND s.seat_letter = 'C';

ALTER SEQUENCE bookings_booking_id_seq RESTART WITH 2;

-- Insert a waitlisted passenger for Flight 1 (Senior passenger Shanti, priority_score = 48.0)
-- When Booking 1 is cancelled, trigger `trg_promote_waitlist` will promote this to 'pending_confirmation'!
INSERT INTO waitlist (
    waitlist_id,
    passenger_id,
    flight_id,
    class,
    priority_score,
    status,
    added_at
) VALUES (
    1,
    2,
    1,
    'economy',
    48.0,
    'waiting',
    NOW() - INTERVAL '30 minutes'
);

ALTER SEQUENCE waitlist_waitlist_id_seq RESTART WITH 2;
