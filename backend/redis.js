// =============================================================================
// redis.js — Redis Client Setup
// =============================================================================
// We use ioredis to connect to the Redis instance running in Docker on port 6379.
//
// WHY REDIS FOR SEAT HOLDS?
//   When a user clicks a seat in the UI, they want 10 minutes to finish entering
//   passenger details and payment without anyone stealing that seat.
//
//   Why not store holds in PostgreSQL?
//   - High write throughput: thousands of users clicking seats creates heavy churn.
//   - Automatic TTL expiry: Redis keys can have an automatic time-to-live (e.g. 600s).
//     When 10 minutes elapse, Redis evicts the key automatically. In Postgres, you'd
//     need a background cron job or polling worker to find and delete expired holds.
//   - Atomic SET NX: `redis.set(key, val, 'EX', 600, 'NX')` only sets the key if
//     it does NOT already exist. This prevents double-holding in a single operation.
// =============================================================================

require('dotenv').config();
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  lazyConnect: false,
});

redis.on('connect', () => {
  console.log('[Redis] Connected successfully to ' + redisUrl);
});

redis.on('error', (err) => {
  console.error('[Redis Error]:', err.message);
});

module.exports = redis;
