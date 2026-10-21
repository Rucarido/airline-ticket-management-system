// =============================================================================
// routes/flights.js — Flight Search & Schedule Endpoints
// =============================================================================
// Provides:
//   1. GET /api/flights/search   — search flights by origin, dest, date with dynamic pricing
//   2. GET /api/flights/airports — list all available airports for dropdowns
//   3. GET /api/flights/:id      — single flight details with real-time class prices
// =============================================================================

const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * GET /api/flights/airports
 * Returns all airports in the system (useful for search form dropdowns).
 */
router.get('/airports', async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT iata_code, city, country FROM airports ORDER BY city ASC'
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/flights/search
 * Query parameters:
 *   - origin (e.g. 'BOM')
 *   - destination (e.g. 'DEL')
 *   - date (optional, 'YYYY-MM-DD')
 *
 * HOW DYNAMIC PRICING IS INTEGRATED:
 *   We invoke the PostgreSQL stored procedure `calculate_dynamic_price()` directly
 *   in the SELECT projection for each cabin class.
 *   PostgreSQL computes real-time pricing taking into account current seat
 *   occupancy and departure proximity in a single database round-trip.
 */
router.get('/search', async (req, res, next) => {
  try {
    const { origin, destination, date } = req.query;

    const conditions = [];
    const params = [];

    if (origin) {
      params.push(origin.toUpperCase().trim());
      conditions.push(`f.origin = $${params.length}`);
    }

    if (destination) {
      params.push(destination.toUpperCase().trim());
      conditions.push(`f.destination = $${params.length}`);
    }

    if (date) {
      params.push(date.trim());
      conditions.push(`DATE(f.departure_time) = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        f.flight_id,
        f.flight_number,
        f.origin,
        orig.city AS origin_city,
        orig.country AS origin_country,
        f.destination,
        dest.city AS destination_city,
        dest.country AS destination_country,
        f.departure_time,
        f.arrival_time,
        f.base_price,
        f.total_seats,
        f.status,
        -- Call stored procedure calculate_dynamic_price() for each cabin class
        calculate_dynamic_price(f.flight_id, 'economy'::seat_class)  AS economy_price,
        calculate_dynamic_price(f.flight_id, 'business'::seat_class) AS business_price,
        calculate_dynamic_price(f.flight_id, 'first'::seat_class)    AS first_price,
        -- Calculate available unreserved seats
        (
          SELECT COUNT(*)::INT
          FROM seat_map s
          WHERE s.flight_id = f.flight_id AND s.is_reserved = FALSE
        ) AS available_seats
      FROM flights f
      JOIN airports orig ON f.origin = orig.iata_code
      JOIN airports dest ON f.destination = dest.iata_code
      ${whereClause}
      ORDER BY f.departure_time ASC;
    `;

    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/flights/:id
 * Returns single flight with current pricing and occupancy summary.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const flightId = parseInt(req.params.id, 10);
    if (isNaN(flightId)) {
      return res.status(400).json({ error: 'Invalid flight ID' });
    }

    const sql = `
      SELECT
        f.flight_id,
        f.flight_number,
        f.origin,
        orig.city AS origin_city,
        f.destination,
        dest.city AS destination_city,
        f.departure_time,
        f.arrival_time,
        f.base_price,
        f.total_seats,
        f.status,
        calculate_dynamic_price(f.flight_id, 'economy'::seat_class)  AS economy_price,
        calculate_dynamic_price(f.flight_id, 'business'::seat_class) AS business_price,
        calculate_dynamic_price(f.flight_id, 'first'::seat_class)    AS first_price,
        (
          SELECT COUNT(*)::INT
          FROM seat_map s
          WHERE s.flight_id = f.flight_id AND s.is_reserved = FALSE
        ) AS available_seats
      FROM flights f
      JOIN airports orig ON f.origin = orig.iata_code
      JOIN airports dest ON f.destination = dest.iata_code
      WHERE f.flight_id = $1;
    `;

    const result = await db.query(sql, [flightId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Flight not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
