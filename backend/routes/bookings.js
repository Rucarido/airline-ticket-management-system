// =============================================================================
// routes/bookings.js — ACID Booking Transactions & Cancellations
// =============================================================================
// Implements:
//   1. POST  /api/bookings          — Full SERIALIZABLE ACID booking transaction
//   2. GET   /api/bookings/mine     — View all bookings for the logged-in passenger
//   3. PATCH /api/bookings/:id/cancel — Cancel booking, release seat, fire waitlist trigger
// =============================================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../db');
const redis = require('../redis');
const { publishEvent } = require('../kafka');
const { verify } = require('./auth');

/**
 * Generates a clean 6-character booking reference (PNR)
 * Example: 'BK7A9F'
 */
function generatePNR() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit ambiguous characters (0, O, 1, I)
  let pnr = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    pnr += chars[bytes[i] % chars.length];
  }
  return pnr;
}

/**
 * POST /api/bookings
 * Body: { "flightId": 1, "seatId": 42 }
 * Requires JWT Authentication.
 *
 * THE ACID BOOKING TRANSACTION:
 *   1. Verify passenger currently holds the seat in Redis
 *   2. Borrow dedicated PostgreSQL client from the pool
 *   3. BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE
 *   4. SELECT seat_id ... FOR UPDATE (pessimistic row lock)
 *   5. Call calculate_dynamic_price() to lock immutable price
 *   6. UPDATE seat_map SET is_reserved = TRUE
 *   7. INSERT INTO bookings (with price_snapshot JSONB)
 *   8. COMMIT
 *   9. Release Redis hold
 *  10. Publish 'booking.created' event to Kafka topic 'bookings'
 *  11. If serialization collision occurs (code 40001), return 409
 *  12. client.release() in finally block ALWAYS
 */
router.post('/', verify, async (req, res, next) => {
  const { flightId, seatId } = req.body;
  const passengerId = req.user.passenger_id;

  if (!flightId || !seatId) {
    return res.status(400).json({ error: 'flightId and seatId are required.' });
  }

  // ── STEP 1: Verify Redis hold ─────────────────────────────────────────────
  const holdKey = `hold:${seatId}`;
  const currentHold = await redis.get(holdKey);

  if (!currentHold) {
    return res.status(409).json({
      error: 'You do not have an active hold on this seat, or your 10-minute hold has expired. Please select the seat again.',
    });
  }

  const heldByPassengerId = currentHold.split(':')[0];
  if (heldByPassengerId !== String(passengerId)) {
    return res.status(403).json({
      error: 'This seat is held by another user. You cannot book it.',
    });
  }

  // ── STEP 2: Dedicated DB client for ACID transaction ───────────────────────
  const client = await db.pool.connect();

  try {
    // ── STEP 3: BEGIN SERIALIZABLE TRANSACTION ──────────────────────────────
    // SERIALIZABLE is the highest SQL isolation level: guarantees full serializability
    // as if transactions ran sequentially one after another.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // ── STEP 4: Pessimistic Row Lock (SELECT FOR UPDATE) ────────────────────
    // Locks the seat row exclusively so no other transaction can read or modify it
    // until this transaction commits or rolls back.
    const seatCheck = await client.query(
      `SELECT seat_id, flight_id, class, is_reserved
       FROM seat_map
       WHERE seat_id = $1 AND flight_id = $2
       FOR UPDATE`,
      [seatId, flightId]
    );

    if (seatCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Seat not found on the specified flight.' });
    }

    const seat = seatCheck.rows[0];
    if (seat.is_reserved) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Seat has already been reserved by another passenger.',
      });
    }

    // ── STEP 5: Compute final dynamic price inside transaction ──────────────
    const priceRes = await client.query(
      `SELECT calculate_dynamic_price($1, $2::seat_class) AS price`,
      [flightId, seat.class]
    );

    const finalPrice = priceRes.rows[0].price;

    // Fetch base price to construct the immutable audit price snapshot
    const flightInfo = await client.query(
      'SELECT base_price FROM flights WHERE flight_id = $1',
      [flightId]
    );
    const basePrice = flightInfo.rows[0]?.base_price || finalPrice;

    const priceSnapshot = {
      base_price: parseFloat(basePrice),
      final_price: parseFloat(finalPrice),
      cabin_class: seat.class,
      timestamp: new Date().toISOString(),
    };

    // Generate unique 6-character PNR
    const pnr = generatePNR();

    // ── STEP 6: Mark seat as permanently reserved ───────────────────────────
    await client.query(
      `UPDATE seat_map
       SET is_reserved = TRUE
       WHERE seat_id = $1`,
      [seatId]
    );

    // ── STEP 7: Insert confirmed booking ────────────────────────────────────
    const insertBookingSql = `
      INSERT INTO bookings (
        passenger_id, flight_id, seat_id,
        booking_ref, status, final_price,
        price_snapshot, booked_at
      )
      VALUES ($1, $2, $3, $4, 'confirmed', $5, $6::jsonb, NOW())
      RETURNING *;
    `;

    const bookingRes = await client.query(insertBookingSql, [
      passengerId,
      flightId,
      seatId,
      pnr,
      finalPrice,
      JSON.stringify(priceSnapshot),
    ]);

    const booking = bookingRes.rows[0];

    // ── STEP 8: COMMIT TRANSACTION ──────────────────────────────────────────
    await client.query('COMMIT');

    // ── STEP 9: Remove temporary Redis hold ──────────────────────────────────
    await redis.del(holdKey);

    // ── STEP 10: Publish event to Kafka ─────────────────────────────────────
    await publishEvent('bookings', {
      type: 'booking.created',
      bookingId: booking.booking_id,
      pnr: booking.booking_ref,
      passengerId,
      flightId,
      seatId,
      price: finalPrice,
      class: seat.class,
      createdAt: booking.booked_at,
    });

    // ── STEP 11: Return response ────────────────────────────────────────────
    return res.status(201).json({
      message: 'Booking confirmed successfully!',
      pnr: booking.booking_ref,
      booking,
    });
  } catch (err) {
    // Rollback any uncommitted changes on failure
    await client.query('ROLLBACK').catch(() => {});

    // PostgreSQL serialization failure (code 40001) occurs when concurrent
    // transactions conflict under SERIALIZABLE isolation.
    if (err.code === '40001') {
      return res.status(409).json({
        error: 'Concurrency conflict: this seat was booked simultaneously by another transaction. Please try again.',
        code: 'SERIALIZATION_FAILURE',
      });
    }

    next(err);
  } finally {
    // ALWAYS release the client back to the connection pool
    client.release();
  }
});

