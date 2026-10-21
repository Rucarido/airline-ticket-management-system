// =============================================================================
// routes/auth.js — Authentication & JWT Middleware
// =============================================================================
// Provides:
//   1. POST /api/auth/register — creates a new passenger account with bcrypt hash
//   2. POST /api/auth/login    — validates credentials and returns a signed JWT
//   3. verify middleware      — protects routes and decodes passenger payload
// =============================================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'airline-super-secret-jwt-key-change-in-production';

/**
 * Middleware: verify
 * Authenticates requests using the Bearer token in the Authorization header.
 * Attaches decoded passenger object to req.user.
 * Exported as named export so other routes can use: const { verify } = require('./auth');
 */
function verify(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied: No token provided or invalid format.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { passenger_id, email, loyalty_tier, dob, accessibility, ... }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Access denied: Invalid or expired token.' });
  }
}

/**
 * POST /api/auth/register
 * Request body:
 *   {
 *     "full_name": "Rahul Sharma",
 *     "email": "rahul@example.com",
 *     "password": "Password123!",
 *     "dob": "1995-06-15",
 *     "passport_num": "N1234567",
 *     "loyalty_tier": "none",       (optional: 'none' | 'silver' | 'gold')
 *     "accessibility": false        (optional: boolean)
 *   }
 */
router.post('/register', async (req, res, next) => {
  try {
    const {
      full_name,
      email,
      password,
      dob,
      passport_num,
      loyalty_tier = 'none',
      accessibility = false,
    } = req.body;

    if (!full_name || !email || !password || !dob) {
      return res.status(400).json({
        error: 'Missing required fields: full_name, email, password, and dob are required.',
      });
    }

    // Check if email already exists
    const existing = await db.query('SELECT passenger_id FROM passengers WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password with salt rounds = 10
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert new passenger
    const insertSql = `
      INSERT INTO passengers (
        full_name, email, password_hash, dob,
        passport_num, loyalty_tier, accessibility
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING passenger_id, full_name, email, dob, passport_num, loyalty_tier, accessibility, created_at;
    `;
    const values = [
      full_name.trim(),
      email.toLowerCase().trim(),
      password_hash,
      dob,
      passport_num || null,
      loyalty_tier,
      Boolean(accessibility),
    ];

    const result = await db.query(insertSql, values);
    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      {
        passenger_id: user.passenger_id,
        email: user.email,
        full_name: user.full_name,
        loyalty_tier: user.loyalty_tier,
        dob: user.dob,
        accessibility: user.accessibility,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * Request body:
 *   {
 *     "email": "rahul@example.com",
 *     "password": "Password123!"
 *   }
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await db.query(
      'SELECT passenger_id, full_name, email, password_hash, dob, passport_num, loyalty_tier, accessibility FROM passengers WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passenger = result.rows[0];

    // Compare passwords
    const isMatch = await bcrypt.compare(password, passenger.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Strip password_hash from response object
    const { password_hash, ...user } = passenger;

    // Generate JWT token
    const token = jwt.sign(
      {
        passenger_id: user.passenger_id,
        email: user.email,
        full_name: user.full_name,
        loyalty_tier: user.loyalty_tier,
        dob: user.dob,
        accessibility: user.accessibility,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({
      message: 'Login successful',
      token,
      user,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = {
  router,
  verify,
};
