# ✈️ Airline Ticket Reservation System

> A full-stack airline reservation system built for a Database Systems course project.  
> Demonstrates ACID transactions, dynamic pricing, Redis seat holds, Kafka event streaming, stored procedures, triggers, and concurrency control — all integrated into a working MVP.

---

## 🏗️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Database | PostgreSQL 16 | ACID transactions, stored procedures, triggers, indexes |
| Cache | Redis 8 | Atomic 10-minute seat holds (TTL-based) |
| Event Bus | Apache Kafka + Zookeeper | Decoupled booking/cancellation event streaming |
| Backend | Node.js + Express | REST API — orchestrates DB, Redis, Kafka |
| Frontend | React 19 + Vite | SPA with seat map, dynamic pricing display, booking flow |
| Auth | JWT (jsonwebtoken) + bcryptjs | Stateless authentication |
| DB GUI | pgAdmin 4 | Inspect tables, run queries, verify triggers |
| Container | Docker + docker-compose | One-command local environment |

---

## 🗂️ Project Structure

```
airline-reservation/
├── docker-compose.yml          ← All infrastructure (Postgres, Redis, Kafka, Zookeeper, pgAdmin)
├── .env                        ← Local secrets (NOT committed to Git)
├── .env.example                ← Template — copy to .env and fill in values
├── requirements.txt            ← Dependency reference list
│
├── backend/                    ← Express API (to be built)
│   ├── package.json
│   ├── server.js               ← Entry point
│   ├── db.js                   ← PostgreSQL connection pool
│   ├── redis.js                ← Redis client
│   ├── kafka.js                ← Kafka producer
│   ├── db/
│   │   ├── schema.sql          ← All 7 tables + indexes
│   │   ├── procedures.sql      ← Dynamic pricing function + waitlist trigger
│   │   └── seed.sql            ← Sample data
│   ├── routes/
│   │   ├── auth.js             ← Register, Login, JWT middleware
│   │   ├── flights.js          ← Flight search with live pricing
│   │   ├── seats.js            ← Seat map, Redis hold/release
│   │   └── bookings.js         ← Create/cancel booking (ACID core)
│   └── consumer/
│       └── consumer.js         ← Kafka consumer (waitlist promotion)
│
├── frontend/                   ← React + Vite SPA
│   ├── vite.config.js          ← Proxies /api → backend
│   └── src/
│       ├── api.js              ← All fetch() calls
│       ├── BookingContext.jsx  ← Shared state
│       └── pages/
│           ├── Home.jsx        ← Search form
│           ├── Flights.jsx     ← Results with prices
│           ├── SeatMap.jsx     ← Seat picker + countdown timer
│           ├── Checkout.jsx    ← Confirm and book
│           └── Confirmation.jsx← PNR success page
│
└── scripts/
    └── load_test.js            ← 100 concurrent user concurrency test
```

---

## ⚡ Key Features

- **Dynamic Pricing** — ticket prices rise automatically as seats fill up (stored procedure in PostgreSQL)
- **Redis Seat Holds** — atomic 10-minute seat reservations using `SET NX` (no double-holds possible)
- **ACID Booking** — `SERIALIZABLE` isolation prevents double-booking even under concurrent load
- **Kafka Event Streaming** — booking/cancellation events published to Kafka topics, consumed asynchronously
- **Waitlist Promotion** — DB trigger + Kafka consumer both promote waitlisted passengers on cancellation
- **Priority Seating** — age-based seat recommendations (seniors get aisle seats, never exit rows)
- **EXPLAIN ANALYZE Demo** — query optimization proof via index scan vs sequential scan

---

