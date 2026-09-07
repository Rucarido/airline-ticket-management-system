---
name: airline-reservation-system
description: >
  Workspace skill for the Airline Ticket Reservation System project.
  Provides complete project context, architecture decisions, coding conventions,
  and step-by-step guidance for implementing each backend route, database object,
  and frontend component. Activate when working on any file in this project.
---

# Airline Ticket Reservation System — Workspace Skill

## Quick Reference

| What | Where | Status |
|------|-------|--------|
| All infra config | `docker-compose.yml` | ✅ Done |
| Environment secrets | `.env` | ✅ Done |
| Backend dependencies | root `package.json` / `node_modules/` | ✅ Installed |
| Frontend dependencies | `frontend/package.json` / `frontend/node_modules/` | ✅ Installed |
| DB schema | `backend/db/schema.sql` | 🔲 Not written yet |
| Stored procedures + triggers | `backend/db/procedures.sql` | 🔲 Not written yet |
| Seed data | `backend/db/seed.sql` | 🔲 Not written yet |
| Backend entry + helpers | `backend/server.js`, `db.js`, `redis.js`, `kafka.js` | 🔲 Not written yet |
| Auth routes | `backend/routes/auth.js` | 🔲 Not written yet |
| Flight search | `backend/routes/flights.js` | 🔲 Not written yet |
| Seat map + holds | `backend/routes/seats.js` | 🔲 Not written yet |
| Booking ACID core | `backend/routes/bookings.js` | 🔲 Not written yet |
| Kafka consumer | `backend/consumer/consumer.js` | 🔲 Not written yet |
| Frontend pages | `frontend/src/pages/` | 🔲 Not written yet |
| Concurrency test | `scripts/load_test.js` | 🔲 Not written yet |

---

## Architecture & Integration

### Service Communication Map

```
React (5173) ──HTTP──► Express (3001) ──SQL──► PostgreSQL (5432)
                              │                        ▲
                              ├──Redis MGET/SET──► Redis (6379)     pgAdmin 4 (8081)
                              │                                         │ browses ▼
                              └──Kafka produce──► Kafka (9092)   PostgreSQL (5432)
                                                      │
                                         consumer.js ◄┘
                                               │
                                               └──SQL──► PostgreSQL (5432)
```

### Infrastructure — Docker Services (all started by `docker-compose up -d`)

| Service | Container | Port | What you use it for |
|---------|-----------|------|--------------------|
| PostgreSQL | `airline-ticket-reservation-system-postgres` | 5432 | Stores all permanent data |
| Redis | `airline-ticket-reservation-system-redis` | 6379 | Temporary seat holds |
| Kafka | `airline-ticket-reservation-system-kafka` | 9092 | Event bus |
| Zookeeper | `airline-ticket-reservation-system-zookeeper` | 2181 | Kafka coordinator (auto-managed) |
| **pgAdmin 4** | `airline-ticket-reservation-system-pgadmin` | **8081** | **DB GUI — browse tables, run SQL, screenshot for report** |

**pgAdmin credentials**: `http://localhost:8081` → `project123@gmail.com` / `project@123`  
**First-time server registration** (do once after `docker-compose up -d`):
- Right-click Servers → Register → Server
- Name: `Airline DB`
- Connection tab → Host: `postgres` (the Docker service name, NOT `localhost`)
- Port: `5432`, Username: `admin`, Password: `project@123`
- Save → you'll see all tables appear in the left panel

### The Booking Transaction (Exact Sequence)
This is the most critical flow in the system. Follow this order precisely:
1. Verify JWT (`req.user` must exist)
2. `redis.get('hold:{seatId}')` — must exist and start with `passengerId + ':'`
3. `const client = await pool.connect()`
4. `await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')`
5. `SELECT seat_id FROM seat_map WHERE seat_id=$1 AND is_reserved=FALSE FOR UPDATE`
   - 0 rows → ROLLBACK → return 409
6. `SELECT calculate_dynamic_price($1, $2) AS price`
7. `UPDATE seat_map SET is_reserved=TRUE WHERE seat_id=$1`
8. `INSERT INTO bookings (..., price_snapshot=$1::jsonb) RETURNING *`
9. `await client.query('COMMIT')`
10. `await redis.del('hold:{seatId}')`
11. `await publishEvent('bookings', { type: 'booking.created', ... })`
12. `res.status(201).json({ pnr, booking })`

In `catch`: if `err.code === '40001'` → 409 serialization failure; else `next(err)`  
In `finally`: `client.release()` — ALWAYS, even on error

---

## Environment Variables

```
DATABASE_URL=postgres://admin:project@123@localhost:5432/airline_ticketing_db
REDIS_URL=redis://localhost:6379
KAFKA_BROKER=localhost:9092
JWT_SECRET=airline-super-secret-jwt-key-change-in-production
PORT=3001
```

---

## Database Objects

### Tables (7)
`airports`, `flights`, `seat_map`, `passengers`, `bookings`, `pricing_rules`, `waitlist`

### Indexes
- `idx_flights_route` ON `flights(origin, destination, departure_time)`
- `idx_seat_flight_class` ON `seat_map(flight_id, class, is_reserved)`

### Stored Procedure
`calculate_dynamic_price(p_flight_id INT, p_class VARCHAR) RETURNS DECIMAL(10,2)`
- Checks occupancy % against `pricing_rules` thresholds
- Also applies time-based multiplier (< 3 days to departure = higher price)

### Trigger
`trg_promote_waitlist` — AFTER UPDATE OF status ON bookings FOR EACH ROW  
Fires when status changes `'confirmed'` → `'cancelled'`; promotes top waitlist entry

