// =============================================================================
// pages/Home.jsx — Flight search + system architecture showcase
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { SAMPLE_PERSONAS, useBooking } from '../BookingContext';
import { useReveal } from '../lib/motion';
import {
  ArrowRightIcon,
  BoltIcon,
  CalendarIcon,
  CheckIcon,
  DatabaseIcon,
  SearchIcon,
  ShieldIcon,
  SparkleIcon,
  SwapIcon,
  TicketIcon,
  UsersIcon,
} from '../components/Icons';

const TICKER_ITEMS = [
  ['PostgreSQL 16', 'SERIALIZABLE booking'],
  ['Redis 8', 'SET NX EX 600'],
  ['Kafka 7.6', 'booking.created'],
  ['PL/pgSQL', 'calculate_dynamic_price()'],
  ['Trigger', 'trg_promote_waitlist'],
  ['Index', 'idx_flights_route'],
  ['Cabin', '120 seats · 20 rows'],
];

const FEATURES = [
  {
    Icon: DatabaseIcon,
    title: 'Dynamic pricing in the database',
    body: (
      <>
        Every search calls <code>calculate_dynamic_price()</code>, a PL/pgSQL function
        that blends cabin occupancy thresholds with time-to-departure. The price you see
        is computed by PostgreSQL, not by the browser.
      </>
    ),
  },
  {
    Icon: ShieldIcon,
    title: 'ACID core, serializable',
    body: (
      <>
        Confirmation runs in a dedicated <code>SERIALIZABLE</code> transaction with
        <code> SELECT … FOR UPDATE</code>, an immutable <code>price_snapshot JSONB</code>,
        and a single retry-safe commit path for code <code>40001</code>.
      </>
    ),
  },
  {
    Icon: BoltIcon,
    title: 'Redis holds, Kafka events',
    body: (
      <>
        A seat is yours for ten minutes through an atomic <code>SET NX</code>. After
        commit, <code>booking.created</code> streams to Kafka and the consumer handles
        waitlist promotion independently of the API request.
      </>
    ),
  },
];