## 🚀 Getting Started

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop) (includes Docker Compose)
- [Node.js 20+](https://nodejs.org/)
- [pgAdmin 4](https://www.pgadmin.org/) (optional — included in docker-compose)

### 1. Clone and Configure
```bash
git clone <repo-url>
cd airline-reservation
cp .env.example .env
# Edit .env with your values (defaults match docker-compose.yml)
```

### 2. Start Infrastructure
```bash
docker-compose up -d
docker ps   # verify 5 containers are "Up"
```

Expected containers:
| Container | Port |
|-----------|------|
| `airline-ticket-reservation-system-postgres` | 5432 |
| `airline-ticket-reservation-system-redis` | 6379 |
| `airline-ticket-reservation-system-kafka` | 9092 |
| `airline-ticket-reservation-system-zookeeper` | 2181 |
| `airline-ticket-reservation-system-pgadmin` | 8081 |

### 3. Set Up Database
```bash
psql postgresql://admin:project@123@localhost:5432/airline_ticketing_db -f backend/db/schema.sql
psql postgresql://admin:project@123@localhost:5432/airline_ticketing_db -f backend/db/procedures.sql
psql postgresql://admin:project@123@localhost:5432/airline_ticketing_db -f backend/db/seed.sql
```

### 4. Create Kafka Topics
```bash
docker exec -it airline-ticket-reservation-system-kafka \
  kafka-topics --create --topic bookings --bootstrap-server localhost:29092 --partitions 1 --replication-factor 1

docker exec -it airline-ticket-reservation-system-kafka \
  kafka-topics --create --topic cancellations --bootstrap-server localhost:29092 --partitions 1 --replication-factor 1

docker exec -it airline-ticket-reservation-system-kafka \
  kafka-topics --create --topic seat-holds --bootstrap-server localhost:29092 --partitions 1 --replication-factor 1
```

### 5. Start Backend (Terminal 1)
```bash
cd backend
npm install
node server.js
# → "Backend running on :3001" + "Kafka producer connected"
```

### 6. Start Kafka Consumer (Terminal 2)
```bash
node backend/consumer/consumer.js
# → "Consumer listening on: bookings, cancellations, seat-holds"
```

### 7. Start Frontend (Terminal 3)
```bash
cd frontend
npm install
npm run dev
# → Opens http://localhost:5173
```

---

## 🔍 Verification Commands

### Check database is healthy
```bash
psql postgresql://admin:project@123@localhost:5432/airline_ticketing_db -c "\dt"
# Should list all 7 tables
```

### Check Redis
```bash
docker exec -it airline-ticket-reservation-system-redis redis-cli ping
# → PONG
```

### Check Kafka topics
```bash
docker exec -it airline-ticket-reservation-system-kafka \
  kafka-topics --list --bootstrap-server localhost:29092
# → bookings, cancellations, seat-holds
```

### pgAdmin UI
Open `http://localhost:8081` — login with `project123@gmail.com` / `project@123`

---

## 🧪 Running the Concurrency Test
```bash
node scripts/load_test.js
# Fires 100 simultaneous booking attempts on the same seat
# Expected: 1 success, ~99 blocked by Redis NX or SERIALIZABLE rollback
```

---

## 📚 Database Schema Overview

| Table | Rows (seeded) | Key Concept |
|-------|--------------|-------------|
| `airports` | 6 | Reference data |
| `flights` | 5 | Indexed on `(origin, destination, departure_time)` |
| `seat_map` | 600 | `is_reserved` flag; indexed on `(flight_id, class, is_reserved)` |
| `passengers` | 3+ | `dob` drives priority score calculation |
| `bookings` | — | `price_snapshot` JSONB preserves price at booking time |
| `pricing_rules` | 15+ | Drives `calculate_dynamic_price()` stored procedure |
| `waitlist` | — | Promoted by trigger `trg_promote_waitlist` + Kafka consumer |

---

## 📋 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | See `.env.example` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `KAFKA_BROKER` | Kafka broker address | `localhost:9092` |
| `JWT_SECRET` | Secret for signing JWTs | — (required) |
| `PORT` | Express server port | `3001` |

---

## 🎓 Course Project — Key Demo Moments

1. **EXPLAIN ANALYZE** — prove the composite index on `flights` gives a 20–30× speedup over sequential scan
2. **Concurrent Booking** — run `load_test.js`, show exactly 1 booking succeeds out of 100 attempts
3. **Waitlist Trigger** — cancel a booking, watch `waitlist.status` flip to `pending_confirmation` automatically in pgAdmin
4. **Kafka Consumer** — show the consumer terminal printing the promotion event while the API terminal is idle
