# AeroReserve — Airline Ticket Reservation System

**A full-stack airline reservation system that makes database guarantees visible.**

Search flights, hold a seat in Redis for ten minutes, confirm a booking inside a
`SERIALIZABLE` PostgreSQL transaction, and watch Kafka carry the event to a
background consumer. The project was built as a Database Systems course project,
but the application is fully wired end to end: React SPA, Express API, PostgreSQL,
Redis, Kafka, JWT authentication, and a concurrency stress test.

[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-8-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Kafka](https://img.shields.io/badge/Kafka-7.6-231F20?logo=apachekafka&logoColor=white)](https://kafka.apache.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)

---

## Table of contents

- [At a glance](#at-a-glance)
- [What this project demonstrates](#what-this-project-demonstrates)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Demo accounts](#demo-accounts)
- [Booking lifecycle](#booking-lifecycle)
- [API reference](#api-reference)
- [Database design](#database-design)
- [Redis design](#redis-design)
- [Kafka design](#kafka-design)
- [Frontend guide](#frontend-guide)
- [Business rules](#business-rules)
- [Verification and testing](#verification-and-testing)
- [Troubleshooting](#troubleshooting)
- [Reset and cleanup](#reset-and-cleanup)
- [Known limitations](#known-limitations)
- [Security notes](#security-notes)
- [Course demo script](#course-demo-script)
- [Further reading](#further-reading)

---

## At a glance

| Area | Status / detail |
|---|---|
| Database | PostgreSQL 16 — 7 tables, 5 enum types, 2 search indexes, 1 partial unique index, 2 functions, 1 trigger |
| Cache | Redis 8 — atomic 10-minute seat holds using `SET ... EX 600 NX` |
| Events | Kafka 7.6 + Zookeeper — `bookings`, `cancellations`, `seat-holds` |
| Backend | Node.js 20 + Express 5, CommonJS, JWT + bcryptjs |
| Frontend | React 19 + React Router 7 + Vite 8, ES Modules |
| Seat layout | 20 rows × 6 seats = 120 seats per flight; 5 flights = 600 seats |
| Concurrency demo | 50 simultaneous booking attempts for one seat → exactly 1 success |
| Automated tests | No unit/integration framework is included; a complete manual/CLI verification suite is documented below |
| Intended use | Local development and coursework demonstration — not production |

### Why the project is interesting

Most CRUD apps stop at “insert a row.” This one deliberately shows the hard parts:

- **The database is the source of truth.** A seat is only booked when
  `seat_map.is_reserved = TRUE` inside a committed transaction.
- **Redis is temporary.** A Redis hold can expire, be released, or belong to
  another passenger; it never replaces the permanent database state.
- **Concurrency is handled twice.** Redis `NX` prevents most races, and
  PostgreSQL `SERIALIZABLE` + `SELECT ... FOR UPDATE` prevents the rest.
- **Pricing is computed in SQL.** `calculate_dynamic_price()` applies occupancy
  thresholds and a time-to-departure multiplier.
- **Waitlist promotion is automatic.** A PostgreSQL trigger promotes the best
  waitlisted passenger when a booking is cancelled.
- **Kafka is a real side channel.** Booking, cancellation, and hold events are
  published after the database operation, then consumed by a separate process.

---

## What this project demonstrates

| Concept | Where it lives | What you can observe |
|---|---|---|
| ACID transaction | `backend/routes/bookings.js` | One confirmed booking under 50 concurrent requests |
| `SERIALIZABLE` isolation | Booking transaction | SQLSTATE `40001` is caught and returned as HTTP 409 |
| Row-level locking | `SELECT ... FOR UPDATE` | The seat row cannot be double-booked |
| Stored procedure | `calculate_dynamic_price()` | Prices rise at 50%, 75%, and 90% occupancy |
| Trigger | `trg_promote_waitlist` | Waitlist changes to `pending_confirmation` on cancellation |
| Composite index | `idx_flights_route` | `EXPLAIN` can show an index scan on flight search |
| Redis TTL / atomicity | `backend/routes/seats.js` | `SET NX EX 600`; only one passenger can hold a seat |
| Batch cache read | `redis.mget(...)` | One Redis call returns hold state for all 120 seats |
| Event streaming | `backend/kafka.js`, `consumer/consumer.js` | Events appear in the consumer terminal |
| JWT authentication | `backend/routes/auth.js` | Protected hold, booking, and cancellation endpoints |
| Password hashing | `bcryptjs` | Plaintext passwords are never stored |
| Priority seating | `calculatePriority()` in `seats.js` | Seniors/accessibility profiles get aisle recommendations and exit-row restrictions |
| React state design | `frontend/src/BookingContext.jsx` | Session, selected flight/seat, hold countdown, and toast state |
| Accessible motion | `frontend/src/lib/motion.js` | Native Web Animations API + `prefers-reduced-motion` |

---

## Architecture

```mermaid
flowchart LR
    B[Browser<br/>React 19 SPA] -->|"/api/* via Vite proxy"| E[Express 5 API<br/>port 3001]
    E -->|"SQL / transactions"| P[(PostgreSQL 16<br/>airline_ticketing_db)]
    E -->|"SET NX / MGET / DEL"| R[(Redis 8<br/>hold:seat_id)]
    E -->|"publishEvent()"| K[(Kafka 7.6)]
    K --> C[Background consumer<br/>logs events]
    P -->|"trg_promote_waitlist"| W[(waitlist)]
```

### Booking sequence

```mermaid
sequenceDiagram
    autonumber
    actor U as Passenger
    participant UI as React SPA
    participant API as Express API
    participant Redis as Redis
    participant DB as PostgreSQL
    participant Kafka as Kafka

    U->>UI: Choose a seat
    UI->>API: POST /api/seats/hold { seatId }
    API->>Redis: SET hold:{seatId} "{passengerId}:{ts}" EX 600 NX
    Redis-->>API: OK (or nil if held)
    API-->>UI: 200 { ttl_seconds: 600 }
    U->>UI: Confirm booking
    UI->>API: POST /api/bookings { flightId, seatId }
    API->>Redis: GET hold:{seatId}
    Redis-->>API: owner id + timestamp
    API->>DB: BEGIN ISOLATION LEVEL SERIALIZABLE
    API->>DB: SELECT ... FOR UPDATE
    API->>DB: calculate_dynamic_price()
    API->>DB: UPDATE seat_map SET is_reserved = TRUE
    API->>DB: INSERT INTO bookings (... price_snapshot ...)
    API->>DB: COMMIT
    API->>Redis: DEL hold:{seatId}
    API->>Kafka: publish booking.created
    API-->>UI: 201 { pnr, booking }
    UI-->>U: Boarding pass
```

### Why both Redis and PostgreSQL?

| Layer | Lifetime | Purpose |
|---|---|---|
| Redis `hold:{seat_id}` | 10 minutes | Temporary checkout reservation; keeps other users out while one person pays |
| PostgreSQL `seat_map.is_reserved` | Permanent | The authoritative record that the seat is sold |
| PostgreSQL `bookings` row | Permanent | The ticket/PNR and immutable price snapshot |

If Redis is empty but PostgreSQL says `is_reserved = TRUE`, the seat is sold.
If Redis has a hold but no booking exists, the seat is temporarily unavailable.

---

## Tech stack

| Component | Technology | Version / image |
|---|---|---|
| Database | PostgreSQL | `postgres:16` |
| Cache | Redis | `redis:8` |
| Event bus | Apache Kafka | `confluentinc/cp-kafka:7.6.0` |
| Coordination | Zookeeper | `confluentinc/cp-zookeeper:7.6.0` |
| DB GUI | pgAdmin 4 | `dpage/pgadmin4` |
| Runtime | Node.js | 20+ |
| API framework | Express | `^5.2.1` |
| PostgreSQL client | `pg` | `^8.23.0` |
| Redis client | `ioredis` | `^6.0.0` |
| Kafka client | `kafkajs` | `^2.2.4` |
| Auth | `jsonwebtoken` | `^9.0.3` |
| Password hashing | `bcryptjs` | `^3.0.3` |
| Env loader | `dotenv` | `^17.4.2` |
| CORS | `cors` | `^2.8.6` |
| Frontend | React / React DOM | `^19.2.8` |
| Routing | `react-router-dom` | `^7.18.3` |
| Build tool | Vite | `^8.2.2` |
| React plugin | `@vitejs/plugin-react` | `^6.1.0` |
| Linter | `oxlint` | `^1.79.0` |

**Module systems:** the backend uses CommonJS (`require` / `module.exports`).
The frontend uses ES Modules (`import` / `export`) because `frontend/package.json`
contains `"type": "module"`. Do not add `"type": "module"` to the root
`package.json`.

---

## Repository layout

```text
airline-ticket-reservation-system/
├── docker-compose.yml              # PostgreSQL, Redis, Kafka, Zookeeper, pgAdmin
├── .env                            # Local values (not committed)
├── .env.example                    # Environment template
├── package.json                    # Backend dependencies (no backend/package.json)
├── requirements.txt                # Human-readable dependency reference
├── README.md                       # This file
├── AGENTS.md                       # Project context for AI coding agents
│
├── backend/
│   ├── server.js                   # Express entry point + health check + error handler
│   ├── db.js                       # PostgreSQL pool
│   ├── redis.js                    # ioredis client
│   ├── kafka.js                    # Kafka producer
│   ├── db/
│   │   ├── schema.sql              # 7 tables, 5 enum types, indexes
│   │   ├── procedures.sql          # Dynamic pricing function + waitlist trigger
│   │   └── seed.sql                # Airports, flights, 600 seats, passengers, rules
│   ├── routes/
│   │   ├── auth.js                 # Register, login, JWT verify middleware
│   │   ├── flights.js              # Airports, search, flight detail
│   │   ├── seats.js                # Seat map, Redis hold, release
│   │   └── bookings.js             # SERIALIZABLE booking, list, cancel
│   └── consumer/
│       └── consumer.js             # Kafka background consumer
│
├── frontend/
│   ├── package.json                # React/Vite dependencies (ES Modules)
│   ├── vite.config.js              # Dev proxy: /api → localhost:3001
│   ├── index.html
│   ├── DESIGN.md                   # "Runway Deck" design system
│   └── src/
│       ├── main.jsx                # React root + StrictMode
│       ├── App.jsx                 # Router, shell, toast, footer
│       ├── api.js                  # Fetch client + seat-map normalization
│       ├── BookingContext.jsx      # Session, hold state, toast, persona login
│       ├── index.css               # Design tokens, layout, components
│       ├── App.css                 # Keyframes and motion layer
│       ├── lib/motion.js           # Native WAAPI reveal helpers
│       ├── components/
│       │   ├── Navbar.jsx
│       │   ├── Timer.jsx
│       │   ├── SeatGrid.jsx
│       │   └── Icons.jsx
│       └── pages/
│           ├── Home.jsx
│           ├── Flights.jsx
│           ├── SeatMap.jsx
│           ├── Checkout.jsx
│           ├── Confirmation.jsx
│           ├── MyBookings.jsx
│           └── Auth.jsx
│
├── scripts/
│   └── load_test.js                # 50 concurrent bookings for one seat
│
└── report-proof/
    └── how to run.txt              # Original run notes
```

> **Important:** there is no `backend/package.json` and no `backend/node_modules`.
> The backend runs from the repository root with the root dependencies.

---

## Quick start

### Prerequisites

- **Docker Desktop** with Docker Compose
- **Node.js 20+** and npm
- Optional: `psql` client, or use the Docker-based database commands below
- Optional: pgAdmin at `http://localhost:8081`

### 1. Configure the environment

```powershell
cd "D:\Projects\Airline ticket reservation system"
Copy-Item .env.example .env
```

Edit `.env` with the local Docker values:

```env
DATABASE_URL=postgres://admin:project@123@localhost:5432/airline_ticketing_db
REDIS_URL=redis://localhost:6379
KAFKA_BROKER=localhost:9092
JWT_SECRET=airline-super-secret-jwt-key-change-in-production
PORT=3001
```

The password contains `@`. The existing value works with `pg`; if your tooling
rejects it, URL-encode it as `project%40123`.

> `.env` is intentionally not committed. Use a long random `JWT_SECRET` outside
> this local demo.

### 2. Install Node dependencies

From the repository root:

```powershell
npm install
```

Install frontend dependencies:

```powershell
cd .\frontend
npm install
cd ..
```

Evidence that this is already done in a working checkout:

```text
node_modules/          → True (backend dependencies)
frontend/node_modules/ → True (React/Vite dependencies)
backend/node_modules/  → False (expected; backend uses root dependencies)
```

### 3. Start infrastructure

```powershell
docker compose up -d
docker compose ps
```

Expected services:

| Service | Container | Host port |
|---|---|---|
| PostgreSQL | `airline-ticket-reservation-system-postgres` | `5432` |
| Redis | `airline-ticket-reservation-system-redis` | `6379` |
| Kafka | `airline-ticket-reservation-system-kafka` | `9092` |
| Zookeeper | `airline-ticket-reservation-system-zookeeper` | `2181` |
| pgAdmin | `airline-ticket-reservation-system-pgadmin` | `8081` |

Kafka may need **30–60 seconds** to become ready.

### 4. Create the database schema

Run these in order: **schema → procedures → seed**.

#### Option A — local `psql`

```powershell
$env:PGPASSWORD='project@123'

psql -h localhost -p 5432 -U admin -d airline_ticketing_db -f .\backend\db\schema.sql
psql -h localhost -p 5432 -U admin -d airline_ticketing_db -f .\backend\db\procedures.sql
psql -h localhost -p 5432 -U admin -d airline_ticketing_db -f .\backend\db\seed.sql
```

#### Option B — through Docker

```powershell
Get-Content .\backend\db\schema.sql -Raw |
  docker exec -i airline-ticket-reservation-system-postgres `
  psql -U admin -d airline_ticketing_db

Get-Content .\backend\db\procedures.sql -Raw |
  docker exec -i airline-ticket-reservation-system-postgres `
  psql -U admin -d airline_ticketing_db

Get-Content .\backend\db\seed.sql -Raw |
  docker exec -i airline-ticket-reservation-system-postgres `
  psql -U admin -d airline_ticketing_db
```

If PowerShell piping causes an encoding issue, use:

```powershell
cmd /c "docker exec -i airline-ticket-reservation-system-postgres psql -U admin -d airline_ticketing_db < backend\db\schema.sql"
cmd /c "docker exec -i airline-ticket-reservation-system-postgres psql -U admin -d airline_ticketing_db < backend\db\procedures.sql"
cmd /c "docker exec -i airline-ticket-reservation-system-postgres psql -U admin -d airline_ticketing_db < backend\db\seed.sql"
```

> `seed.sql` truncates and reseeds all tables. Run it whenever you want a clean
> demo state. It also creates PNR101 and Shanti Patel's waitlist entry.

### 5. Create Kafka topics

```powershell
docker exec -it airline-ticket-reservation-system-kafka kafka-topics `
  --bootstrap-server localhost:29092 `
  --create --if-not-exists --topic bookings `
  --partitions 1 --replication-factor 1

docker exec -it airline-ticket-reservation-system-kafka kafka-topics `
  --bootstrap-server localhost:29092 `
  --create --if-not-exists --topic cancellations `
  --partitions 1 --replication-factor 1

docker exec -it airline-ticket-reservation-system-kafka kafka-topics `
  --bootstrap-server localhost:29092 `
  --create --if-not-exists --topic seat-holds `
  --partitions 1 --replication-factor 1
```

Verify:

```powershell
docker exec -it airline-ticket-reservation-system-kafka kafka-topics `
  --bootstrap-server localhost:29092 --list
```

Expected:

```text
bookings
cancellations
seat-holds
```

### 6. Start the backend

Use a dedicated terminal, from the **repository root**:

```powershell
node backend/server.js
```

Expected:

```text
[Kafka] Producer connected successfully to broker: localhost:9092
[Express] Airline Ticket Reservation System API listening on port 3001
[Express] Health check available at http://localhost:3001/api/health
```

Do **not** run `cd backend; npm install; node server.js` — that instruction from
older drafts is incorrect for this repository.

### 7. Start the Kafka consumer

Second terminal, from the repository root:

```powershell
node backend/consumer/consumer.js
```

Expected:

```text
[Kafka Consumer] Connecting to Kafka broker at localhost:9092
[Kafka Consumer] Connected successfully!
[Kafka Consumer] Subscribed to topics: "bookings", "cancellations", "seat-holds"
[Kafka Consumer] Waiting for incoming events...
```

Leave it running. It prints live event details.

### 8. Start the frontend

Third terminal:

```powershell
cd .\frontend
npm run dev
```

Expected:

```text
VITE v8.x  ready
Local:   http://localhost:5173/
```

Open **http://localhost:5173**.

### 9. Verify the stack

```powershell
Invoke-RestMethod http://localhost:3001/api/health | ConvertTo-Json -Depth 5
```

Expected:

```json
{
  "status": "healthy",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "services": {
    "postgres": "connected",
    "redis": "connected"
  }
}
```

`/api/health` checks **PostgreSQL and Redis only**. Kafka is not included in the
health response; see [Kafka design](#kafka-design) for how to verify it.

### Terminal summary

| Terminal | Command | Purpose |
|---|---|---|
| 1 | `docker compose up -d` | Infrastructure |
| 2 | `node backend/server.js` | Express API on `:3001` |
| 3 | `node backend/consumer/consumer.js` | Kafka consumer |
| 4 | `cd frontend; npm run dev` | React app on `:5173` |

---

## Environment variables

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgres://admin:project@123@localhost:5432/airline_ticketing_db` | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `KAFKA_BROKER` | Yes | `localhost:9092` | Kafka broker for a local Node process |
| `JWT_SECRET` | Yes | long random string | Signs and verifies 24-hour JWTs |
| `PORT` | No | `3001` | Express port; defaults to `3001` |

### Kafka address by context

| Where the code runs | Broker address |
|---|---|
| Local Node.js backend/consumer | `localhost:9092` |
| Inside Docker | `kafka:29092` |

The Docker Compose file advertises both listeners. Use `localhost:9092` for the
processes you start with `node`.

---

## Demo accounts

All seeded accounts use password **`Password123!`**.

| Passenger | Email | Profile | Priority | Exit row |
|---|---|---|---:|---|
| Rahul Sharma | `rahul@example.com` | Standard adult | 0 | Allowed |
| Shanti Patel | `shanti@example.com` | Senior (70) + Silver | 48 | Restricted |
| Arjun Mehta | `arjun@example.com` | Accessibility + Gold | 45 | Restricted |
| Anya Kapoor | `anya@example.com` | Toddler (≤5) | 35 | Restricted |

Shanti and Arjun receive green aisle recommendations (aisle, non-exit, available).
The UI also exposes one-click persona login for Rahul, Shanti, and Arjun.

---

## Booking lifecycle

### 1. Search

`GET /api/flights/search` calls `calculate_dynamic_price()` for economy, business,
and first class. Prices are computed live from seat occupancy and departure time.

### 2. Seat map

`GET /api/seats/:flightId` returns all 120 physical seats. The backend:

1. Reads seat rows from PostgreSQL.
2. Builds `hold:{seat_id}` keys for all seats.
3. Calls one `MGET` for all hold keys.
4. Adds `is_held`, `held_by_me`, `is_recommended`, and `is_restricted`.
5. Returns the priority calculation for the current passenger (or guest).

### 3. Hold

`POST /api/seats/hold` requires a JWT and atomically runs:

```text
SET hold:{seatId} "{passengerId}:{timestamp}" EX 600 NX
```

- `NX` means “only set if the key does not exist.”
- `EX 600` means the hold expires automatically in 10 minutes.
- If another passenger already holds the seat, the API returns **409**.
- The API also rejects reserved seats (**409**) and restricted exit rows (**400**).

### 4. Confirm

`POST /api/bookings` requires a JWT and a Redis hold owned by that passenger.
The backend uses a **dedicated pool client**:

```text
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE
SELECT ... FROM seat_map WHERE seat_id = $1 AND flight_id = $2 FOR UPDATE
SELECT calculate_dynamic_price($1, $2)
UPDATE seat_map SET is_reserved = TRUE
INSERT INTO bookings (... price_snapshot ...)
COMMIT
DEL hold:{seatId}
publish booking.created to Kafka
```

Key safety properties:

- The hold must belong to the requester, or the API returns **403**.
- If the hold is missing/expired, the API returns **409**.
- If the seat is already reserved, the API returns **409**.
- If PostgreSQL raises serialization failure `40001`, the API returns **409**.
- `price_snapshot` is written as JSONB and preserves the exact price breakdown.
- The seat row lock prevents two transactions from both reserving the seat.

### 5. Confirmation

The frontend stores the booking payload in `sessionStorage` under
`aero_last_booking` and renders the boarding pass. Refreshing the confirmation
page in the same tab restores it; a new tab/direct URL without that state shows the
empty-state page.

### 6. Cancel

`PATCH /api/bookings/:id/cancel` requires the booking owner and:

1. Locks the booking row.
2. Sets `status = 'cancelled'`.
3. Sets `seat_map.is_reserved = FALSE`.
4. Fires `trg_promote_waitlist` synchronously.
5. Commits.
6. Publishes `booking.cancelled`.

The trigger promotes the highest-priority, earliest-added waiting passenger for
the freed flight + class to `pending_confirmation`.

---

## API reference

**Base URL:** `http://localhost:3001/api`

**Authentication:** protected endpoints require:

```http
Authorization: Bearer <JWT>
```

JWTs expire after **24 hours** and contain:

```json
{
  "passenger_id": 1,
  "email": "rahul@example.com",
  "full_name": "Rahul Sharma",
  "loyalty_tier": "none",
  "dob": "1995-06-15",
  "accessibility": false
}
```

### Status codes

| Code | Meaning |
|---|---|
| `200` | Successful read, hold, release, or cancellation |
| `201` | Booking created |
| `400` | Missing/invalid input, bad flight ID, exit-row restriction, already cancelled |
| `401` | Missing, malformed, invalid, or expired JWT; bad login |
| `403` | Hold or booking belongs to another passenger |
| `404` | Flight, seat, booking, or route not found |
| `409` | Hold conflict, seat reserved, no active hold, duplicate email, serialization conflict |
| `500` | Unexpected database/Redis/server error |
| `503` | Health check degraded: PostgreSQL or Redis unavailable |

Error responses use:

```json
{ "error": "Human-readable message" }
```

Serialization failures may also include:

```json
{
  "error": "Concurrency conflict: ...",
  "code": "SERIALIZATION_FAILURE"
}
```

---

### `GET /health`

No authentication.

**200 — healthy**

```json
{
  "status": "healthy",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "services": {
    "postgres": "connected",
    "redis": "connected"
  }
}
```

**503 — degraded**

```json
{
  "status": "degraded",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "services": {
    "postgres": "connected",
    "redis": "error: connect ECONNREFUSED ..."
  }
}
```

---

### `POST /auth/register`

Creates a passenger and returns a JWT.

**Body**

```json
{
  "full_name": "New Passenger",
  "email": "new@example.com",
  "password": "Password123!",
  "dob": "1995-06-15",
  "passport_num": "N1234567",
  "loyalty_tier": "none",
  "accessibility": false
}
```

Required: `full_name`, `email`, `password`, `dob`.

`passport_num`, `loyalty_tier`, and `accessibility` are optional. The UI
registration form intentionally does not collect `passport_num`.

**201**

```json
{
  "message": "Registration successful",
  "token": "eyJ...",
  "user": {
    "passenger_id": 5,
    "full_name": "New Passenger",
    "email": "new@example.com",
    "dob": "1995-06-15",
    "passport_num": null,
    "loyalty_tier": "none",
    "accessibility": false,
    "created_at": "..."
  }
}
```

**Errors**

| Code | Cause |
|---|---|
| `400` | Missing required fields |
| `409` | Email already exists |

Passwords are hashed with `bcryptjs` (10 salt rounds) before insertion.

---

### `POST /auth/login`

**Body**

```json
{
  "email": "rahul@example.com",
  "password": "Password123!"
}
```

**200**

```json
{
  "message": "Login successful",
  "token": "eyJ...",
  "user": {
    "passenger_id": 1,
    "full_name": "Rahul Sharma",
    "email": "rahul@example.com",
    "dob": "1995-06-15",
    "passport_num": "N1234567",
    "loyalty_tier": "none",
    "accessibility": false
  }
}
```

**Errors**

| Code | Cause |
|---|---|
| `400` | Missing email or password |
| `401` | Unknown email or wrong password |

---

### `GET /flights/airports`

No authentication.

**200**

```json
[
  { "iata_code": "BLR", "city": "Bengaluru", "country": "India" },
  { "iata_code": "BOM", "city": "Mumbai", "country": "India" },
  { "iata_code": "DEL", "city": "New Delhi", "country": "India" }
]
```

Seeded airports: `BOM`, `DEL`, `BLR`, `HYD`, `DXB`, `SIN`.

---

### `GET /flights/search`

No authentication. All query parameters are optional.

| Query | Example | Notes |
|---|---|---|
| `origin` | `BOM` | Case-insensitive; trimmed and uppercased |
| `destination` | `DEL` | Case-insensitive; trimmed and uppercased |
| `date` | `2026-08-20` | Compared with `DATE(departure_time)` |

**Examples**

```http
GET /api/flights/search
GET /api/flights/search?origin=BOM&destination=DEL
GET /api/flights/search?origin=DEL&destination=SIN&date=2026-08-20
```

**200**

Returns an array of flight objects:

```json
[
  {
    "flight_id": 1,
    "flight_number": "AI-101",
    "origin": "BOM",
    "origin_city": "Mumbai",
    "origin_country": "India",
    "destination": "DEL",
    "destination_city": "New Delhi",
    "destination_country": "India",
    "departure_time": "2026-08-20T...",
    "arrival_time": "2026-08-20T...",
    "base_price": "4200.00",
    "total_seats": 120,
    "status": "scheduled",
    "economy_price": "4200.00",
    "business_price": "4200.00",
    "first_price": "4200.00",
    "available_seats": 119
  }
]
```

Notes:

- `economy_price`, `business_price`, and `first_price` are computed by the
  database function and returned as PostgreSQL numeric strings.
- `available_seats` counts **all unreserved classes** for the flight.
- The seed reserves seat `6C` on flight 1, so a fresh seed shows `119`.
- No match returns `200 []`, not `404`.

---

### `GET /flights/:id`

No authentication.

**200** — one flight object with the same fields as the search result.

**Errors**

| Code | Cause |
|---|---|
| `400` | `id` is not a number |
| `404` | Flight not found |

---

### `GET /seats/:flightId`

Authentication is **optional**. Guests receive the map without personalized
recommendations. An invalid token is treated as a guest, not rejected.

**200**

```json
{
  "flight_id": 1,
  "total_seats": 120,
  "user_priority": {
    "score": 48,
    "qualifiesForSpecialSeating": true,
    "cannotTakeExitRow": true
  },
  "seats": [
    {
      "seat_id": 1,
      "flight_id": 1,
      "row_num": 1,
      "seat_letter": "A",
      "class": "first",
      "is_aisle": false,
      "is_window": true,
      "is_exit_row": false,
      "is_reserved": false,
      "is_held": false,
      "held_by_me": false,
      "is_recommended": false,
      "is_restricted": false
    }
  ]
}
```

Seat fields:

| Field | Meaning |
|---|---|
| `is_reserved` | Permanently booked in PostgreSQL |
| `is_held` | A Redis hold exists |
| `held_by_me` | The hold belongs to the current JWT |
| `is_recommended` | Priority aisle seat, non-exit, currently free |
| `is_restricted` | Exit row forbidden for the current profile |
| `is_aisle` / `is_window` | Physical seat type |
| `is_exit_row` | Row 10 in the seeded layout |

**Errors**

| Code | Cause |
|---|---|
| `400` | Invalid flight ID |
| `404` | No seats found for that flight |

---

### `POST /seats/hold`

Requires authentication.

**Body**

```json
{ "seatId": 1 }
```

**200**

```json
{
  "message": "Seat held successfully for 10 minutes",
  "seat_id": 1,
  "flight_id": 1,
  "ttl_seconds": 600
}
```

**Errors**

| Code | Cause |
|---|---|
| `400` | Missing `seatId`; restricted exit row |
| `401` | Missing/invalid JWT |
| `404` | Seat does not exist |
| `409` | Seat permanently reserved, or already held (including by the same user) |

The Redis value is:

```text
"{passengerId}:{epochMilliseconds}"
```

The same user cannot hold the same seat twice because the key already exists.

---

### `DELETE /seats/hold/:seatId`

Requires authentication.

**200 — own hold released**

```json
{
  "message": "Seat hold released successfully",
  "seat_id": 1
}
```

**200 — no hold**

```json
{
  "message": "Hold already expired or does not exist."
}
```

Release is idempotent. A non-existent hold returns 200, not 404.

**403 — another passenger's hold**

```json
{
  "error": "You can only release your own seat holds."
}
```

---

### `POST /bookings`

Requires authentication and an active hold owned by the same passenger.

**Body**

```json
{
  "flightId": 1,
  "seatId": 1
}
```

The frontend also sends `seatClass`; the backend ignores it because the class is
read from `seat_map`.

**201**

```json
{
  "message": "Booking confirmed successfully!",
  "pnr": "BK7A9F",
  "booking": {
    "booking_id": 2,
    "passenger_id": 1,
    "flight_id": 1,
    "seat_id": 1,
    "booking_ref": "BK7A9F",
    "status": "confirmed",
    "final_price": "4200.00",
    "price_snapshot": {
      "base_price": 4200,
      "final_price": 4200,
      "cabin_class": "first",
      "timestamp": "2026-01-01T00:00:00.000Z"
    },
    "booked_at": "2026-01-01T00:00:00.000Z"
  }
}
```

Notes:

- `final_price` is a PostgreSQL `DECIMAL`, so the JSON value is usually a string.
- `price_snapshot` is JSONB and contains numeric values.
- The PNR is six characters from an unambiguous alphabet (no `0`, `O`, `1`, `I`).
- The seat is marked reserved and the Redis hold is deleted in the same flow.

**Errors**

| Code | Cause |
|---|---|
| `400` | Missing `flightId` or `seatId` |
| `401` | Missing/invalid JWT |
| `403` | Hold belongs to another passenger |
| `404` | Seat is not on the specified flight |
| `409` | No active hold, seat already reserved, or serialization conflict |

The transaction is rolled back on failure. The Redis hold is not deleted by a
failed transaction; the user can release it or wait for TTL expiry.

---

### `GET /bookings/mine`

Requires authentication.

**200** — array of joined booking rows:

```json
[
  {
    "booking_id": 1,
    "booking_ref": "PNR101",
    "status": "confirmed",
    "final_price": "4200.00",
    "price_snapshot": {
      "base_price": 4200,
      "demand_mult": 1,
      "time_mult": 1,
      "final_price": 4200
    },
    "booked_at": "...",
    "flight_id": 1,
    "flight_number": "AI-101",
    "origin": "BOM",
    "origin_city": "Mumbai",
    "destination": "DEL",
    "destination_city": "New Delhi",
    "departure_time": "...",
    "arrival_time": "...",
    "seat_id": 33,
    "row_num": 6,
    "seat_letter": "C",
    "seat_class": "economy"
  }
]
```

Bookings are scoped to `req.user.passenger_id`; ordering is newest first.

---

### `PATCH /bookings/:id/cancel`

Requires authentication and ownership.

**200**

```json
{
  "message": "Booking cancelled successfully. Seat has been released.",
  "booking_id": 1,
  "waitlist_promoted": {
    "waitlist_id": 1,
    "passenger_id": 2,
    "flight_id": 1,
    "status": "pending_confirmation"
  }
}
```

If no one was waiting:

```json
{
  "message": "Booking cancelled successfully. Seat has been released.",
  "booking_id": 2,
  "waitlist_promoted": null
}
```

**Errors**

| Code | Cause |
|---|---|
| `400` | Invalid booking ID; booking already cancelled |
| `401` | Missing/invalid JWT |
| `404` | Booking not found or not owned by the requester |

The booking row is retained with `status = 'cancelled'`; it is not deleted.
The seat becomes available again.

---

### Unknown routes

```json
{
  "error": "Route not found: GET /api/example"
}
```

HTTP status: `404`.

---

## Database design

### Entity relationships

```mermaid
erDiagram
    AIRPORTS ||--o{ FLIGHTS : "origin / destination"
    FLIGHTS ||--o{ SEAT_MAP : "has 120 seats"
    PASSENGERS ||--o{ BOOKINGS : "makes"
    FLIGHTS ||--o{ BOOKINGS : "for"
    SEAT_MAP ||--o{ BOOKINGS : "assigned to"
    FLIGHTS ||--o{ PRICING_RULES : "priced by"
    PASSENGERS ||--o{ WAITLIST : "joins"
    FLIGHTS ||--o{ WAITLIST : "queues for"
```

### Enum types

| Type | Values |
|---|---|
| `flight_status` | `scheduled`, `boarding`, `departed`, `arrived`, `cancelled` |
| `seat_class` | `economy`, `business`, `first` |
| `loyalty_tier` | `none`, `silver`, `gold` |
| `booking_status` | `confirmed`, `cancelled`, `waitlisted` |
| `waitlist_status` | `waiting`, `pending_confirmation`, `expired` |

Enums are used instead of free-form strings so invalid values are rejected by
PostgreSQL itself.

### `airports`

| Column | Type | Notes |
|---|---|---|
| `iata_code` | `CHAR(3)` | Primary key; natural key such as `BOM` |
| `city` | `VARCHAR(100)` | Not null |
| `country` | `VARCHAR(100)` | Not null |

Seed: **6 airports** — Mumbai, New Delhi, Bengaluru, Hyderabad, Dubai, Singapore.

### `flights`

| Column | Type | Notes |
|---|---|---|
| `flight_id` | `SERIAL` | Primary key |
| `flight_number` | `VARCHAR(10)` | Not null |
| `origin` | `CHAR(3)` | FK → `airports.iata_code` |
| `destination` | `CHAR(3)` | FK → `airports.iata_code` |
| `departure_time` | `TIMESTAMPTZ` | Not null |
| `arrival_time` | `TIMESTAMPTZ` | Not null |
| `base_price` | `DECIMAL(10,2)` | Floor price before dynamic multipliers |
| `total_seats` | `INT` | Default 120 |
| `status` | `flight_status` | Default `scheduled` |

Constraints:

- Origin and destination must differ.
- Arrival must be after departure.
- `base_price > 0`.
- `total_seats > 0`.
- `UNIQUE (flight_number, origin, departure_time)`.

Index:

```sql
CREATE INDEX idx_flights_route
ON flights (origin, destination, departure_time);
```

This supports the most common query: “flights from X to Y on date D.”

Seed flights:

| ID | Flight | Route | Base price | Departure |
|---|---|---|---|---|
| 1 | `AI-101` | BOM → DEL | ₹4,200 | +3.5 days |
| 2 | `6E-205` | DEL → BLR | ₹4,800 | +5 days |
| 3 | `UK-812` | BLR → HYD | ₹3,100 | +1.5 days |
| 4 | `EK-501` | BOM → DXB | ₹14,500 | +7 days |
| 5 | `SQ-403` | DEL → SIN | ₹22,000 | +10 days |

Departure times are relative to `NOW()` at seed time, so time-based pricing works
whenever you run the seed.

### `seat_map`

| Column | Type | Notes |
|---|---|---|
| `seat_id` | `SERIAL` | Primary key |
| `flight_id` | `INT` | FK → `flights.flight_id`, `ON DELETE CASCADE` |
| `row_num` | `INT` | 1–20 |
| `seat_letter` | `CHAR(1)` | A–F |
| `class` | `seat_class` | `first`, `business`, or `economy` |
| `is_aisle` | `BOOLEAN` | C/D |
| `is_window` | `BOOLEAN` | A/F |
| `is_exit_row` | `BOOLEAN` | Row 10 |
| `is_reserved` | `BOOLEAN` | Permanent booking truth |

Constraints and indexes:

- `UNIQUE (flight_id, row_num, seat_letter)`.
- `idx_seat_flight_class` on `(flight_id, class, is_reserved)`.

Seeded layout per flight:

| Rows | Class | Seats |
|---|---|---:|
| 1–2 | first | 12 |
| 3–5 | business | 18 |
| 6–20 | economy | 90 |
| **Total** | | **120** |

5 flights × 120 seats = **600 rows**.

### `passengers`

| Column | Type | Notes |
|---|---|---|
| `passenger_id` | `SERIAL` | Primary key |
| `full_name` | `VARCHAR(100)` | Not null |
| `email` | `VARCHAR(150)` | Not null, unique |
| `password_hash` | `VARCHAR(255)` | bcrypt hash |
| `dob` | `DATE` | Drives age/priority |
| `passport_num` | `VARCHAR(20)` | Optional |
| `loyalty_tier` | `loyalty_tier` | Default `none` |
| `accessibility` | `BOOLEAN` | Default false |
| `created_at` | `TIMESTAMPTZ` | Default `NOW()` |

Seed: **4 passengers** — Rahul, Shanti, Arjun, Anya.

### `bookings`

| Column | Type | Notes |
|---|---|---|
| `booking_id` | `SERIAL` | Primary key |
| `passenger_id` | `INT` | FK → `passengers` |
| `flight_id` | `INT` | FK → `flights` |
| `seat_id` | `INT` | FK → `seat_map` |
| `booking_ref` | `VARCHAR(6)` | Unique PNR |
| `status` | `booking_status` | Default `confirmed` |
| `final_price` | `DECIMAL(10,2)` | Actual charged amount |
| `price_snapshot` | `JSONB` | Immutable price record |
| `booked_at` | `TIMESTAMPTZ` | Default `NOW()` |

Important index:

```sql
CREATE UNIQUE INDEX uq_bookings_seat_confirmed
ON bookings (seat_id)
WHERE status = 'confirmed';
```

This partial unique index allows historical cancelled bookings to remain while
preventing two confirmed bookings for the same seat.

### `pricing_rules`

| Column | Type | Notes |
|---|---|---|
| `rule_id` | `SERIAL` | Primary key |
| `flight_id` | `INT` | FK → `flights`; `NULL` means global |
| `class` | `seat_class` | Cabin class |
| `demand_threshold_pct` | `FLOAT` | `> 0` and `<= 100` |
| `multiplier` | `FLOAT` | `>= 1.0`; never a discount |

Seed: **45 rules** — 5 flights × 3 classes × 3 thresholds.

Thresholds:

| Occupancy | Multiplier |
|---|---:|
| ≥ 50% | 1.2× |
| ≥ 75% | 1.5× |
| ≥ 90% | 2.0× |

The procedure picks the highest threshold that is less than or equal to current
occupancy.

### `waitlist`

| Column | Type | Notes |
|---|---|---|
| `waitlist_id` | `SERIAL` | Primary key |
| `passenger_id` | `INT` | FK → `passengers`, cascade delete |
| `flight_id` | `INT` | FK → `flights`, cascade delete |
| `class` | `seat_class` | Requested cabin |
| `priority_score` | `FLOAT` | Higher wins |
| `status` | `waitlist_status` | Default `waiting` |
| `added_at` | `TIMESTAMPTZ` | FIFO tiebreaker |

Constraint:

```sql
UNIQUE (passenger_id, flight_id, class)
```

A passenger can only wait once per flight + class.

### Stored function: `calculate_dynamic_price(p_flight_id, p_class)`

Returns `DECIMAL(10,2)`.

Algorithm:

1. Read `flights.base_price`; return `NULL` if the flight does not exist.
2. Count total seats for that flight and class.
3. Count reserved seats for that flight and class.
4. Compute occupancy percentage.
5. Find the pricing rule with the highest `demand_threshold_pct` that is
   `<= occupancy`; default multiplier is `1.0`.
6. Compute days until departure.
7. If departure is less than **3 days** away, apply a **1.3×** time multiplier.
8. Return `ROUND(base_price × demand_multiplier × time_multiplier, 2)`.

Called by:

- `backend/routes/flights.js` for every class in search/detail.
- `backend/routes/bookings.js` inside the booking transaction.

Because the function runs inside the transaction, the price at confirmation is
authoritative and is stored in `price_snapshot`.

### Trigger: `trg_promote_waitlist`

Fires `AFTER UPDATE OF status ON bookings`, for each row.

It only acts when:

```text
OLD.status = 'confirmed' AND NEW.status = 'cancelled'
```

Then it:

1. Finds the cancelled seat's class.
2. Finds the top `waiting` entry for the same flight and class.
3. Orders by `priority_score DESC, added_at ASC`.
4. Updates that entry to `pending_confirmation`.
5. Returns `NEW` so the cancellation UPDATE proceeds.

The Kafka consumer receives the cancellation event and logs the promoted passenger,
but it does not modify `waitlist` itself. The PostgreSQL trigger is the only
mechanism that changes waitlist state.

### Seed data summary

| Table | Seeded rows |
|---|---:|
| `airports` | 6 |
| `flights` | 5 |
| `seat_map` | 600 |
| `passengers` | 4 |
| `pricing_rules` | 45 |
| `bookings` | 1 (`PNR101`, Rahul, flight 1, seat 6C / `seat_id` 33) |
| `waitlist` | 1 (Shanti, flight 1, economy, score 48) |

The seeded booking + waitlist pair exists specifically so cancellation and
trigger promotion can be demonstrated immediately.

---

## Redis design

### Key format

```text
hold:{seat_id}
```

### Value format

```text
"{passengerId}:{epochMilliseconds}"
```

Example:

```text
hold:15 = "1:1760000000000"
```

### Write

```text
SET hold:{seatId} "{passengerId}:{Date.now()}" EX 600 NX
```

- `EX 600` → 10-minute TTL.
- `NX` → only one writer can create the key.
- If the key exists, the API returns **409**.

### Batch read

The seat-map endpoint builds all 120 keys and performs **one** `MGET`:

```js
const holdKeys = seats.map((seat) => `hold:${seat.seat_id}`);
const holdValues = await redis.mget(...holdKeys);
```

This avoids 120 separate Redis round trips.

### Ownership

`held_by_me` is true when the first segment of the hold value equals the JWT's
`passenger_id`. A different passenger cannot release the hold; the API returns
**403**.

### Release

`DELETE /seats/hold/:seatId`:

- Deletes the key if the requester owns it.
- Returns 200 if no key exists.
- Returns 403 if another passenger owns it.

### Inspect

```powershell
docker exec -it airline-ticket-reservation-system-redis redis-cli KEYS "hold:*"
docker exec -it airline-ticket-reservation-system-redis redis-cli GET "hold:15"
docker exec -it airline-ticket-reservation-system-redis redis-cli TTL "hold:15"
docker exec -it airline-ticket-reservation-system-redis redis-cli EXISTS "hold:15"
```

### Clear holds only

```powershell
docker exec -it airline-ticket-reservation-system-redis redis-cli EVAL "local k=redis.call('keys','hold:*'); for i=1,#k do redis.call('del',k[i]) end; return #k" 0
```

> `KEYS` is acceptable for a local demo. A production system should use `SCAN`.

---

## Kafka design

### Topics

| Topic | Producer | Consumer | When published |
|---|---|---|---|
| `bookings` | Express API | `consumer.js` | After booking commit |
| `cancellations` | Express API | `consumer.js` | After cancellation commit |
| `seat-holds` | Express API | `consumer.js` | After a Redis hold succeeds |

### Consumer group

```text
airline-reservation-consumer-group
```

The consumer subscribes with `fromBeginning: false`, so it processes only new
events after it starts. It handles `SIGINT`/`SIGTERM` and disconnects gracefully.

In this project the consumer is an **audit/logging worker**: it prints event
details in the terminal but does not write to PostgreSQL. Waitlist promotion is
performed exclusively by the synchronous `trg_promote_waitlist` trigger.

### Event payloads

**`bookings`**

```json
{
  "type": "booking.created",
  "bookingId": 2,
  "pnr": "BK7A9F",
  "passengerId": 1,
  "flightId": 1,
  "seatId": 1,
  "price": "4200.00",
  "class": "first",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

**`cancellations`**

```json
{
  "type": "booking.cancelled",
  "bookingId": 1,
  "flightId": 1,
  "seatId": 33,
  "cancelledAt": "2026-01-01T00:00:00.000Z",
  "promotedWaitlist": {
    "waitlist_id": 1,
    "passenger_id": 2,
    "flight_id": 1,
    "status": "pending_confirmation"
  }
}
```

`promotedWaitlist` is `null` when no one was waiting.

**`seat-holds`**

```json
{
  "type": "seat.held",
  "seatId": 1,
  "flightId": 1,
  "passengerId": 1,
  "heldAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-01T00:10:00.000Z"
}
```

### Inspect topics

```powershell
docker exec -it airline-ticket-reservation-system-kafka kafka-topics `
  --bootstrap-server localhost:29092 --list

docker exec -it airline-ticket-reservation-system-kafka kafka-console-consumer `
  --bootstrap-server localhost:29092 `
  --topic bookings `
  --from-beginning `
  --max-messages 3
```

### Important behavior

- If the producer cannot connect at startup, the **HTTP API still runs**.
- Events are dropped with:

  ```text
  [Kafka Warning] Producer not connected. Dropping event for topic "..."
  ```

- To recover, start Kafka and **restart the backend**.
- There is no transactional outbox. A booking can commit even if publishing the
  Kafka event fails; PostgreSQL remains the source of truth.

---

## Frontend guide

### Routes

| Route | Page | Purpose |
|---|---|---|
| `/` | `Home` | Search form, personas, architecture showcase |
| `/flights` | `Flights` | Search results, prices, available seats |
| `/seats/:flightId` | `SeatMap` | 120-seat cabin, priority recommendations, Redis holds, timer |
| `/checkout` | `Checkout` | Review itinerary, passenger, live fare, confirm |
| `/confirmation` | `Confirmation` | Boarding pass, PNR, print |
| `/my-bookings` | `MyBookings` | Booking history, cancellation, waitlist promotion |
| `/auth` | `Auth` | Login, registration, demo personas |
| `*` | `Home` | Unknown paths fall back to the home page |

### State ownership: `BookingContext.jsx`

The context owns:

- JWT token and user object.
- Selected flight and seat.
- `holdExpiry` timestamp for the local countdown.
- One active toast notification.
- `loginUser`, `quickLoginAs`, `logoutUser`.
- `setHeldSeat`, `clearHeldSeat`, `clearHoldLocal`.

Hold-safety rules:

1. A hold is released with the token that created it.
2. Switching identity releases the previous passenger's hold first.
3. Seat switching is refused if the old hold cannot be released, so two holds do
   not coexist under one account.
4. `403`/`404` during release are treated as stale ownership and local state is
   cleared.
5. The toast timer compares notification IDs, so an older timeout cannot dismiss
   a newer toast.

### Persistence keys

| Storage | Key | Contents |
|---|---|---|
| `localStorage` | `aero_token` | JWT |
| `localStorage` | `aero_user` | Passenger object |
| `sessionStorage` | `aero_last_booking` | Last confirmed booking payload for the boarding pass |

### API client

`frontend/src/api.js` uses relative `/api/...` URLs. Vite proxies `/api` to
`http://localhost:3001`, so no CORS configuration is needed in development.

It normalizes the seat-map envelope:

```js
{
  flightId,
  totalSeats,
  userPriority,
  seats
}
```

This protects components from older bare-array responses.

### Design system

The UI uses the **“Runway Deck”** visual language documented in
`frontend/DESIGN.md`:

- Deep navy/ink background with cyan, amber, and emerald accents.
- Airport-departure-board typography and monospaced seat/PNR labels.
- Glass panels, grid atmosphere, and subtle scanline motion.
- Responsive cabin grid and fixed hold bar.
- Print styles for the boarding pass.
- Reduced-motion support.

### Motion

`frontend/src/lib/motion.js` uses:

- `IntersectionObserver` for reveal-on-scroll.
- Native Web Animations API (`element.animate`) for one-shot motion.
- `prefers-reduced-motion` checks.

There is **no animation library dependency**.

### Accessibility

- Skip link to `#main`.
- Semantic headings and landmarks.
- `aria-live` toast.
- Keyboard-operable seat buttons, tabs, and menus.
- Visible focus states.
- `aria-pressed` on persona cards.
- Reduced-motion fallback.
- Print-specific CSS.

### Hold countdown behavior

The browser timer starts at **10:00** when a hold is created.

If the page is refreshed:

- The selected seat state is lost.
- The seat still appears as held in the map.
- Clicking it resumes the hold locally and **restarts the countdown at 10:00**.
- The Redis key keeps its original TTL.

Therefore the server is authoritative. If the real Redis key expired but the
browser still shows time, confirming returns **409** and the checkout page shows a
booking error. This is a documented limitation of the current API, not a crash.

---

## Business rules

### Priority score

| Condition | Points |
|---|---:|
| Age ≥ 65 | +40 |
| Age ≤ 5 | +35 |
| `accessibility = TRUE` | +30 |
| `loyalty_tier = 'gold'` | +15 |
| `loyalty_tier = 'silver'` | +8 |

`qualifiesForSpecialSeating` is true when score ≥ 40.

Recommended seats:

```text
is_aisle = TRUE
AND is_exit_row = FALSE
AND is_reserved = FALSE
AND is_held = FALSE
AND priority score >= 40
```

### Exit-row restriction

Passengers who are seniors, toddlers, or have accessibility needs cannot be
assigned exit-row seats. The seat map marks them `is_restricted` and the API
rejects a hold with **400** even if the UI is bypassed.

### Dynamic pricing

- Occupancy is calculated per flight + class.
- Thresholds: 50% → 1.2×, 75% → 1.5×, 90% → 2.0×.
- Flights less than 3 days away get an additional **1.3×** time multiplier.
- The highest matching demand threshold wins.
- `price_snapshot` preserves the final price at booking time.

### Waitlist

- Priority order: highest `priority_score`, then earliest `added_at`.
- A cancellation promotes the top matching entry to `pending_confirmation`.
- The trigger runs synchronously; Kafka is an asynchronous audit/notification channel only.
- There is no separate “confirm waitlist offer” endpoint in this MVP.

### Concurrency

- Redis `SET NX` prevents most simultaneous hold attempts.
- PostgreSQL `SERIALIZABLE` + `SELECT ... FOR UPDATE` prevents two bookings from
  both committing.
- SQLSTATE `40001` is converted to HTTP **409** with
  `code: "SERIALIZATION_FAILURE"`.
- The load test demonstrates exactly one winner out of 50.

---

## Verification and testing

### What is automated?

| Layer | Automated? | Notes |
|---|---|---|
| Database | No test framework | Verify with SQL queries below |
| Backend | No unit/integration suite | Verify with HTTP calls below |
| Frontend | No test script | Verify manually in the browser |
| Lint | Yes | `npm run lint` |
| Build | Yes | `npm run build` |
| Concurrency | Yes | `node scripts/load_test.js` |

### Static checks

```powershell
cd .\frontend
npm run lint
npm run build
```

Expected:

- Lint: **0 errors** (8 non-blocking warnings may appear).
- Build: exit code **0**, `dist/` created.

### Health check

```powershell
Invoke-RestMethod http://localhost:3001/api/health | ConvertTo-Json -Depth 5
```

Expected: `status = healthy`, both services `connected`.

### API smoke path

```powershell
$API = 'http://localhost:3001/api'

$Login = Invoke-RestMethod -Method Post -Uri "$API/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email='rahul@example.com'; password='Password123!' } | ConvertTo-Json)

$H = @{ Authorization = "Bearer $($Login.token)" }

# Pick a free first-class seat to avoid consuming the seeded economy waitlist
$Map = Invoke-RestMethod -Uri "$API/seats/1" -Headers $H
$Seat = $Map.seats |
  Where-Object { $_.class -eq 'first' -and -not $_.is_reserved -and -not $_.is_held } |
  Select-Object -First 1

$Hold = Invoke-RestMethod -Method Post -Uri "$API/seats/hold" -Headers $H `
  -ContentType 'application/json' `
  -Body (@{ seatId = $Seat.seat_id } | ConvertTo-Json)

$Book = Invoke-RestMethod -Method Post -Uri "$API/bookings" -Headers $H `
  -ContentType 'application/json' `
  -Body (@{ flightId = 1; seatId = $Seat.seat_id } | ConvertTo-Json)

$Book.pnr
$Book.booking.final_price

Invoke-RestMethod -Uri "$API/bookings/mine" -Headers $H |
  Select-Object booking_ref,status,final_price,row_num,seat_letter

Invoke-RestMethod -Method Patch `
  -Uri "$API/bookings/$($Book.booking.booking_id)/cancel" `
  -Headers $H |
  ConvertTo-Json -Depth 6
```

Expected:

- Hold: `ttl_seconds = 600`.
- Booking: HTTP 201, six-character PNR.
- `mine`: the new booking appears.
- Cancel: HTTP 200, `waitlist_promoted` is `null` for a first-class seat.

### API behavior matrix

| Test | Expected |
|---|---|
| `GET /health` | 200 healthy |
| Login with correct password | 200 token |
| Login with wrong password | 401 |
| Register duplicate email | 409 |
| Register missing `dob` | 400 |
| `GET /flights/airports` | 200, 6 airports |
| `GET /flights/search` with no params | 200, 5 flights |
| `GET /flights/search?origin=BOM&destination=DEL` | 200, flight `AI-101` |
| Same origin/destination | 200 `[]` |
| Unknown route search | 200 `[]` |
| `GET /flights/999` | 404 |
| `GET /flights/abc` | 400 |
| `GET /seats/1` with Rahul | 120 seats, priority 0 |
| `GET /seats/1` as guest | 200, no recommendations |
| `GET /seats/1` as Shanti | priority 48, exit row restricted |
| `GET /seats/1` as Arjun | priority 45, exit row restricted |
| `POST /seats/hold` free seat | 200, ttl 600 |
| Hold same seat again | 409 |
| Second passenger holds it | 409 |
| Second passenger releases it | 403 |
| Release own hold | 200 |
| Release non-existent hold | 200 |
| Book without hold | 409 |
| Book another passenger's hold | 403 |
| Book with own hold | 201 |
| Rebook reserved seat | 409 |
| `GET /bookings/mine` | 200, scoped list |
| Cancel own booking | 200 |
| Cancel same booking again | 400 |
| Cancel another passenger's booking | 404 |
| Hold exit row as Shanti | 400 |
| Missing `seatId` | 400 |
| Unknown seat ID | 404 |
| Hold flight 2 seat, book on flight 1 | 404 |
| Missing/invalid JWT | 401 |
| Unknown route | 404 |

### Database verification

```powershell
docker exec -it airline-ticket-reservation-system-postgres psql -U admin -d airline_ticketing_db -c @"
SELECT COUNT(*) AS airports FROM airports;
SELECT COUNT(*) AS flights FROM flights;
SELECT COUNT(*) AS seats FROM seat_map;
SELECT COUNT(*) AS passengers FROM passengers;

SELECT b.booking_id, b.booking_ref, b.status, b.final_price,
       s.row_num || s.seat_letter AS seat
FROM bookings b
JOIN seat_map s ON s.seat_id = b.seat_id
ORDER BY b.booking_id;
"@
```

Expected fresh seed:

```text
airports  = 6
flights   = 5
seats     = 600
passengers = 4
booking 1 = PNR101, confirmed, 6C
```

Check the trigger and function:

```sql
SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'bookings'::regclass AND NOT tgisinternal;

SELECT calculate_dynamic_price(5, 'economy');
```

Expected:

- `trg_promote_waitlist`
- Flight 5 economy: `22000.00` on a fresh seed.

Check indexes:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('flights', 'seat_map')
ORDER BY tablename, indexname;
```

Expected:

- `idx_flights_route`
- `idx_seat_flight_class`

### Dynamic pricing test

Flight 5 has 90 economy seats, base ₹22,000, and is 10 days out.

```sql
-- 45 / 90 = 50% -> 1.2x
UPDATE seat_map SET is_reserved = TRUE
WHERE seat_id IN (
  SELECT seat_id FROM seat_map
  WHERE flight_id = 5 AND class = 'economy' AND is_reserved = FALSE
  ORDER BY seat_id LIMIT 45
);

SELECT calculate_dynamic_price(5, 'economy');  -- 26400.00

-- Add 23 -> 68 / 90 = 75.5% -> 1.5x
UPDATE seat_map SET is_reserved = TRUE
WHERE seat_id IN (
  SELECT seat_id FROM seat_map
  WHERE flight_id = 5 AND class = 'economy' AND is_reserved = FALSE
  ORDER BY seat_id LIMIT 23
);

SELECT calculate_dynamic_price(5, 'economy');  -- 33000.00

-- Add 13 -> 81 / 90 = 90% -> 2.0x
UPDATE seat_map SET is_reserved = TRUE
WHERE seat_id IN (
  SELECT seat_id FROM seat_map
  WHERE flight_id = 5 AND class = 'economy' AND is_reserved = FALSE
  ORDER BY seat_id LIMIT 13
);

SELECT calculate_dynamic_price(5, 'economy');  -- 44000.00

-- Reset
UPDATE seat_map SET is_reserved = FALSE WHERE flight_id = 5;
```

### Waitlist trigger test

On a **fresh seed**:

1. Log in as Rahul.
2. `GET /bookings/mine` and find `PNR101` (`booking_id = 1`).
3. Cancel it.
4. Expect `waitlist_promoted.passenger_id = 2` and status
   `pending_confirmation`.

Verify:

```sql
SELECT waitlist_id, passenger_id, status
FROM waitlist
WHERE flight_id = 1;
```

Expected: `pending_confirmation`.

The cancelled seat is `seat_id 33` (6C), and it becomes available again.

### Redis verification

```powershell
docker exec -it airline-ticket-reservation-system-redis redis-cli KEYS "hold:*"
docker exec -it airline-ticket-reservation-system-redis redis-cli GET "hold:15"
docker exec -it airline-ticket-reservation-system-redis redis-cli TTL "hold:15"
docker exec -it airline-ticket-reservation-system-redis redis-cli EXISTS "hold:15"
```

Expected lifecycle:

- Hold created → key exists, TTL 0–600.
- Booking committed → key deleted.
- Hold released → key deleted.
- Hold expired → key gone.
- Another passenger's release attempt → 403 and key remains.

### Kafka verification

```powershell
docker exec -it airline-ticket-reservation-system-kafka kafka-topics `
  --bootstrap-server localhost:29092 --list
```

Then keep the consumer terminal visible while you hold, book, and cancel. Expected
consumer output includes booking, cancellation, and seat-hold event blocks.

### Concurrency test

`scripts/load_test.js` targets **flight 1, seat 15**. It fires **50** simultaneous
booking requests for that one seat.

#### Reset seat 15 first

```powershell
docker exec -it airline-ticket-reservation-system-postgres psql -U admin -d airline_ticketing_db -c @"
DELETE FROM bookings WHERE seat_id = 15;
UPDATE seat_map SET is_reserved = FALSE WHERE seat_id = 15;
"@

docker exec -it airline-ticket-reservation-system-redis redis-cli DEL "hold:15"
```

#### Run

```powershell
node scripts/load_test.js
```

Expected:

```text
Total Requests:         50
Successful Bookings:    1  (Expected: 1)
Prevented Collisions:   49 (Expected: 49)
Other Statuses:         0
PASS: ACID SERIALIZABLE ISOLATION & REDIS HOLDS VERIFIED!
```

If you see **0 successes**, seat 15 was already reserved or held. Reset and rerun.
If you see **more than 1**, that is a critical concurrency failure — capture the
database rows and backend logs immediately.

#### Reset after

```sql
DELETE FROM bookings WHERE seat_id = 15;
UPDATE seat_map SET is_reserved = FALSE WHERE seat_id = 15;
```

```powershell
docker exec -it airline-ticket-reservation-system-redis redis-cli DEL "hold:15"
```

### UI checklist

| Area | Check |
|---|---|
| Home | Airports load; BOM→DEL defaults; same-airport error; swap button |
| Flights | Results, prices, available seats, empty state |
| Seat map | 120 seats; guest prompt; persona login; recommendations; exit-row restrictions |
| Hold | 10:00 timer; selected state; fixed bar; release; switch seat |
| Refresh | Held seat still visible; click to resume; timer restarts at 10:00 |
| Expiry | Timer reaches 0; toast; seat becomes available |
| Checkout | No-selection guard; itinerary; passenger; live fare; confirm button |
| Confirmation | PNR, amount, print; refresh restores from `sessionStorage` |
| My bookings | List; inline cancel confirmation; cancelled state; promotion card |
| Auth | Login; duplicate register error; new registration auto-login; personas |
| Persona switch | Old hold released; selection cleared; new priority applied |
| Logout | Hold released; session cleared; guest seat map |
| Responsive | 375px width; cabin grid scrolls; fixed bar does not cover controls |
| Keyboard | Skip link; seat selection; Escape closes menus; focus visible |
| Reduced motion | Content appears immediately; no long animation |
| Unknown route | Falls back to Home (per current router) |

### Manual edge cases

| Scenario | Expected |
|---|---|
| Hold expires in Redis, then book | 409 no active hold |
| UI timer expires | Selection clears; seat available |
| Two tabs, same user | One hold; second tab can resume it |
| Two users, same seat | One hold; other gets 409 |
| Rapid double-click Confirm | One booking; button disables |
| Exit row as Shanti/Arjun/Anya | 400 and UI restriction |
| Seat from another flight | 404; transaction rolls back |
| Cancel already cancelled | 400 |
| Cancel another user's booking | 404 |
| Backend offline | UI error toast/banner; no crash |
| Redis offline | Health 503; seat/booking APIs fail |
| PostgreSQL offline | Health 503; DB APIs fail |
| Kafka offline at startup | API runs; events dropped; restart backend after Kafka |
| Sold-out flight | `available_seats = 0`; no selectable seats |
| Price snapshot | `final_price` matches snapshot at booking time |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED 3001` | Backend not running | `node backend/server.js` from repo root |
| `EADDRINUSE :3001` | Old backend process | Stop the old process or change `PORT` |
| `password authentication failed` | Wrong DB password | Set `PGPASSWORD='project@123'` |
| `relation "seat_map" does not exist` | Schema not applied | Run `schema.sql` against `airline_ticketing_db` |
| `ECONNREFUSED 6379` | Redis container stopped | `docker start airline-ticket-reservation-system-redis` |
| Kafka producer error | Kafka not ready | Wait 30–60s; check `docker ps`; restart backend |
| Events never appear | Consumer started from latest offset | Generate a new event; check consumer terminal |
| CORS error | Wrong origin | Open `http://localhost:5173` |
| 401 after login | Token not stored/sent | Check `aero_token`; log in again |
| 409 on every hold | Seat held or reserved | Check Redis/DB; choose another seat |
| 409 on booking | Hold expired or owned by another user | Re-hold and book as the same user |
| 403 on release | Wrong passenger | Use the token that created the hold |
| 400 on exit row | Profile restriction | Expected for Shanti/Arjun/Anya |
| `npm run dev` missing module | Frontend deps absent | `cd frontend; npm install` |
| Blank page | Frontend runtime error | Check browser Console and Vite terminal |
| Load test 0 successes | Seat 15 blocked | Reset booking, `seat_map`, and `hold:15` |
| Waitlist not promoted | Seed not fresh / already promoted | Reseed, then cancel PNR101 |
| Price not changing | Wrong flight/class or seats not reserved | Check `seat_map` and `pricing_rules` |
| `EXPLAIN` shows Seq Scan | Only 5 flights; planner prefers seq scan | `SET enable_seqscan = off;` for the index demo |

---

## Reset and cleanup

### Reset one test seat

```sql
DELETE FROM bookings WHERE seat_id = 15;
UPDATE seat_map SET is_reserved = FALSE WHERE seat_id = 15;
```

```powershell
docker exec -it airline-ticket-reservation-system-redis redis-cli DEL "hold:15"
```

### Reset flight 5 pricing tests

```sql
UPDATE seat_map SET is_reserved = FALSE WHERE flight_id = 5;
```

### Clear all holds

```powershell
docker exec -it airline-ticket-reservation-system-redis redis-cli EVAL "local k=redis.call('keys','hold:*'); for i=1,#k do redis.call('del',k[i]) end; return #k" 0
```

### Full database reset

```powershell
$env:PGPASSWORD='project@123'
psql -h localhost -U admin -d airline_ticketing_db -f .\backend\db\schema.sql
psql -h localhost -U admin -d airline_ticketing_db -f .\backend\db\procedures.sql
psql -h localhost -U admin -d airline_ticketing_db -f .\backend\db\seed.sql
```

This restores:

- 6 airports, 5 flights, 600 seats.
- 4 demo passengers.
- 45 pricing rules.
- PNR101 and Shanti's waitlist entry.

### Browser storage reset

```js
localStorage.removeItem('aero_token');
localStorage.removeItem('aero_user');
sessionStorage.removeItem('aero_last_booking');
location.reload();
```

### Stop services

```powershell
docker compose stop
```

Remove containers but keep volumes:

```powershell
docker compose down
```

Remove containers **and** the database/Redis volumes:

```powershell
docker compose down -v
```

---

## Known limitations

These are intentional scope boundaries or current behavior — useful to know
before a demo:

1. **Browser timer is not the source of truth.** Resuming a hold after a refresh
   restarts the local countdown at 10:00; the Redis TTL may be shorter. Confirming
   after the real expiry returns 409.
2. **`/api/health` excludes Kafka.** The backend can run with a disconnected
   producer and drop events; restart the backend after Kafka is available.
3. **No automated test suite.** The repo does not include Jest/Vitest/Playwright.
   Use the manual/API/SQL checks above.
4. **No transactional outbox.** A database commit can succeed even if the Kafka
   publish fails. PostgreSQL remains authoritative.
5. **Malformed `date` query values can produce 500.** The backend does not
   validate date format; the UI date input prevents normal users from sending one.
6. **Unknown frontend routes render Home**, not a dedicated 404 page.
7. **Release is idempotent.** Deleting a non-existent hold returns 200.
8. **`GET /seats/:flightId` treats an invalid JWT as a guest**, because
   authentication is optional for that endpoint.
9. **The load test mutates seat 15.** Reset it before rerunning.
10. **Seed times are relative.** Flight 1 is 3.5 days out at seed time; after
    enough elapsed time, its time-based multiplier can change.
11. **Waitlist promotion has no confirmation endpoint.** The status changes to
    `pending_confirmation`, but there is no API to accept/decline the offer.
12. **`passport_num` is optional** and the UI registration form does not collect it.
13. **No refresh tokens, rate limiting, or HTTPS.** This is a local coursework
    application, not a production identity system.

---

## Security notes

Implemented:

- Passwords hashed with `bcryptjs` (10 rounds).
- JWT signed with `JWT_SECRET`, 24-hour expiry.
- Protected routes use the `verify` middleware.
- SQL uses parameterized queries (`$1`, `$2`, ...), not string interpolation.
- Hold ownership is checked before release/booking.
- Booking ownership is checked before cancellation.
- CORS allows `http://localhost:5173` and `http://127.0.0.1:5173`.
- `.env` is excluded from Git.

Not implemented / production checklist:

- Replace the default `JWT_SECRET`.
- Use HTTPS.
- Add rate limiting and account lockout.
- Add email verification and password reset.
- Add refresh-token rotation.
- Add request validation/schema validation for all inputs.
- Add centralized structured logging and metrics.
- Add automated integration tests and a CI pipeline.
- Use a secrets manager instead of a local `.env`.
- Restrict pgAdmin/Kafka/PostgreSQL ports to trusted networks.
- Add a transactional outbox or idempotent event publisher if Kafka delivery must
  be guaranteed.

The seeded credentials are intentionally public for demos. Do not reuse them.

---

## Course demo script

A concise 8-minute demonstration:

1. **Search** — Home → BOM → DEL. Point out live prices from
   `calculate_dynamic_price()`.
2. **Priority seating** — Sign in as Shanti (48 pts) and Arjun (45 pts). Show green
   aisle recommendations and disabled exit rows.
3. **Hold** — Select a seat. Show the 10-minute timer and the Redis key.
4. **Confirm** — Book the seat. Show the PNR and boarding pass.
5. **Database** — In pgAdmin/psql, show `bookings`, `seat_map.is_reserved`, and the
   `price_snapshot` JSONB.
6. **Waitlist trigger** — Reseed, log in as Rahul, cancel PNR101, show Shanti's
   waitlist status become `pending_confirmation`.
7. **Kafka** — Show the consumer terminal printing `booking.created` and
   `booking.cancelled`.
8. **Concurrency** — Reset seat 15, run `node scripts/load_test.js`, show exactly
   one success and 49 conflicts.

Optional: run `EXPLAIN ANALYZE` with `enable_seqscan` off to demonstrate the
composite index.

---

## Further reading

- [`AGENTS.md`](./AGENTS.md) — project context and conventions for AI coding agents.
- [`frontend/DESIGN.md`](./frontend/DESIGN.md) — “Runway Deck” design system.
- [`backend/db/schema.sql`](./backend/db/schema.sql) — tables, enums, constraints, indexes.
- [`backend/db/procedures.sql`](./backend/db/procedures.sql) — pricing function and waitlist trigger.
- [`backend/db/seed.sql`](./backend/db/seed.sql) — demo data.
- [`scripts/load_test.js`](./scripts/load_test.js) — 50-request concurrency test.
- [`report-proof/how to run.txt`](./report-proof/how%20to%20run.txt) — original run notes.

---

**AeroReserve** — book the seat; let the database keep the promise.
