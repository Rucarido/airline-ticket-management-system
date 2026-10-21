// =============================================================================
// pages/Confirmation.jsx — Electronic boarding pass + Kafka audit note
// =============================================================================
// Router state is the fast path; sessionStorage keeps the pass alive across a
// refresh or a direct open of /confirmation?pnr=XXXXXX in the same tab.
// =============================================================================
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useBooking } from '../BookingContext';
import { useReveal } from '../lib/motion';
import {
  ArrowRightIcon,
  CheckCircleIcon,
  PlaneIcon,
  TicketIcon,
} from '../components/Icons';

const inr = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const longDate = (iso) => {
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

function readSavedBooking(queryPnr) {
  try {
    const raw = sessionStorage.getItem('aero_last_booking');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed) return null;
    if (queryPnr && parsed.pnr && parsed.pnr !== queryPnr) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function Confirmation() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useBooking();
  const revealRef = useReveal([]);

  const queryPnr = searchParams.get('pnr');

  const [payload] = useState(() => {
    if (location.state?.booking || location.state?.pnr) return location.state;
    return readSavedBooking(queryPnr);
  });

  if (!payload?.booking && !payload?.pnr) {
    return (
      <div className="container container--tight page">
        <div className="panel empty-state">
          <span className="empty-state__icon">
            <TicketIcon size={24} />
          </span>
          <h1 style={{ fontSize: '1.5rem' }}>No boarding pass in this tab</h1>
          <p className="fs-sm" style={{ maxWidth: '46ch' }}>
            Confirmed bookings are always available in your booking history. If you
            just completed a payment, open the pass from there.
          </p>
          <div className="row wrap gap-8 mt-12">
            <Link to="/my-bookings" className="btn btn--primary">
              View my bookings
              <ArrowRightIcon size={15} />
            </Link>
            <Link to="/" className="btn btn--ghost">
              Book another flight
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { booking, pnr, flight, seat } = payload;
  const pnrCode = pnr || booking?.booking_ref || '------';
  const pricePaid = booking?.final_price;
  const cabinClass = seat?.class || booking?.price_snapshot?.cabin_class || 'economy';

  return (
    <div className="container container--narrow page" ref={revealRef}>
      <div className="center mb-24">
        <span
          className="empty-state__icon"
          style={{
            margin: '0 auto 14px',
            color: 'var(--emerald)',
            borderColor: 'rgba(52,224,161,.4)',
            background: 'var(--emerald-soft)',
          }}
        >
          <CheckCircleIcon size={26} />
        </span>
        <span className="eyebrow" style={{ justifyContent: 'center' }}>
          Transaction committed
        </span>
        <h1 className="page-title mt-8">Booking confirmed</h1>
        <p className="page-sub" style={{ margin: '8px auto 0' }}>
          The seat is permanently reserved in PostgreSQL and the electronic ticket has
          been published to Kafka.
        </p>
      </div>

      <article className="boarding-pass" data-reveal>
        <div className="boarding-pass__bar">
          <span className="boarding-pass__brand">
            <PlaneIcon size={17} />
            AeroReserve boarding pass
          </span>
          <span
            className="badge"
            style={{ background: '#ffffff', color: '#071019', fontWeight: 800 }}
          >
            Confirmed
          </span>
        </div>

        <div className="boarding-pass__body">
          <div className="pass-top">
            <div>
              <div className="pass-label">Booking reference · PNR</div>
              <div className="pnr">{pnrCode}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="pass-label">Amount committed</div>
              <div
                className="mono"
                style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--emerald)' }}
              >
                {inr(pricePaid)}
              </div>
            </div>
          </div>

          <div className="pass-grid">
            <div className="pass-field">
              <div className="pass-label">Passenger</div>
              <div className="pass-field__value">{user?.full_name || 'Confirmed passenger'}</div>
            </div>
            <div className="pass-field">
              <div className="pass-label">Flight</div>
              <div className="pass-field__value pass-field__value--accent">
                {flight?.flight_number || '—'}
              </div>
            </div>
            <div className="pass-field">
              <div className="pass-label">Route</div>
              <div className="pass-field__value">
                {flight?.origin || '—'} → {flight?.destination || '—'}
              </div>
            </div>
            <div className="pass-field">
              <div className="pass-label">Seat</div>
              <div className="pass-field__value pass-field__value--accent">
                {seat ? `${seat.row_num}${seat.seat_letter}` : 'Assigned'}
              </div>
              <div className="mt-8">
                <span className={`badge badge-${cabinClass}`}>{cabinClass}</span>
              </div>
            </div>
            <div className="pass-field">
              <div className="pass-label">Departure</div>
              <div className="pass-field__value" style={{ fontSize: '0.9rem' }}>
                {longDate(flight?.departure_time)}
              </div>
            </div>
          </div>

          <div className="barcode" aria-hidden="true">
            <div className="barcode__bars" />
            <div className="barcode__text">*{pnrCode}* ELECTRONIC TICKET * AERORESERVE *</div>
          </div>
        </div>
      </article>

      <div className="panel panel--pad mt-16" data-reveal>
        <span className="fs-xs dim row gap-6">
          <PlaneIcon size={13} />
          Event fan-out
        </span>
        <p className="fs-sm mt-8" style={{ lineHeight: 1.65 }}>
          <strong style={{ color: 'var(--ink)' }}>booking.created</strong> was published
          to the <code>bookings</code> topic. Watch the <code>consumer.js</code> terminal
          to see the decoupled ticket dispatch, and{' '}
          <code>price_snapshot JSONB</code> to see the immutable price record.
        </p>
      </div>

      <div className="row wrap gap-8 mt-24" style={{ justifyContent: 'center' }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => navigate('/my-bookings')}
        >
          View my bookings
          <ArrowRightIcon size={15} />
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/')}>
          Book another flight
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => window.print()}>
          Print boarding pass
        </button>
      </div>
    </div>
  );
}
