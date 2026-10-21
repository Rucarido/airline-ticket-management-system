// =============================================================================
// db.js — PostgreSQL Connection Pool
// =============================================================================
// We use node-postgres (pg) connection pool.
//
// WHY A POOL INSTEAD OF A SINGLE CLIENT?
//   A single database client can only execute one query at a time. If 50 users
//   request flights simultaneously, a single connection would make them wait in
//   line (head-of-line blocking).
//
//   A pool maintains a set of reusable connections (default max 10-20). Queries
//   borrow a connection, execute, and return it back to the pool instantly.
//
// USAGE:
//   1. Normal queries (auto-commit):
//        const db = require('./db');
//        const res = await db.query('SELECT * FROM flights WHERE flight_id = $1', [id]);
//
//   2. Multi-step ACID transactions (MUST use a dedicated client):
//        const client = await db.pool.connect();
//        try {
//          await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
//          ...
//          await client.query('COMMIT');
//        } catch (err) {
//          await client.query('ROLLBACK');
//          throw err;
//        } finally {
//          client.release(); // ALWAYS release back to pool
//        }
// =============================================================================

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://admin:project@123@localhost:5432/airline_ticketing_db',
  max: 20,                   // Maximum number of connections in the pool
  idleTimeoutMillis: 30000,  // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Error after 5s if connection cannot be established
});

// Event listeners for connection monitoring and debugging
pool.on('connect', () => {
  // Helpful log for database activity monitoring
});

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]: Unexpected error on idle client', err.message);
});

// Helper for single queries that automatically acquires and releases a client from the pool
const query = (text, params) => pool.query(text, params);

module.exports = {
  pool,
  query,
};
