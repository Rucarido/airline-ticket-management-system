// =============================================================================
// kafka.js — Kafka Producer Setup
// =============================================================================
// We use KafkaJS to connect to Apache Kafka on port 9092 (outside Docker)
// or 29092 (inside Docker).
//
// WHY KAFKA ALONGSIDE POSTGRESQL?
//   PostgreSQL is our single source of truth for consistent, ACID-guaranteed state.
//   Kafka provides an asynchronous, distributed event log for:
//   - Decoupled event processing (e.g. notifications, ticket generation)
//   - Audit trail of all booking, cancellation, and seat-hold events
//   - Automatic waitlist notification triggers via background consumer
//
// TOPICS USED:
//   1. 'bookings'      -> published after a booking transaction commits
//   2. 'cancellations' -> published when a booking is cancelled
//   3. 'seat-holds'    -> published when a temporary Redis seat hold is placed
// =============================================================================

require('dotenv').config();
const { Kafka, Partitioners } = require('kafkajs');

const broker = process.env.KAFKA_BROKER || 'localhost:9092';

const kafka = new Kafka({
  clientId: 'airline-backend-producer',
  brokers: [broker],
  retry: {
    initialRetryTime: 300,
    retries: 5,
  },
});

// Use legacy partitioner to prevent KafkaJS deprecation warnings
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

let isConnected = false;

/**
 * Connect the Kafka producer during application startup.
 * Called in server.js before Express starts listening.
 */
async function connectProducer() {
  if (isConnected) return;
  try {
    await producer.connect();
    isConnected = true;
    console.log(`[Kafka] Producer connected successfully to broker: ${broker}`);
  } catch (err) {
    console.error(`[Kafka Error] Failed to connect producer to ${broker}:`, err.message);
    // We log but don't exit process so the HTTP API can still function during development
  }
}

/**
 * Publishes an event to a given Kafka topic.
 * @param {string} topic - e.g. 'bookings', 'cancellations', 'seat-holds'
 * @param {object} payload - JavaScript object to be sent as JSON string
 */
async function publishEvent(topic, payload) {
  if (!isConnected) {
    console.warn(`[Kafka Warning] Producer not connected. Dropping event for topic "${topic}".`);
    return;
  }

  try {
    const messageValue = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await producer.send({
      topic,
      messages: [{ value: messageValue }],
    });
    console.log(`[Kafka Event] Sent event to topic "${topic}":`, payload.type || topic);
  } catch (err) {
    console.error(`[Kafka Error] Error sending to topic "${topic}":`, err.message);
  }
}

module.exports = {
  producer,
  connectProducer,
  publishEvent,
};
