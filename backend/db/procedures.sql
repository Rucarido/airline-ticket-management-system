-- =============================================================================
-- procedures.sql — Airline Ticket Reservation System
-- Run AFTER schema.sql and seed.sql:
--   psql postgresql://admin:project@123@localhost:5432/airline_ticketing_db -f backend/db/procedures.sql
--
-- This file creates two database objects:
--   1. FUNCTION  calculate_dynamic_price()  — computes real-time ticket price
--   2. FUNCTION  fn_promote_waitlist()      — trigger function for waitlist
--   3. TRIGGER   trg_promote_waitlist       — fires automatically on cancellation
-- =============================================================================


-- =============================================================================
-- WHAT IS PL/pgSQL?
-- =============================================================================
-- PL/pgSQL is PostgreSQL's built-in procedural language.
-- Normal SQL only does one thing at a time (SELECT, INSERT, UPDATE).
-- PL/pgSQL lets you write logic: variables, IF/ELSE, loops, calculations.
-- The syntax looks like:
--
--   DECLARE
--     my_variable INT;          ← declare variables before using them
--   BEGIN
--     my_variable := 42;        ← assign with :=  (not = like in SQL)
--     RETURN my_variable;       ← functions must return something
--   END;
--
-- Everything between BEGIN and END is your logic block.
-- =============================================================================


-- Safe re-run: drop both objects if they already exist
SET client_encoding = 'UTF8';

DROP FUNCTION IF EXISTS calculate_dynamic_price(INT, seat_class) CASCADE;
DROP FUNCTION IF EXISTS fn_promote_waitlist() CASCADE;
-- Note: dropping fn_promote_waitlist() with CASCADE also drops the trigger
-- that depends on it, so we don't need to DROP TRIGGER separately.


