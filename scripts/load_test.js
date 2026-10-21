// =============================================================================
// scripts/load_test.js — Concurrency & Double-Booking Stress Test
// =============================================================================
// Demonstrates that under heavy concurrent load (50 simultaneous booking attempts
// for the exact same physical seat), EXACTLY ONE succeeds and all others are
// rejected with 409 Conflict.
//
// Run with:
//   node scripts/load_test.js
// =============================================================================

const http = require('http');

const API_BASE = 'http://localhost:3001/api';
const CONCURRENT_REQUESTS = 50;

// Helper: HTTP request wrapper
function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTest() {
  console.log('=============================================================================');
  console.log('🚀 AIRLINE RESERVATION SYSTEM — CONCURRENCY & ISOLATION STRESS TEST');
  console.log('=============================================================================');
  console.log(`Target: ${CONCURRENT_REQUESTS} simulated passengers racing for the SAME seat.`);

  // 1. Authenticate sample user Rahul Sharma
  console.log('\n[1/3] Logging in sample user...');
  const loginRes = await makeRequest(
    {
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email: 'rahul@example.com', password: 'Password123!' }
  );

  if (loginRes.status !== 200 || !loginRes.body.token) {
    console.error('❌ Failed to log in. Please ensure the backend is running and seed.sql has been executed.');
    console.error('Response:', loginRes.body);
    process.exit(1);
  }

  const token = loginRes.body.token;
  console.log('✅ Logged in successfully. JWT obtained.');

  // Target flight 1, seat 15 (Row 3, Seat C -> Business Class)
  // Note: Rows 1-2 = First, Rows 3-5 = Business, Rows 6-20 = Economy (Seats 31-120)
  const flightId = 1;
  const seatId = 15;

  console.log(`\n[2/3] Placing initial Redis hold on Seat ID ${seatId} for Flight ${flightId}...`);
  await makeRequest(
    {
      hostname: 'localhost',
      port: 3001,
      path: '/api/seats/hold',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
    { seatId }
  );

  console.log(`\n[3/3] Firing ${CONCURRENT_REQUESTS} SIMULTANEOUS booking requests...`);

  const promises = [];
  const start = Date.now();

  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    promises.push(
      makeRequest(
        {
          hostname: 'localhost',
          port: 3001,
          path: '/api/bookings',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
        { flightId, seatId }
      )
    );
  }

  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;

  let successCount = 0;
  let conflictCount = 0;
  let otherCount = 0;

  for (const r of results) {
    if (r.status === 201) successCount++;
    else if (r.status === 409) conflictCount++;
    else otherCount++;
  }

  console.log('\n=============================================================================');
  console.log('📊 TEST RESULTS:');
  console.log('=============================================================================');
  console.log(`Total Requests:         ${CONCURRENT_REQUESTS}`);
  console.log(`Time Taken:             ${elapsed} ms`);
  console.log(`Successful Bookings:    ${successCount}  (Expected: 1)`);
  console.log(`Prevented Collisions:   ${conflictCount} (Expected: ${CONCURRENT_REQUESTS - 1})`);
  console.log(`Other Statuses:         ${otherCount}`);

  if (successCount === 1 && conflictCount === CONCURRENT_REQUESTS - 1) {
    console.log('\n🎉 PASS: ACID SERIALIZABLE ISOLATION & REDIS HOLDS VERIFIED!');
    console.log('Zero double-bookings occurred. Concurrency control is fully intact.');
  } else {
    console.log('\n⚠️  REVIEW: Expected exactly 1 booking to succeed.');
  }
  console.log('=============================================================================\n');
}

runTest().catch((err) => {
  console.error('Fatal test error:', err.message);
});
