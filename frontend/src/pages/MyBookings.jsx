// =============================================================================
// pages/MyBookings.jsx — Reservation history, cancellation, waitlist promotion
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useBooking } from '../BookingContext';
import { useReveal } from '../lib/motion';
import {
  AlertIcon,
  ArrowRightIcon,
  BoltIcon,
  CheckCircleIcon,
  RefreshIcon,
  TicketIcon,
  XIcon,
} from '../components/Icons';

const inr = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const dayOf = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
};

export default function MyBookings() {
  const { user, token, showNotification } = useBooking();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cancellingId, setCancellingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [cancellationResult, setCancellationResult] = useState(null);

  const navigate = useNavigate();
  const revealRef = useReveal([bookings.length, loading]);

  useEffect(() => {
    if (!token) {
      setBookings([]);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    api
      .getMyBookings(token, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setBookings(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!active || err.name === 'AbortError') return;
        setError(err.message);
        showNotification(err.message, 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, reloadKey, showNotification]);

  const summary = useMemo(() => {
    const confirmed = bookings.filter((booking) => booking.status === 'confirmed').length;
    return {
      total: bookings.length,
      confirmed,
      cancelled: bookings.length - confirmed,
    };
  }, [bookings]);

  const handleCancel = async (bookingId) => {
    setConfirmingId(null);
    setCancellingId(bookingId);

    try {
      const res = await api.cancelBooking(bookingId, token);
      setCancellationResult(res);
      setReloadKey((key) => key + 1);
      showNotification(
        'Booking cancelled. The seat is back in inventory and the trigger has run.',
        'success'
      );
    } catch (err) {
      showNotification(err.message || 'Could not cancel this booking.', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  if (!user || !token) {
    return (
      <div className="container container--tight page">
        <div className="panel empty-state">
          <span className="empty-state__icon">
            <TicketIcon size={24} />
          </span>
          <h1 style={{ fontSize: '1.5rem' }}>Sign in to view bookings</h1>
          <p className="fs-sm" style={{ maxWidth: '44ch' }}>
            Reservations are scoped to the authenticated passenger. Sign in with one of
            the demo personas to see confirmed, cancelled, and waitlisted records.
          </p>
          <Link to="/auth" state={{ from: '/my-bookings' }} className="btn btn--primary mt-12">
            Sign in
            <ArrowRightIcon size={15} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page" ref={revealRef}>
      <div className="page-head">
        <div>
          <span className="eyebrow">Passenger record</span>
          <h1 className="page-title mt-8">My bookings</h1>
          <p className="page-sub">
            {user.full_name} · {user.email}
          </p>
        </div>

        <div className="row wrap gap-8">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={loading}
          >
            <RefreshIcon size={14} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/')}>
            <TicketIcon size={14} />
            Book a flight
          </button>
        </div>
      </div>

      {!loading && bookings.length > 0 && (
        <div className="cabin-summary mb-20" style={{ maxWidth: 420 }}>
          <div className="cabin-summary__item">
            <div className="cabin-summary__value">{summary.total}</div>
            <div className="cabin-summary__label">Total</div>
          </div>
          <div className="cabin-summary__item">
            <div className="cabin-summary__value" style={{ color: 'var(--emerald)' }}>
              {summary.confirmed}
            </div>
            <div className="cabin-summary__label">Confirmed</div>
          </div>
          <div className="cabin-summary__item">
            <div className="cabin-summary__value" style={{ color: 'var(--red)' }}>
              {summary.cancelled}
            </div>
            <div className="cabin-summary__label">Cancelled</div>
          </div>
        </div>
      )}

      {cancellationResult && (
        <div className="promotion-card" role="status">
          <div className="promotion-card__head">
            <BoltIcon size={17} />
            Trigger and Kafka consumer executed
          </div>
          <p>
            Booking <strong>#{cancellationResult.booking_id}</strong> is now{' '}
            <code>cancelled</code> and the physical seat was released (
            <code>is_reserved = FALSE</code>).
          </p>
          {cancellationResult.waitlist_promoted ? (
            <div className="promotion-card__promoted">
              Waitlist promoted: passenger #
              {cancellationResult.waitlist_promoted.passenger_id} moved to{' '}
              <code>pending_confirmation</code>.
            </div>
          ) : (
            <div className="fs-xs dim mt-8">
              No passenger was waiting for this flight, so the trigger had nothing to
              promote.
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error-banner mb-16" role="alert">
          <AlertIcon size={18} />
          <div>
            <strong>Could not load bookings</strong>
            {error}
          </div>
        </div>
      )}

      {loading && (
        <div className="booking-list" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div className="skeleton" key={item} style={{ height: 104 }} />
          ))}
        </div>
      )}

      {!loading && bookings.length === 0 && !error && (
        <div className="panel empty-state">
          <span className="empty-state__icon">
            <TicketIcon size={24} />
          </span>
          <h3>No bookings under this account</h3>
          <p className="fs-sm" style={{ maxWidth: '44ch' }}>
            Search a route, hold a seat, and confirm to create your first reservation.
          </p>
          <button type="button" className="btn btn--primary mt-12" onClick={() => navigate('/')}>
            Search flights
            <ArrowRightIcon size={15} />
          </button>
        </div>
      )}

      {!loading && bookings.length > 0 && (
        <div className="booking-list">
          {bookings.map((booking) => {
            const isCancelled = booking.status === 'cancelled';
            const isConfirming = confirmingId === booking.booking_id;
            const isCancelling = cancellingId === booking.booking_id;

            return (
              <article
                key={booking.booking_id}
                className={`booking-card${isCancelled ? ' is-cancelled' : ''}`}
                data-reveal
              >
                <div className="booking-card__main">
                  <div>
                    <div className="booking-card__ident">
                      <span className="booking-card__pnr">{booking.booking_ref}</span>
                      <span className={`badge badge-${isCancelled ? 'cancelled' : 'confirmed'}`}>
                        {isCancelled ? <XIcon size={11} /> : <CheckCircleIcon size={11} />}
                        {booking.status}
                      </span>
                      <span className="fs-xs dim">Booked {dayOf(booking.booked_at)}</span>
                    </div>

                    <div className="booking-card__route">
                      <b>{booking.flight_number}</b>
                      <span className="sep">·</span>
                      <span>
                        {booking.origin} ({booking.origin_city}) → {booking.destination} (
                        {booking.destination_city})
                      </span>
                      <span className="sep">·</span>
                      <span>
                        Seat{' '}
                        <b style={{ color: 'var(--cyan)' }}>
                          {booking.row_num}
                          {booking.seat_letter}
                        </b>
                      </span>
                      <span className={`badge badge-${booking.seat_class}`}>
                        {booking.seat_class}
                      </span>
                    </div>
                  </div>

                  <div className="booking-card__side">
                    <div>
                      <div className="price-block__label">Paid</div>
                      <div
                        className="booking-card__price"
                        style={{ color: isCancelled ? 'var(--ink-3)' : 'var(--emerald)' }}
                      >
                        {inr(booking.final_price)}
                      </div>
                    </div>

                    {!isCancelled &&
                      (isConfirming ? (
                        <div className="cancel-confirm">
                          <span className="fs-xs" style={{ color: 'var(--amber)' }}>
                            Cancel this booking?
                          </span>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => handleCancel(booking.booking_id)}
                            disabled={isCancelling}
                          >
                            {isCancelling ? 'Cancelling…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setConfirmingId(null)}
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => setConfirmingId(booking.booking_id)}
                          disabled={isCancelling}
                        >
                          {isCancelling ? 'Cancelling…' : 'Cancel booking'}
                        </button>
                      ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