-- =============================================================================
-- OBJECT 1: calculate_dynamic_price(p_flight_id, p_class)
-- =============================================================================
--
-- PURPOSE:
--   Called every time the flight search API runs, and again inside the booking
--   transaction to lock in the final price. It answers:
--   "What is the current price for economy/business/first on flight X?"
--
-- HOW IT WORKS (in plain English):
--   Step 1 — Count total seats for this flight+class (e.g., 96 economy seats)
--   Step 2 — Count how many of those are already reserved (e.g., 55 reserved)
--   Step 3 — Calculate occupancy %  → (55 / 96) × 100 = 57.3%
--   Step 4 — Look up pricing_rules: find the rule where threshold ≤ 57.3%
--             The highest matching threshold wins (57.3% triggers the 50% rule,
--             not the 75% or 90% rule — those thresholds haven't been crossed yet)
--   Step 5 — Calculate days until departure
--             < 3 days away → add a time urgency multiplier (×1.3)
--   Step 6 — Return: base_price × demand_multiplier × time_multiplier
--
-- PARAMETERS:
--   p_flight_id  INT        — the flight to price (e.g., 1)
--   p_class      seat_class — the cabin tier (economy / business / first)
--
-- RETURNS:  DECIMAL(10,2) — the computed price in ₹ (or whatever currency)
--
-- CALLED BY:
--   - routes/flights.js  → SELECT calculate_dynamic_price(f.flight_id, 'economy') AS economy_price
--   - routes/bookings.js → SELECT calculate_dynamic_price($1, $2) AS price  (inside transaction)
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_dynamic_price(
    p_flight_id  INT,
    p_class      seat_class
)
RETURNS DECIMAL(10, 2)
LANGUAGE plpgsql
AS $$

-- ── DECLARE: Every variable must be declared here before BEGIN ────────────────
DECLARE
    -- Seat counts
    v_total_seats   INT;       -- total seats for this flight+class
    v_booked_seats  INT;       -- how many are already reserved

    -- Calculated values
    v_occupancy_pct FLOAT;     -- occupancy as a percentage (0–100)
    v_base_price    DECIMAL(10, 2);  -- the base price from the flights table

    -- Multipliers — start at 1.0 (no change)
    v_demand_mult   FLOAT := 1.0;   -- from pricing_rules table
    v_time_mult     FLOAT := 1.0;   -- based on days until departure

    -- Time calculation
    v_days_out      FLOAT;     -- how many days until the flight departs (decimal)

-- ── BEGIN: All logic goes here ────────────────────────────────────────────────
BEGIN

    -- ── STEP 1: Get the base price from the flights table ────────────────────
    -- We SELECT INTO a variable (not a result set). This is how PL/pgSQL
    -- reads data from a table into a local variable.
    SELECT base_price
    INTO   v_base_price
    FROM   flights
    WHERE  flight_id = p_flight_id;

    -- Safety check: if no flight was found, return NULL gracefully
    IF v_base_price IS NULL THEN
        RETURN NULL;
    END IF;


    -- ── STEP 2: Count total seats for this flight+class ──────────────────────
    SELECT COUNT(*)
    INTO   v_total_seats
    FROM   seat_map
    WHERE  flight_id = p_flight_id
      AND  class     = p_class;

    -- If there are no seats defined yet (seed not run), return base price as-is
    IF v_total_seats = 0 THEN
        RETURN v_base_price;
    END IF;


    -- ── STEP 3: Count reserved seats ─────────────────────────────────────────
    SELECT COUNT(*)
    INTO   v_booked_seats
    FROM   seat_map
    WHERE  flight_id  = p_flight_id
      AND  class      = p_class
      AND  is_reserved = TRUE;


    -- ── STEP 4: Calculate occupancy percentage ───────────────────────────────
    -- Cast to FLOAT first so we get a decimal result (not integer division).
    -- Integer division: 55 / 96 = 0  ← WRONG
    -- Float division:   55::FLOAT / 96 = 0.572  ← CORRECT
    v_occupancy_pct := (v_booked_seats::FLOAT / v_total_seats::FLOAT) * 100.0;


    -- ── STEP 5: Look up the demand multiplier ────────────────────────────────
    -- Find the pricing rule for this flight+class where the threshold has
    -- been crossed. We want the HIGHEST threshold that is still ≤ occupancy.
    --
    -- Example data in pricing_rules:
    --   flight_id=1, class='economy', threshold=50, multiplier=1.2
    --   flight_id=1, class='economy', threshold=75, multiplier=1.5
    --   flight_id=1, class='economy', threshold=90, multiplier=2.0
    --
    -- At 57% occupancy:
    --   50% threshold → triggered  (57 ≥ 50) ✓
    --   75% threshold → NOT triggered (57 < 75) ✗
    --   90% threshold → NOT triggered (57 < 90) ✗
    --   Winner: the 50% rule → multiplier = 1.2
    --
    -- ORDER BY demand_threshold_pct DESC LIMIT 1 picks the highest triggered rule.
    -- The (flight_id IS NULL OR ...) part allows global default rules.
    SELECT multiplier
    INTO   v_demand_mult
    FROM   pricing_rules
    WHERE  (flight_id IS NULL OR flight_id = p_flight_id)
      AND  class                = p_class
      AND  demand_threshold_pct <= v_occupancy_pct
    ORDER BY demand_threshold_pct DESC
    LIMIT  1;

    -- If no rule found (occupancy too low, no threshold crossed), keep 1.0
    IF v_demand_mult IS NULL THEN
        v_demand_mult := 1.0;
    END IF;


    -- ── STEP 6: Calculate time-based multiplier ──────────────────────────────
    -- Flights departing very soon are priced higher (last-minute urgency).
    -- EXTRACT(EPOCH FROM ...) gives the difference in seconds; divide by 86400 for days.
    SELECT EXTRACT(EPOCH FROM (departure_time - NOW())) / 86400.0
    INTO   v_days_out
    FROM   flights
    WHERE  flight_id = p_flight_id;

    -- Time-based multiplier (simple 2-tier):
    --   < 3.0 days away → ×1.3  (short notice urgency surcharge)
    --   >= 3.0 days away → ×1.0  (no urgency surcharge)
    IF v_days_out < 3.0 THEN
        v_time_mult := 1.3;
    ELSE
        v_time_mult := 1.0;
    END IF;


    -- ── STEP 7: Return the final price ───────────────────────────────────────
    -- ROUND(..., 2) ensures we always get exactly 2 decimal places.
    -- Multiplying DECIMAL × FLOAT gives FLOAT; cast back to DECIMAL.
    RETURN ROUND((v_base_price * v_demand_mult * v_time_mult)::DECIMAL, 2);

END;
$$;


-- =============================================================================
-- OBJECT 2a: fn_promote_waitlist()
-- =============================================================================
--
-- PURPOSE:
--   This is a TRIGGER FUNCTION — a special kind of function that PostgreSQL
--   calls automatically when something happens to a table (in this case,
--   when a booking is cancelled).
--
-- TRIGGER FUNCTIONS are different from regular functions:
--   - They take NO parameters (you cannot pass arguments to them)
--   - They ALWAYS return the special type TRIGGER
--   - Inside the function, PostgreSQL gives you two automatic variables:
--       OLD  → the row's values BEFORE the UPDATE happened
--       NEW  → the row's values AFTER the UPDATE happened
--   - You must return either NEW or NULL at the end
--     (returning NULL would prevent the UPDATE — we never want that here)
--
-- HOW IT WORKS (in plain English):
--   1. Check: is this a cancellation? (NEW.status = 'cancelled' AND OLD.status = 'confirmed')
--      If not, do nothing and return NEW immediately.
--   2. Find out what class the cancelled seat was (economy/business/first)
--      by looking up OLD.seat_id in seat_map
--   3. Find the top waitlist candidate for this flight+class:
--      - Must be status = 'waiting'
--      - Order: highest priority_score first, then earliest added_at (FIFO tiebreaker)
--      - Take only the #1 candidate (LIMIT 1)
--   4. Update that candidate's waitlist status to 'pending_confirmation'
--   5. Return NEW (allow the original booking UPDATE to complete)
--
-- WHY DOUBLE COVERAGE WITH KAFKA?
--   The Kafka consumer (consumer.js) also promotes the waitlist when it reads
--   a 'booking.cancelled' event. This trigger is the SAFETY NET — it fires
--   synchronously inside the same database transaction, so promotion is
--   guaranteed even if Kafka is temporarily unavailable.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_promote_waitlist()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$

DECLARE
    v_cancelled_class  seat_class;    -- the class of the seat that was freed up
    v_top_waitlist_id  INT;           -- the waitlist_id of the passenger to promote

BEGIN

    -- ── Guard clause: only act on cancellations ───────────────────────────────
    -- OLD.status = the booking's status BEFORE this UPDATE
    -- NEW.status = the booking's status AFTER this UPDATE
    -- We only want to run when a booking goes from confirmed → cancelled.
    -- Any other status change (e.g., waitlisted → confirmed) should be ignored.
    IF NOT (OLD.status = 'confirmed' AND NEW.status = 'cancelled') THEN
        RETURN NEW;   -- do nothing, let the UPDATE proceed normally
    END IF;


    -- ── Step 1: Identify what class was freed up ──────────────────────────────
    -- OLD.seat_id is the seat_id of the booking that just got cancelled.
    -- We join to seat_map to find out if it's economy, business, or first.
    SELECT class
    INTO   v_cancelled_class
    FROM   seat_map
    WHERE  seat_id = OLD.seat_id;

    -- If we can't find the seat class for some reason, exit safely
    IF v_cancelled_class IS NULL THEN
        RETURN NEW;
    END IF;


    -- ── Step 2: Find the top waitlist candidate ───────────────────────────────
    -- Conditions:
    --   same flight as the cancelled booking (OLD.flight_id)
    --   same class that just opened up (v_cancelled_class)
    --   currently waiting (status = 'waiting')
    -- Ordering:
    --   priority_score DESC → higher priority wins (seniors, disabled, loyal)
    --   added_at ASC        → FIFO tiebreaker if two passengers have same score
    -- LIMIT 1              → only pick the single best candidate
    SELECT waitlist_id
    INTO   v_top_waitlist_id
    FROM   waitlist
    WHERE  flight_id = OLD.flight_id
      AND  class     = v_cancelled_class
      AND  status    = 'waiting'
    ORDER BY priority_score DESC, added_at ASC
    LIMIT  1;

    -- If nobody is on the waitlist for this flight+class, do nothing
    IF v_top_waitlist_id IS NULL THEN
        RETURN NEW;
    END IF;


    -- ── Step 3: Promote the top candidate ────────────────────────────────────
    -- Change their status from 'waiting' → 'pending_confirmation'
    -- In a real system you'd also set a timestamp for when they need to confirm by.
    -- The Kafka consumer (consumer.js) will send them a notification.
    UPDATE waitlist
    SET    status = 'pending_confirmation'
    WHERE  waitlist_id = v_top_waitlist_id;


    -- ── Step 4: Always return NEW ─────────────────────────────────────────────
    -- Returning NEW allows the original UPDATE on bookings to complete.
    -- If we returned NULL here, the UPDATE would be silently cancelled — BAD.
    RETURN NEW;

END;
$$;


-- =============================================================================
-- OBJECT 2b: trg_promote_waitlist  (attaches the function to the table)
-- =============================================================================
--
-- A TRIGGER is the "watcher" that attaches a trigger function to a table.
-- Without this CREATE TRIGGER statement, fn_promote_waitlist() exists but
-- is never called — it's just floating code.
--
-- Breaking down the syntax:
--
--   CREATE TRIGGER trg_promote_waitlist
--     ↑ name of the trigger (arbitrary but descriptive)
--
--   AFTER UPDATE OF status ON bookings
--     ↑ WHEN to fire: after any UPDATE that changes the 'status' column
--     ↑ on the bookings table (not any other table)
--     ↑ AFTER means the UPDATE happens first, THEN the function runs
--       (if we used BEFORE, we could prevent the UPDATE by returning NULL)
--
--   FOR EACH ROW
--     ↑ run the function once PER UPDATED ROW (not once per UPDATE statement)
--     ↑ important if you ever cancel multiple bookings in one SQL statement
--
--   EXECUTE FUNCTION fn_promote_waitlist()
--     ↑ which function to call (the one we just created above)
-- =============================================================================

CREATE TRIGGER trg_promote_waitlist
    AFTER UPDATE OF status ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION fn_promote_waitlist();


-- =============================================================================
-- VERIFICATION QUERIES
-- Run these in pgAdmin Query Tool after executing this file to confirm
-- both objects were created correctly.
-- =============================================================================

-- Check 1: Does the function exist?
--   \df calculate_dynamic_price        ← in psql
--   In pgAdmin: Schemas → public → Functions → find calculate_dynamic_price

-- Check 2: Does the trigger exist on the bookings table?
--   \dS bookings                       ← in psql (shows triggers on the table)
--   In pgAdmin: expand bookings table → Triggers → trg_promote_waitlist

-- Check 3: Does the function return a value? (will return NULL until seed.sql is run)
--   SELECT calculate_dynamic_price(1, 'economy');
--   ← Expected: NULL (no data yet) or a price once seed.sql has been run

-- =============================================================================
-- STAGE 5 TESTS — Run AFTER seed.sql to validate pricing logic
-- Copy each block into pgAdmin Query Tool one at a time.
-- =============================================================================

-- ── TEST A: Base price with no seats reserved ────────────────────────────────
-- Expected: returns the base_price from the flights table × 1.0 × time_mult
--   (if flight is 3+ days out, time_mult = 1.0 so result = base_price exactly)
--
-- SELECT calculate_dynamic_price(1, 'economy');


-- ── TEST B: Trigger 50% demand rule ─────────────────────────────────────────
-- This UPDATE simulates 50% of economy seats being booked.
-- Count economy seats for flight 1 first:
--   SELECT COUNT(*) FROM seat_map WHERE flight_id=1 AND class='economy';
-- Then reserve half of them (adjust LIMIT to be ~50% of that count):
--
-- UPDATE seat_map
-- SET    is_reserved = TRUE
-- WHERE  seat_id IN (
--     SELECT seat_id
--     FROM   seat_map
--     WHERE  flight_id    = 1
--       AND  class        = 'economy'
--       AND  is_reserved  = FALSE
--     ORDER BY seat_id
--     LIMIT  54                    ← ~50% of 108 economy seats (rows 6-20, 6 seats = 90, adjust as needed)
-- );
--
-- SELECT calculate_dynamic_price(1, 'economy');
-- Expected: base_price × 1.2 (the 50% rule)


-- ── TEST C: Reset seats ──────────────────────────────────────────────────────
--
-- UPDATE seat_map SET is_reserved = FALSE WHERE flight_id = 1;


-- ── TEST D: Trigger 75% demand rule ─────────────────────────────────────────
-- (Reserve ~75% of seats, repeat TEST B logic with a higher LIMIT)
-- Expected: base_price × 1.5


-- ── TEST E: Waitlist trigger test ────────────────────────────────────────────
-- Step 1: Insert a waitlist entry
--
-- INSERT INTO waitlist (passenger_id, flight_id, class, priority_score, status)
-- VALUES (1, 1, 'economy', 70.0, 'waiting');
--
-- Step 2: Check it's there
-- SELECT * FROM waitlist;   ← status should be 'waiting'
--
-- Step 3: Cancel a confirmed booking on flight 1
-- UPDATE bookings SET status = 'cancelled' WHERE booking_id = 1;
--
-- Step 4: Check waitlist again — trigger should have fired
-- SELECT * FROM waitlist;   ← status should now be 'pending_confirmation'
