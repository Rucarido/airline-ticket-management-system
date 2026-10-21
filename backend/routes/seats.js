// =============================================================================
// routes/seats.js — Seat Map, Temporary Holds, and Priority Seating
// =============================================================================
// Provides:
//   1. GET    /api/seats/:flightId   — returns all 120 seats with hold & recommendation status
//   2. POST   /api/seats/hold        — places an atomic 10-minute Redis hold (SET NX)
//   3. DELETE /api/seats/hold/:seatId — releases the hold manually
// =============================================================================

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const db = require('../db');
const redis = require('../redis');
const { publishEvent } = require('../kafka');
const { verify } = require('./auth');

const JWT_SECRET = process.env.JWT_SECRET || 'airline-super-secret-jwt-key-change-in-production';

/**
 * Helper: extracts user from Authorization header without rejecting if absent.
 * Used by GET /api/seats/:flightId so guests can view the map, while logged-in
 * passengers get personalized seating recommendations based on age & accessibility.
 */
function optionalAuth(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split(' ')[1];
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Helper: calculates passenger priority score.
 * Formula:
 *   Age >= 65         -> +40
 *   Age <= 5          -> +35
 *   Accessibility     -> +30
 *   Gold Loyalty      -> +15
 *   Silver Loyalty    -> +8
 */
function calculatePriority(user) {
  if (!user) return { score: 0, qualifiesForSpecialSeating: false, cannotTakeExitRow: false };

  let score = 0;
  let cannotTakeExitRow = false;

  if (user.dob) {
    const birthDate = new Date(user.dob);
    const ageDiff = Date.now() - birthDate.getTime();
    const age = Math.floor(ageDiff / (1000 * 60 * 60 * 24 * 365.25));

    if (age >= 65) {
      score += 40;
      cannotTakeExitRow = true; // FAA / DGCA regulation: seniors unable to operate emergency exit
    } else if (age <= 5) {
      score += 35;
      cannotTakeExitRow = true; // Toddlers cannot sit in exit rows
    }
  }

  if (user.accessibility) {
    score += 30;
    cannotTakeExitRow = true; // Passengers requiring accessibility support cannot sit in exit rows
  }

  if (user.loyalty_tier === 'gold') {
    score += 15;
  } else if (user.loyalty_tier === 'silver') {
    score += 8;
  }

  return {
    score,
    qualifiesForSpecialSeating: score >= 40,
    cannotTakeExitRow,
  };
}

/**
 * GET /api/seats/:flightId
 * Returns the layout of all physical seats for this flight.
 * Merges:
 *   - PostgreSQL seat details & permanent is_reserved status
 *   - Redis temporary hold status using a single batch MGET
 *   - Priority Seating recommendation flags for seniors & accessibility
 */
router.get('/:flightId', async (req, res, next) => {
  try {
    const flightId = parseInt(req.params.flightId, 10);
    if (isNaN(flightId)) {
      return res.status(400).json({ error: 'Invalid flight ID' });
    }

    const user = optionalAuth(req);
    const priority = calculatePriority(user);

    // 1. Fetch all seats from PostgreSQL
    const seatsResult = await db.query(
      `SELECT
         seat_id, flight_id, row_num, seat_letter, class,
         is_aisle, is_window, is_exit_row, is_reserved
       FROM seat_map
       WHERE flight_id = $1
       ORDER BY row_num ASC, seat_letter ASC`,
      [flightId]
    );

    const seats = seatsResult.rows;
    if (seats.length === 0) {
      return res.status(404).json({ error: 'No seats found for this flight' });
    }

    // 2. Efficient batch check of Redis holds (1 Redis call for all 120 seats!)
    const holdKeys = seats.map((s) => `hold:${s.seat_id}`);
    const holdValues = holdKeys.length > 0 ? await redis.mget(...holdKeys) : [];

    // 3. Assemble response objects
    const currentUserId = user ? String(user.passenger_id) : null;

    const enrichedSeats = seats.map((seat, index) => {
      const holdVal = holdValues[index]; // format: "passengerId:timestamp" or null
      const isHeld = Boolean(holdVal);
      const heldByPassengerId = isHeld ? holdVal.split(':')[0] : null;
      const heldByMe = currentUserId ? heldByPassengerId === currentUserId : false;

      // Recommended seat logic:
      // Seniors or passengers with accessibility score >= 40 prefer aisle seats that are NOT exit rows
      const isRecommended =
        priority.qualifiesForSpecialSeating &&
        seat.is_aisle &&
        !seat.is_exit_row &&
        !seat.is_reserved &&
        !isHeld;

      // Aviation safety check: passengers with mobility needs or toddlers are prohibited from exit rows
      const isRestrictedForUser = priority.cannotTakeExitRow && seat.is_exit_row;

      return {
        ...seat,
        is_held: isHeld,
        held_by_me: heldByMe,
        is_recommended: isRecommended,
        is_restricted: isRestrictedForUser,
      };
    });

    res.json({
      flight_id: flightId,
      total_seats: enrichedSeats.length,
      user_priority: priority,
      seats: enrichedSeats,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/seats/hold
 * Body: { "seatId": 42 }
 * Requires JWT Authentication.
 *
 * Atomically places a 10-minute hold in Redis using SET NX EX.
 * If another passenger clicks simultaneously, only ONE will succeed.
 */
router.post('/hold', verify, async (req, res, next) => {
  try {
    const { seatId } = req.body;
    if (!seatId) {
      return res.status(400).json({ error: 'seatId is required' });
    }

    // 1. Verify that seat exists and is not already permanently booked in PostgreSQL
    const seatRes = await db.query(
      'SELECT seat_id, flight_id, is_reserved, is_exit_row FROM seat_map WHERE seat_id = $1',
      [seatId]
    );

    if (seatRes.rows.length === 0) {
      return res.status(404).json({ error: 'Seat not found' });
    }

    const seat = seatRes.rows[0];
    if (seat.is_reserved) {
      return res.status(409).json({ error: 'Seat is already permanently reserved.' });
    }

    // 2. Exit row safety check
    const priority = calculatePriority(req.user);
    if (priority.cannotTakeExitRow && seat.is_exit_row) {
      return res.status(400).json({
        error: 'Exit row seats cannot be assigned to passengers requiring special assistance or seniors according to flight safety regulations.',
      });
    }

    // 3. Atomic Redis hold with 10 minutes (600 seconds) TTL
    const holdKey = `hold:${seatId}`;
    const holdValue = `${req.user.passenger_id}:${Date.now()}`;
    const result = await redis.set(holdKey, holdValue, 'EX', 600, 'NX');

    if (!result) {
      // Key was not set because it already exists (another passenger holds it)
      return res.status(409).json({
        error: 'This seat is currently held by another passenger. Please select another seat.',
      });
    }

    // 4. Publish Kafka event for the seat hold
    await publishEvent('seat-holds', {
      type: 'seat.held',
      seatId: seat.seat_id,
      flightId: seat.flight_id,
      passengerId: req.user.passenger_id,
      heldAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600 * 1000).toISOString(),
    });

    res.status(200).json({
      message: 'Seat held successfully for 10 minutes',
      seat_id: seat.seat_id,
      flight_id: seat.flight_id,
      ttl_seconds: 600,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/seats/hold/:seatId
 * Releases a hold in Redis before the 10-minute expiration.
 * Only the passenger who placed the hold can release it.
 */
router.delete('/hold/:seatId', verify, async (req, res, next) => {
  try {
    const seatId = parseInt(req.params.seatId, 10);
    const holdKey = `hold:${seatId}`;

    const currentHold = await redis.get(holdKey);
    if (!currentHold) {
      return res.status(200).json({ message: 'Hold already expired or does not exist.' });
    }

    const heldByPassengerId = currentHold.split(':')[0];
    if (heldByPassengerId !== String(req.user.passenger_id)) {
      return res.status(403).json({ error: 'You can only release your own seat holds.' });
    }

    await redis.del(holdKey);

    res.json({ message: 'Seat hold released successfully', seat_id: seatId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
