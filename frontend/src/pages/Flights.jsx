// =============================================================================
// pages/Flights.jsx — Flight results with live, database-computed fares
// =============================================================================
// Requests are abortable: a fast second search can never be overwritten by the
// slower first response.
// =============================================================================
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import { useBooking } from '../BookingContext';
import { useReveal } from '../lib/motion';
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  PlaneIcon,
  RefreshIcon,
  SeatIcon,
  TicketIcon,
} from '../components/Icons';

const inr = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const timeOf = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const dateOf = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

function FlightSkeleton() {
  return (
    <div className="flight-card" aria-hidden="true">
      <div>
        <div className="skeleton" style={{ width: 160, height: 14, marginBottom: 14 }} />
        <div className="skeleton" style={{ width: '70%', height: 40 }} />
      </div>
      <div className="skeleton" style={{ width: 160, height: 48 }} />
    </div>
  );
}

export default function Flights() {
  const [searchParams] = useSearchParams();
  const [flights, setFlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { setSelectedFlight } = useBooking();
  const navigate = useNavigate();
  const revealRef = useReveal([flights.length, loading]);

  const origin = searchParams.get('origin');
  const destination = searchParams.get('destination');
  const date = searchParams.get('date');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    api
      .searchFlights({ origin, destination, date }, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setFlights(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!active || err.name === 'AbortError') return;
        setFlights([]);
        setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [origin, destination, date, reloadKey]);

  const handleSelectFlight = (flight) => {
    setSelectedFlight(flight);
    navigate(`/seats/${flight.flight_id}`);
  };

  const heading = origin
    ? `${origin} → ${destination || 'Anywhere'}`
    : 'All scheduled departures';

  return (
    <div className="container page" ref={revealRef}>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
        <ArrowLeftIcon size={14} />
        Modify search
      </button>

      <div className="page-head mt-16">
        <div>
          <span className="eyebrow">Step 2 of 4 · Select a departure</span>
          <h1 className="page-title mt-8">{heading}</h1>
          <p className="page-sub">
            {loading
              ? 'Querying PostgreSQL and calculating live fares…'
              : `${flights.length} ${flights.length === 1 ? 'departure' : 'departures'}${
                  date ? ` on ${dateOf(`${date}T00:00:00`)}` : ''
                } · fares computed by calculate_dynamic_price()`}
          </p>
        </div>

        <div className="flow" aria-label="Booking progress">
          <span className="flow__step is-done" data-step="1">
            Search
          </span>
          <span className="flow__sep" aria-hidden="true" />
          <span className="flow__step is-current" data-step="2">
            Flight
          </span>
          <span className="flow__sep" aria-hidden="true" />
          <span className="flow__step" data-step="3">
            Seat
          </span>
          <span className="flow__sep" aria-hidden="true" />
          <span className="flow__step" data-step="4">
            Confirm
          </span>
        </div>
      </div>

      {loading && (
        <div className="flight-list" aria-busy="true" aria-label="Loading flights">
          <FlightSkeleton />
          <FlightSkeleton />
          <FlightSkeleton />
        </div>
      )}

      {!loading && error && (
        <div className="panel panel--pad">
          <div className="error-banner" role="alert">
            <AlertIcon size={18} />
            <div>
              <strong>Could not load departures</strong>
              {error}
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost mt-16"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshIcon size={15} />
            Try again
          </button>
        </div>
      )}

      {!loading && !error && flights.length === 0 && (
        <div className="panel empty-state">
          <span className="empty-state__icon">
            <PlaneIcon size={24} />
          </span>
          <h3>No departures on this route</h3>
          <p className="fs-sm" style={{ maxWidth: '46ch' }}>
            Try BOM → DEL, DEL → BLR, or clear the filters to browse every scheduled
            flight in the seeded dataset.
          </p>
          <div className="row wrap gap-8 mt-12">
            <button type="button" className="btn btn--primary" onClick={() => navigate('/flights')}>
              <TicketIcon size={15} />
              View all flights
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => navigate('/')}>
              Change route
            </button>
          </div>
        </div>
      )}

      {!loading && !error && flights.length > 0 && (
        <div className="flight-list">
          {flights.map((flight) => {
            const soldOut = Number(flight.available_seats) <= 0;
            return (
              <article className="flight-card" key={flight.flight_id} data-reveal>
                <div>
                  <div className="flight-card__head">
                    <span className="flight-card__id">{flight.flight_number}</span>
                    <span className={`badge ${soldOut ? 'badge-cancelled' : 'badge-confirmed'}`}>
                      {soldOut ? 'Sold out' : flight.status || 'scheduled'}
                    </span>
                    <span className="badge badge-info">
                      <SeatIcon size={11} />
                      {flight.available_seats} of {flight.total_seats} open
                    </span>
                  </div>

                  <div className="flight-route">
                    <div className="route-node">
                      <div className="route-node__time">{timeOf(flight.departure_time)}</div>
                      <div className="route-node__code">
                        <b>{flight.origin}</b>
                        <span className="dim">{flight.origin_city}</span>
                      </div>
                      <div className="route-node__date">{dateOf(flight.departure_time)}</div>
                    </div>

                    <div className="route-line" aria-hidden="true">
                      <span className="route-line__plane">
                        <PlaneIcon size={14} strokeWidth={2} />
                      </span>
                      <span className="route-line__label">direct</span>
                    </div>

                    <div className="route-node">
                      <div className="route-node__time">{timeOf(flight.arrival_time)}</div>
                      <div className="route-node__code">
                        <b>{flight.destination}</b>
                        <span className="dim">{flight.destination_city}</span>
                      </div>
                      <div className="route-node__date">{dateOf(flight.arrival_time)}</div>
                    </div>
                  </div>
                </div>

                <div className="flight-card__aside">
                  <div className="price-block">
                    <div className="price-block__label">Economy from</div>
                    <div className="price-block__main">
                      {inr(flight.economy_price)}
                      <small> /seat</small>
                    </div>
                    <div className="class-prices">
                      <span className="class-chip">
                        Biz <b>{inr(flight.business_price)}</b>
                      </span>
                      <span className="class-chip">
                        First <b>{inr(flight.first_price)}</b>
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => handleSelectFlight(flight)}
                    disabled={soldOut}
                    aria-label={
                      soldOut
                        ? `${flight.flight_number} is sold out`
                        : `Select seats on ${flight.flight_number}`
                    }
                  >
                    {soldOut ? 'Sold out' : 'Select seats'}
                    {!soldOut && <ArrowRightIcon size={15} />}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="row wrap gap-16 mt-24 dim fs-xs">
        <span className="row gap-6">
          <ClockIcon size={13} />
          Times shown in your local timezone
        </span>
        <span className="row gap-6">
          <CalendarIcon size={13} />
          {date ? `Filtered to ${date}` : 'All scheduled dates'}
        </span>
      </div>
    </div>
  );
}
