// =============================================================================
// server.js — Express Application Entrypoint
// =============================================================================
// This file initializes Express, mounts all API routes, sets up global error
// handling, connects the Kafka producer, and starts the HTTP server.
// =============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('./db');
const redis = require('./redis');
const { connectProducer } = require('./kafka');

// Route modules
const { router: authRouter } = require('./routes/auth');
const flightsRouter = require('./routes/flights');
const seatsRouter = require('./routes/seats');
const bookingsRouter = require('./routes/bookings');

const app = express();
const PORT = process.env.PORT || 3001;

// ── GLOBAL MIDDLEWARE ────────────────────────────────────────────────────────
// Enable CORS for frontend requests (Vite runs on http://localhost:5173)
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}));

// Parse JSON request bodies
app.use(express.json());

// ── HEALTH CHECK ROUTE ────────────────────────────────────────────────────────
// Used to verify database and Redis connectivity
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';

  try {
    const dbRes = await db.query('SELECT NOW() AS current_time');
    if (dbRes.rows.length > 0) dbStatus = 'connected';
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  try {
    const pong = await redis.ping();
    if (pong === 'PONG') redisStatus = 'connected';
  } catch (err) {
    redisStatus = `error: ${err.message}`;
  }

  const allHealthy = dbStatus === 'connected' && redisStatus === 'connected';

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      postgres: dbStatus,
      redis: redisStatus,
    },
  });
});

// ── MOUNT ROUTES ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/flights', flightsRouter);
app.use('/api/seats', seatsRouter);
app.use('/api/bookings', bookingsRouter);

// Fallback 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── CENTRALIZED ERROR HANDLER ────────────────────────────────────────────────
// Any error passed to next(err) in any route lands here
app.use((err, req, res, next) => {
  console.error('[Server Error]:', err);

  // PostgreSQL Serialization Failure (code 40001) in SERIALIZABLE transactions
  if (err.code === '40001') {
    return res.status(409).json({
      error: 'Conflict: The seat is being booked simultaneously by another transaction. Please try again.',
      code: 'SERIALIZATION_FAILURE',
    });
  }

  // PostgreSQL unique violation (code 23505)
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Conflict: Unique constraint violation (record already exists).',
      detail: err.detail,
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
});

// ── STARTUP SEQUENCE ─────────────────────────────────────────────────────────
async function startServer() {
  try {
    // 1. Connect Kafka producer before taking HTTP traffic
    await connectProducer();

    // 2. Start HTTP listener
    app.listen(PORT, () => {
      console.log(`[Express] Airline Ticket Reservation System API listening on port ${PORT}`);
      console.log(`[Express] Health check available at http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('[Fatal Error] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