export default function Home() {
  const [airports, setAirports] = useState([]);
  const [airportsError, setAirportsError] = useState(null);
  const [origin, setOrigin] = useState('BOM');
  const [destination, setDestination] = useState('DEL');
  const [date, setDate] = useState('');
  const [formError, setFormError] = useState(null);
  const [airportsLoading, setAirportsLoading] = useState(true);
  const [personaLoading, setPersonaLoading] = useState(null);

  const { quickLoginAs, user, showNotification } = useBooking();
  const navigate = useNavigate();
  const revealRef = useReveal([airports.length]);

  useEffect(() => {
    const controller = new AbortController();
    setAirportsLoading(true);

    api
      .getAirports({ signal: controller.signal })
      .then((data) => {
        setAirports(Array.isArray(data) ? data : []);
        setAirportsError(null);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setAirportsError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAirportsLoading(false);
      });

    return () => controller.abort();
  }, []);

  const cityLabel = useMemo(() => {
    const byCode = new Map(airports.map((airport) => [airport.iata_code, airport]));
    return (code) => byCode.get(code)?.city || code;
  }, [airports]);

  const swapRoute = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  const handleSearch = (event) => {
    event.preventDefault();
    setFormError(null);

    if (!origin || !destination) {
      setFormError('Choose both an origin and a destination.');
      return;
    }
    if (origin === destination) {
      setFormError('Origin and destination must be different airports.');
      return;
    }

    const params = new URLSearchParams({ origin, destination });
    if (date) params.set('date', date);
    navigate(`/flights?${params.toString()}`);
  };

  const handlePersona = async (email) => {
    setPersonaLoading(email);
    try {
      await quickLoginAs(email);
    } catch (err) {
      showNotification(err.message || 'Could not sign in as that persona.', 'error');
    } finally {
      setPersonaLoading(null);
    }
  };

  return (
    <div className="container page" ref={revealRef}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero__copy">
          <span className="hero__kicker">
            <span className="dot" aria-hidden="true" />
            Database systems project · live booking engine
          </span>

          <h1 className="hero__title">
            Book the seat.
            <br />
            <span className="accent">The database keeps the promise.</span>
          </h1>

          <p className="hero__lead">
            Search real flights, hold a seat in Redis for ten minutes, and watch a
            serializable PostgreSQL transaction turn it into a confirmed boarding pass —
            with Kafka carrying the event to everything downstream.
          </p>

          <div className="hero__stats">
            <div className="stat">
              <div className="stat__value">
                120<span> seats</span>
              </div>
              <div className="stat__label">Per aircraft</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                10<span> min</span>
              </div>
              <div className="stat__label">Atomic Redis hold</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                1<span> winner</span>
              </div>
              <div className="stat__label">Under concurrency</div>
            </div>
            <div className="stat">
              <div className="stat__value">
                {airports.length || 6}
                <span> airports</span>
              </div>
              <div className="stat__label">Seeded routes</div>
            </div>
          </div>
        </div>

        <div className="search-panel">
          <div className="search-panel__head">
            <span className="search-panel__title">
              <SearchIcon size={15} />
              Find a departure
            </span>
            <span className="badge badge-confirmed">Live pricing</span>
          </div>

          <form onSubmit={handleSearch} noValidate>
            <div className="search-grid">
              <div className="field">
                <label className="field__label" htmlFor="origin-airport">
                  From
                </label>
                <select
                  id="origin-airport"
                  className="select"
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                  disabled={airportsLoading}
                >
                  {airports.length === 0 && <option value="BOM">BOM — Mumbai</option>}
                  {airports.map((airport) => (
                    <option key={airport.iata_code} value={airport.iata_code}>
                      {airport.iata_code} — {airport.city}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="destination-airport">
                  To
                </label>
                <select
                  id="destination-airport"
                  className="select"
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  disabled={airportsLoading}
                >
                  {airports.length === 0 && <option value="DEL">DEL — Delhi</option>}
                  {airports.map((airport) => (
                    <option key={airport.iata_code} value={airport.iata_code}>
                      {airport.iata_code} — {airport.city}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="search-swap"
                onClick={swapRoute}
                aria-label="Swap origin and destination"
                title="Swap origin and destination"
              >
                <SwapIcon size={14} />
              </button>

              <div className="field field--wide">
                <label className="field__label" htmlFor="departure-date">
                  <CalendarIcon size={12} />
                  Departure date <span className="dim">(optional)</span>
                </label>
                <input
                  id="departure-date"
                  className="input"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>

              <div className="field field--wide">
                <button type="submit" className="btn btn--primary btn--lg btn--block">
                  <SearchIcon size={16} />
                  Search available flights
                </button>
              </div>
            </div>

            {formError && (
              <div className="field__hint" style={{ color: 'var(--red)', marginTop: 10 }} role="alert">
                {formError}
              </div>
            )}

            {airportsError && (
              <div className="field__hint" style={{ color: 'var(--amber)', marginTop: 10 }} role="status">
                Airport list unavailable — {airportsError}
              </div>
            )}

            <div className="search-note">
              <CheckIcon size={13} />
              {origin && destination
                ? `${cityLabel(origin)} → ${cityLabel(destination)} · prices returned by PostgreSQL`
                : 'Choose a route to see live fares'}
            </div>
          </form>
        </div>
      </section>

      {/* ── Live systems ticker ──────────────────────────────────────────── */}
      <div className="ticker" aria-hidden="true">
        <div className="ticker__track">
          {[0, 1].map((copy) => (
            <div className="ticker__set" key={copy}>
              {TICKER_ITEMS.map(([label, value]) => (
                <span className="ticker__item" key={`${copy}-${label}`}>
                  <i />
                  {label} <b>{value}</b>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Personas ─────────────────────────────────────────────────────── */}
      <section className="section" data-reveal>
        <div className="section-head">
          <div>
            <span className="eyebrow">Course demo</span>
            <h2 className="mt-8">One click, three seating profiles</h2>
            <p>
              Priority score is derived from date of birth, accessibility, and loyalty tier.
              Sign in as a persona to see the recommendation engine change the cabin.
            </p>
          </div>
          {user && (
            <span className="badge badge-info">
              <UsersIcon size={11} />
              Active: {user.full_name}
            </span>
          )}
        </div>

        <div className="persona-grid">
          {SAMPLE_PERSONAS.map((persona) => {
            const active = user?.email === persona.email;
            return (
              <button
                key={persona.email}
                type="button"
                className={`persona-card${active ? ' is-active' : ''}`}
                onClick={() => handlePersona(persona.email)}
                disabled={personaLoading !== null}
                aria-pressed={active}
              >
                <span className="persona-card__top">
                  <span className="persona-card__avatar" aria-hidden="true">
                    {persona.name
                      .split(' ')
                      .map((part) => part[0])
                      .join('')}
                  </span>
                  <span className="badge badge-priority">{persona.badge}</span>
                </span>
                <span className="persona-card__name">{persona.name}</span>
                <span className="persona-card__role">{persona.role}</span>
                <span className="persona-card__score">
                  <SparkleIcon size={12} />
                  {personaLoading === persona.email ? 'Signing in…' : persona.priority}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Architecture features ────────────────────────────────────────── */}
      <section className="section" data-reveal>
        <div className="section-head">
          <div>
            <span className="eyebrow">Under the hood</span>
            <h2 className="mt-8">Three systems, one committed booking</h2>
            <p>Each layer owns a different guarantee — and each one is demonstrable live.</p>
          </div>
        </div>

        <div className="grid grid--3">
          {FEATURES.map(({ Icon, title, body }) => (
            <article className="card feature-card" key={title}>
              <span className="feature-card__icon">
                <Icon size={18} />
              </span>
              <h4>{title}</h4>
              <p>{body}</p>
            </article>
          ))}
        </div>

        <div className="tech-strip">
          <span className="tech-pill">
            <i /> SERIALIZABLE
          </span>
          <span className="tech-pill">
            <i /> SET NX EX 600
          </span>
          <span className="tech-pill">
            <i /> price_snapshot JSONB
          </span>
          <span className="tech-pill">
            <i /> Kafka consumer
          </span>
          <span className="tech-pill">
            <i /> Waitlist trigger
          </span>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="panel panel--pad panel--accent" data-reveal>
        <div className="between wrap gap-16">
          <div>
            <span className="eyebrow">Ready when you are</span>
            <h3 className="mt-8" style={{ fontSize: '1.35rem' }}>
              Pick a route, hold a seat, confirm the transaction.
            </h3>
            <p className="fs-sm mt-8" style={{ maxWidth: '58ch' }}>
              The whole flow runs against the live API — no mock data, no simulated writes.
            </p>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() =>
              navigate(`/flights?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`)
            }
          >
            <TicketIcon size={16} />
            Browse departures
            <ArrowRightIcon size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