/**
 * GET /api/bookings/mine
 * Returns all past and active bookings for the logged-in passenger.
 */
router.get('/mine', verify, async (req, res, next) => {
  try {
    const passengerId = req.user.passenger_id;

    const sql = `
      SELECT
        b.booking_id,
        b.booking_ref,
        b.status,
        b.final_price,
        b.price_snapshot,
        b.booked_at,
        f.flight_id,
        f.flight_number,
        f.origin,
        orig.city AS origin_city,
        f.destination,
        dest.city AS destination_city,
        f.departure_time,
        f.arrival_time,
        s.seat_id,
        s.row_num,
        s.seat_letter,
        s.class AS seat_class
      FROM bookings b
      JOIN flights f ON b.flight_id = f.flight_id
      JOIN airports orig ON f.origin = orig.iata_code
      JOIN airports dest ON f.destination = dest.iata_code
      JOIN seat_map s ON b.seat_id = s.seat_id
      WHERE b.passenger_id = $1
      ORDER BY b.booked_at DESC;
    `;

    const result = await db.query(sql, [passengerId]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/bookings/:id/cancel
 * Cancels a confirmed booking.
 *
 * WHAT THIS DEMONSTRATES:
 *   1. Updates booking status to 'cancelled'
 *   2. PostgreSQL trigger `trg_promote_waitlist` automatically fires in the DB
 *      and promotes the top waitlisted passenger to 'pending_confirmation'!
 *   3. Frees the seat in seat_map (is_reserved = FALSE)
 *   4. Publishes a cancellation event to Kafka topic 'cancellations'
 */
router.patch('/:id/cancel', verify, async (req, res, next) => {
  const bookingId = parseInt(req.params.id, 10);
  const passengerId = req.user.passenger_id;

  if (isNaN(bookingId)) {
    return res.status(400).json({ error: 'Invalid booking ID' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify booking ownership and status
    const bookingRes = await client.query(
      `SELECT booking_id, flight_id, seat_id, status
       FROM bookings
       WHERE booking_id = $1 AND passenger_id = $2
       FOR UPDATE`,
      [bookingId, passengerId]
    );

    if (bookingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found or not owned by you.' });
    }

    const booking = bookingRes.rows[0];
    if (booking.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This booking is already cancelled.' });
    }

    // 2. Cancel the booking
    // NOTE: This UPDATE triggers PostgreSQL trigger `trg_promote_waitlist`!
    await client.query(
      `UPDATE bookings
       SET status = 'cancelled'
       WHERE booking_id = $1`,
      [bookingId]
    );

    // 3. Mark the seat as available again in PostgreSQL
    await client.query(
      `UPDATE seat_map
       SET is_reserved = FALSE
       WHERE seat_id = $1`,
      [booking.seat_id]
    );

    // 4. Query if any waitlisted passenger was promoted by the trigger
    const promotedRes = await client.query(
      `SELECT waitlist_id, passenger_id, flight_id, status
       FROM waitlist
       WHERE flight_id = $1 AND status = 'pending_confirmation'
       ORDER BY added_at DESC
       LIMIT 1`,
      [booking.flight_id]
    );

    await client.query('COMMIT');

    const promotedUser = promotedRes.rows[0] || null;

    // 5. Publish Kafka cancellation event
    await publishEvent('cancellations', {
      type: 'booking.cancelled',
      bookingId,
      flightId: booking.flight_id,
      seatId: booking.seat_id,
      cancelledAt: new Date().toISOString(),
      promotedWaitlist: promotedUser,
    });

    res.json({
      message: 'Booking cancelled successfully. Seat has been released.',
      booking_id: bookingId,
      waitlist_promoted: promotedUser,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
