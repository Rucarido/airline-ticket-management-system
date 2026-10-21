// =============================================================================
// consumer.js — Kafka Background Event Consumer
// =============================================================================
// Runs as an independent worker process:
//   node backend/consumer/consumer.js
//
// Subscribes to 3 Kafka topics:
//   1. 'bookings'      -> processes confirmed bookings (e.g. ticket issuance)
//   2. 'cancellations' -> processes cancellations & waitlist promotions
//   3. 'seat-holds'    -> tracks active temporary holds
// =============================================================================

require('dotenv').config();
const { Kafka } = require('kafkajs');
const db = require('../db');

const broker = process.env.KAFKA_BROKER || 'localhost:9092';

const kafka = new Kafka({
  clientId: 'airline-background-consumer',
  brokers: [broker],
  retry: {
    initialRetryTime: 300,
    retries: 5,
  },
});

const consumer = kafka.consumer({
  groupId: 'airline-reservation-consumer-group',
});

async function runConsumer() {
  try {
    console.log('[Kafka Consumer] Connecting to Kafka broker at', broker);
    await consumer.connect();
    console.log('[Kafka Consumer] Connected successfully!');

    // Subscribe to all 3 application event topics
    await consumer.subscribe({ topic: 'bookings', fromBeginning: false });
    await consumer.subscribe({ topic: 'cancellations', fromBeginning: false });
    await consumer.subscribe({ topic: 'seat-holds', fromBeginning: false });

    console.log('[Kafka Consumer] Subscribed to topics: "bookings", "cancellations", "seat-holds"');
    console.log('[Kafka Consumer] Waiting for incoming events...\n');

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const rawValue = message.value.toString();
        let payload;
        try {
          payload = JSON.parse(rawValue);
        } catch {
          payload = rawValue;
        }

        const timestamp = new Date().toLocaleTimeString();

        switch (topic) {
          case 'bookings':
            console.log(`\n======================================================`);
            console.log(`[${timestamp}] 🎫 [EVENT: BOOKING CREATED]`);
            console.log(`  PNR:          ${payload.pnr}`);
            console.log(`  Passenger ID: ${payload.passengerId}`);
            console.log(`  Flight ID:    ${payload.flightId}`);
            console.log(`  Seat ID:      ${payload.seatId} (${payload.class})`);
            console.log(`  Price Paid:   ₹${payload.price}`);
            console.log(`  [SIMULATION]: Electronic ticket generated & notification sent.`);
            console.log(`======================================================\n`);
            break;

          case 'cancellations':
            console.log(`\n======================================================`);
            console.log(`[${timestamp}] ❌ [EVENT: BOOKING CANCELLED]`);
            console.log(`  Booking ID:   ${payload.bookingId}`);
            console.log(`  Flight ID:    ${payload.flightId}`);
            console.log(`  Seat ID:      ${payload.seatId}`);

            if (payload.promotedWaitlist) {
              console.log(`  ✨ [WAITLIST PROMOTION]: Passenger ${payload.promotedWaitlist.passenger_id} has been promoted to 'pending_confirmation'!`);
              console.log(`  [SIMULATION]: Sent SMS/Email to passenger offering the freed seat.`);
            } else {
              console.log(`  No waitlisted passengers for this flight.`);
            }
            console.log(`======================================================\n`);
            break;

          case 'seat-holds':
            console.log(`[${timestamp}] ⏱️  [EVENT: SEAT HELD] Seat ${payload.seatId} held by Passenger ${payload.passengerId} (Expires: ${payload.expiresAt})`);
            break;

          default:
            console.log(`[${timestamp}] Unknown topic "${topic}":`, payload);
        }
      },
    });
  } catch (err) {
    console.error('[Kafka Consumer Error]:', err.message);
  }
}

// Graceful shutdown on Ctrl+C or kill signal
const shutdown = async () => {
  console.log('\n[Kafka Consumer] Disconnecting...');
  await consumer.disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

runConsumer();