---

## Redis Key Convention

```
Key:   hold:{seat_id}
Value: "{passengerId}:{Date.now()}"
TTL:   600 seconds
Flag:  NX  (only set if key doesn't already exist — atomic)
```

Batch check for seat map: `redis.mget(...allHoldKeys)` — ONE call for all 120 seats.

---

## Kafka Topics

| Topic | Published by | Consumed by | Trigger |
|-------|-------------|-------------|---------|
| `bookings` | `routes/bookings.js` | `consumer.js` | After COMMIT succeeds |
| `cancellations` | `routes/bookings.js` | `consumer.js` | After cancellation UPDATE |
| `seat-holds` | `routes/seats.js` | `consumer.js` | After Redis SET NX succeeds |

---

## Priority Score Formula

```
age >= 65         → +40
age <= 5          → +35
accessibility     → +30
gold loyalty      → +15
silver loyalty    → +8

Score >= 40: recommend aisle seats where is_exit_row = FALSE
Score < 40:  no special recommendation
```

---

## Critical Coding Rules

1. **Root package.json is CommonJS** — use `require()`/`module.exports` in all backend files
2. **Frontend is ES Modules** — use `import`/`export` in all `.jsx` files
3. **Export `verify` middleware** from `routes/auth.js` as `module.exports.verify = ...`
4. **Use `pool.connect()` for transactions** — not `pool.query()` (which auto-commits)
5. **Use `redis.mget()` for seat map** — not a loop of `redis.get()`
6. **Kafka producer connects in `server.js`** before `app.listen()` is called
7. **Consumer runs as a separate process** — `node backend/consumer/consumer.js` in its own terminal
8. **`price_snapshot` column is JSONB** — pass as `JSON.stringify({...})`, cast as `::jsonb` in SQL
9. **Seed loop covers all 5 flights** — use a DO block that loops `fid IN 1..5`

---

## How to Start Each Session

```bash
# 1. Start / verify Docker services
docker-compose up -d
docker ps
# Must show 5 containers as "Up":
#   postgres | redis | kafka | zookeeper | pgadmin

# 2. Open pgAdmin (DB monitoring window — keep this open all session)
#    http://localhost:8081  →  project123@gmail.com / project@123
#    Expand: Airline DB → Schemas → public → Tables

# 3. Start backend (Terminal 1)
node backend/server.js

# 4. Start consumer (Terminal 2)
node backend/consumer/consumer.js

# 5. Start frontend (Terminal 3)
cd frontend && npm run dev
```

---

## Verification Checkpoints by Stage

### DB (Stages 2-5)

**Option A — psql (terminal)**:
```sql
\dt                                          -- 7 tables
\di                                          -- 2 indexes
\df                                          -- calculate_dynamic_price function
\dS bookings                                 -- trg_promote_waitlist trigger
SELECT COUNT(*) FROM seat_map;              -- 600
SELECT calculate_dynamic_price(1,'economy'); -- changes with occupancy
```

**Option B — pgAdmin 4 (GUI — recommended for screenshots)**:
- Tables → right-click any table → **View/Edit Data → All Rows** (no SQL needed)
- Functions → `calculate_dynamic_price` should be listed under Schemas → public → Functions
- Triggers → expand `bookings` table → Triggers → `trg_promote_waitlist` should appear
- **Query Tool** (Tools menu or F5): paste and run any SQL — results appear as a grid you can screenshot
- **Visual Explain**: run a query in Query Tool → click the graph icon → see the query plan as a tree diagram (great for EXPLAIN ANALYZE report screenshots)

### Backend (Stages 6-11)
```
node server.js → prints "Backend running" + "Kafka producer connected"
POST /api/auth/register → 201 + JWT
GET /api/flights/search → array with economy_price / business_price
POST /api/seats/hold → Redis key exists (redis-cli GET hold:42)
POST /api/bookings → 201 + PNR, seat is_reserved=TRUE in DB
PATCH /api/bookings/:id/cancel → waitlist promoted (pgAdmin + consumer terminal)
```

### Frontend (Stages 12-15)
```
npm run dev → localhost:5173, no console errors
Search → Flights → SeatMap: seat turns blue, timer starts, Redis hold exists
Second browser tab: same seat appears orange (held)
Timer hits 0: seat resets, Redis key gone
Full flow: search → hold → checkout → PNR displayed
```

### Demo (Stage 16)
```
node scripts/load_test.js → "Successful: 1, Hold conflicts: ~99"
SELECT COUNT(*) FROM bookings WHERE seat_id=42; → 1
```

---

## References

| Topic | URL |
|-------|-----|
| PostgreSQL stored procedures | https://www.postgresqltutorial.com/postgresql-plpgsql/postgresql-create-function/ |
| PostgreSQL triggers | https://www.postgresqltutorial.com/postgresql-triggers/creating-first-trigger-postgresql/ |
| EXPLAIN ANALYZE | https://use-the-index-luke.com/sql/explain-plan/postgresql/operations |
| node-postgres transactions | https://node-postgres.com/features/transactions |
| ioredis docs | https://github.com/redis/ioredis#readme |
| KafkaJS getting started | https://kafka.js.org/docs/getting-started |
| React Router v7 | https://reactrouter.com/en/main/start/tutorial |
| Confluent Docker Compose | https://docs.confluent.io/platform/current/quickstart/ce-docker-quickstart.html |
| **pgAdmin 4 Query Tool** | https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html |
| pgAdmin server registration | https://www.pgadmin.org/docs/pgadmin4/latest/server_dialog.html |
