// =============================================================================
// pages/Checkout.jsx — Review, price snapshot, and ACID confirmation
// =============================================================================
// The price shown here is a live estimate from the flight endpoint. The amount
// that is actually charged is `booking.final_price`, computed inside the
// SERIALIZABLE transaction and preserved in price_snapshot JSONB.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useBooking } from '../BookingContext';
import Timer from '../components/Timer';
import { useReveal } from '../lib/motion';
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CreditCardIcon,
  LockIcon,
  ShieldIcon,
  TicketIcon,
  UserIcon,
} from '../components/Icons';

const inr = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

function priceForClass(flight, cabinClass) {
  if (!flight) return null;
  if (cabinClass === 'first') return flight.first_price ?? flight.base_price;
  if (cabinClass === 'business') return flight.business_price ?? flight.base_price;
  return flight.economy_price ?? flight.base_price;
}

const timeOf = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

export default function Checkout() {
  const {
    user,
    token,
    selectedFlight,
    selectedSeat,
    holdExpiry,
    clearHoldLocal,
    showNotification,
  } = useBooking();

  const navigate = useNavigate();
  const revealRef = useReveal([]);

  const [flight, setFlight] = useState(selectedFlight);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [holdExpired, setHoldExpired] = useState(false);
  const expiredOnceRef = useRef(false);

  // Refresh live fares so the review never shows a stale search-result price.
  useEffect(() => {
    if (!selectedFlight?.flight_id) return undefined;

    const controller = new AbortController();
    setPricingLoading(true);

    api
      .getFlightById(selectedFlight.flight_id, { signal: controller.signal })
      .then((fresh) => {
        if (!controller.signal.aborted) setFlight(fresh);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          // Keep the search-result snapshot; the transaction still re-prices.
          setFlight(selectedFlight);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPricingLoading(false);
      });

    return () => controller.abort();
  }, [selectedFlight]);

  const handleTimerExpired = () => {
    if (expiredOnceRef.current) return;
    expiredOnceRef.current = true;

    setHoldExpired(true);
    showNotification(
      'Your hold expired before confirmation. Choose a seat again to continue.',
      'error'
    );
  };

  const goToSeatMap = () => navigate(`/seats/${selectedFlight.flight_id}`);

  const handlePickAnotherSeat = () => {
    clearHoldLocal();
    goToSeatMap();
  };

  const handleConfirmBooking = async () => {
    if (!token) {
      showNotification('Sign in again to confirm this booking.', 'error');
      navigate('/auth', { state: { from: '/checkout' } });
      return;
    }
    if (holdExpired) {
      showNotification('The hold has expired. Select a seat again.', 'error');
      return;
    }

    setBookingLoading(true);
    setBookingError(null);

    try {
      const res = await api.createBooking(
        {
          flightId: flight?.flight_id ?? selectedFlight.flight_id,
          seatId: selectedSeat.seat_id,
          seatClass: selectedSeat.class,
        },
        token
      );

      const payload = {
        booking: res.booking,
        pnr: res.pnr || res.booking?.booking_ref,
        flight,
        seat: selectedSeat,
        savedAt: Date.now(),
      };

      try {
        sessionStorage.setItem('aero_last_booking', JSON.stringify(payload));
      } catch {
        /* private mode — router state still carries the payload */
      }

      // Redis key was deleted by the booking transaction; only local state remains.
      clearHoldLocal();
      showNotification(`Booking confirmed. PNR ${payload.pnr}.`, 'success');
      navigate(`/confirmation?pnr=${encodeURIComponent(payload.pnr || '')}`, {
        state: payload,
        replace: true,
      });
    } catch (err) {
      setBookingError(err.message || 'The booking transaction could not be committed.');
      showNotification(err.message, 'error');
    } finally {
      setBookingLoading(false);
    }
  };

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!selectedFlight || !selectedSeat) {
    return (
      <div className="container container--tight page">
        <div className="panel empty-state">
          <span className="empty-state__icon">
            <TicketIcon size={24} />
          </span>
          <h1 style={{ fontSize: '1.5rem' }}>No active seat selection</h1>
          <p className="fs-sm" style={{ maxWidth: '44ch' }}>
            Pick a departure and hold a seat before opening checkout. Holds last ten
            minutes and are required by the booking endpoint.
          </p>
          <div className="row wrap gap-8 mt-12">
            <Link to="/" className="btn btn--primary">
              Find flights
              <ArrowRightIcon size={15} />
            </Link>
            <Link to="/my-bookings" className="btn btn--ghost">
              My bookings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="container container--tight page">
        <div className="panel empty-state">
          <span className="empty-state__icon">
            <LockIcon size={24} />
          </span>
          <h1 style={{ fontSize: '1.5rem' }}>Sign in to confirm</h1>
          <p className="fs-sm" style={{ maxWidth: '44ch' }}>
            Your seat is held, but the booking transaction needs an authenticated
            passenger. Sign in and return here — the hold stays in Redis for ten minutes.
          </p>
          <Link
            to="/auth"
            state={{ from: '/checkout' }}
            className="btn btn--primary mt-12"
          >
            Sign in
            <ArrowRightIcon size={15} />
          </Link>
        </div>
      </div>
    );
  }

  const seat = selectedSeat;
  const estimatedPrice = priceForClass(flight, seat.class);
  const basePrice = flight?.base_price ?? selectedFlight.base_price;

  return (
    <div className="container container--narrow page" ref={revealRef}>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={goToSeatMap}
      >
        <ArrowLeftIcon size={14} />
        Back to seat map
      </button>

      <div className="page-head mt-16">
        <div>
          <span className="eyebrow">Step 4 of 4 · Confirm</span>
          <h1 className="page-title mt-8">Review &amp; confirm booking</h1>
          <p className="page-sub">
            One serializable transaction reserves the seat, records an immutable price
            snapshot, releases the Redis hold, and publishes the Kafka event.
          </p>
        </div>

        {holdExpiry && !holdExpired && (
          <div style={{ minWidth: 250 }}>
            <Timer expiresAt={holdExpiry} onExpire={handleTimerExpired} />
          </div>
        )}
      </div>

      {(holdExpired || bookingError) && (
        <div className="error-banner mb-20" role="alert">
          <AlertIcon size={18} />
          <div>
            <strong>{holdExpired ? 'Hold expired' : 'Booking not committed'}</strong>
            {holdExpired
              ? 'The ten-minute Redis key is gone. Select a seat again to restart the flow.'
              : bookingError}
            <div className="row wrap gap-8 mt-12">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={holdExpired ? handlePickAnotherSeat : goToSeatMap}
              >
                Pick another seat
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="panel panel--pad mb-16">
        <div className="between wrap gap-8 mb-16">
          <h3>Itinerary &amp; passenger</h3>
          <span className="badge badge-info">
            <ShieldIcon size={11} />
            SERIALIZABLE
          </span>
        </div>

        <div className="review-grid">
          <div className="review-item">
            <div className="review-label">Flight</div>
            <div className="review-value review-value--accent">{flight?.flight_number}</div>
            <div className="fs-xs muted mt-8">
              {flight?.origin} ({flight?.origin_city}) → {flight?.destination} (
              {flight?.destination_city})
            </div>
            <div className="fs-xs dim mt-8">{timeOf(flight?.departure_time)}</div>
          </div>

          <div className="review-item">
            <div className="review-label">Seat</div>
            <div className="review-value">
              Row {seat.row_num}, {seat.seat_letter}
            </div>
            <div className="row wrap gap-6 mt-8">
              <span className={`badge badge-${seat.class}`}>{seat.class}</span>
              <span className="badge badge-info">
                {seat.is_aisle ? 'Aisle' : seat.is_window ? 'Window' : 'Middle'}
              </span>
            </div>
            <div className="fs-xs dim mt-8">
              {seat.is_exit_row ? 'Exit row' : 'Standard row'}
            </div>
          </div>

          <div className="review-item">
            <div className="review-label">Passenger</div>
            <div className="review-value">{user.full_name}</div>
            <div className="fs-xs muted mt-8">{user.email}</div>
            <div className="fs-xs dim mt-8 row gap-6">
              <UserIcon size={12} />
              {user.loyalty_tier && user.loyalty_tier !== 'none'
                ? `${user.loyalty_tier} tier`
                : 'Standard tier'}
            </div>
          </div>
        </div>

        <div className="price-table">
          <div className="price-row">
            <span>Base fare ({seat.class})</span>
            <span>{inr(basePrice)}</span>
          </div>
          <div className="price-row">
            <span>Dynamic demand &amp; proximity multiplier</span>
            <span style={{ color: 'var(--emerald)' }}>
              {pricingLoading ? 'recalculating…' : 'applied in PostgreSQL'}
            </span>
          </div>
          <div className="price-row">
            <span>Taxes &amp; fees</span>
            <span>included</span>
          </div>
          <div className="price-row price-row--total">
            <span>Estimated total</span>
            <span>{inr(estimatedPrice)}</span>
          </div>
        </div>

        <p className="fs-xs dim mt-8" style={{ lineHeight: 1.6 }}>
          The charged amount is the value returned by the transaction (
          <code>booking.final_price</code>). It is written to{' '}
          <code>price_snapshot JSONB</code> and cannot drift after confirmation.
        </p>

        <div className="acid-note">
          <ShieldIcon size={17} />
          <div>
            <strong style={{ color: 'var(--ink)' }}>What happens on confirm:</strong>{' '}
            BEGIN SERIALIZABLE → <code>SELECT … FOR UPDATE</code> → re-price →{' '}
            <code>UPDATE seat_map</code> → <code>INSERT bookings</code> → COMMIT →
            delete <code>hold:seat</code> → publish <code>booking.created</code>. A
            serialization conflict (SQLSTATE <code>40001</code>) rolls back and returns
            409.
          </div>
        </div>

        <button
          type="button"
          className="btn btn--primary btn--lg btn--block"
          onClick={handleConfirmBooking}
          disabled={bookingLoading || holdExpired}
        >
          {bookingLoading ? (
            <>
              <span className="btn__spinner" aria-hidden="true" />
              Executing ACID transaction…
            </>
          ) : (
            <>
              <CreditCardIcon size={17} />
              Confirm &amp; pay {inr(estimatedPrice)}
              <CheckIcon size={16} />
            </>
          )}
        </button>

        <p className="fs-xs dim mt-12 center">
          Demo environment — no real payment is taken. The transaction and seat
          reservation are real.
        </p>
      </div>
    </div>
  );
}
