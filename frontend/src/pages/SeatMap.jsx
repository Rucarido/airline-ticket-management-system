// =============================================================================
// pages/SeatMap.jsx — Cabin selection, Redis hold, priority recommendations
// =============================================================================
// Safety rules:
//   * seat map response is normalized by api.getSeatMap({ seats })
//   * polling is cancelled on unmount and never overlaps itself
//   * switching seats is blocked when the previous Redis hold cannot be released
//   * adopting an existing hold owned by the signed-in passenger is supported
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import { SAMPLE_PERSONAS, useBooking } from '../BookingContext';
import SeatGrid from '../components/SeatGrid';
import Timer from '../components/Timer';
import { useReveal } from '../lib/motion';
import {
  AlertIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  RefreshIcon,
  SeatIcon,
  SparkleIcon,
  UsersIcon,
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

export default function SeatMap() {
  const { flightId } = useParams();
  const navigate = useNavigate();

  const {
    user,
    token,
    selectedFlight,
    setSelectedFlight,
    selectedSeat,
    holdExpiry,
    setHeldSeat,
    clearHeldSeat,
    clearHoldLocal,
    showNotification,
    quickLoginAs,
  } = useBooking();

  const [seats, setSeats] = useState([]);
  const [meta, setMeta] = useState({ totalSeats: 0, userPriority: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [holding, setHolding] = useState(false);
  const [personaLoading, setPersonaLoading] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const expiredForRef = useRef(null);

  const revealRef = useReveal([seats.length, loading]);

  // ── Flight details (hydrate when arriving from a deep link) ───────────────
  useEffect(() => {
    if (selectedFlight && String(selectedFlight.flight_id) === String(flightId)) {
      return undefined;
    }

    const controller = new AbortController();
    api
      .getFlightById(flightId, { signal: controller.signal })
      .then((flight) => {
        if (!controller.signal.aborted) setSelectedFlight(flight);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          showNotification(err.message || 'Could not load this flight.', 'error');
        }
      });

    return () => controller.abort();
  }, [flightId, selectedFlight, setSelectedFlight, showNotification]);

  // ── Seat map + 15s polling ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    const load = async (silent) => {
      if (cancelled || inFlight) return;
      inFlight = true;
      if (!silent) setLoading(true);

      try {
        const data = await api.getSeatMap(flightId, token, {
          signal: controller.signal,
        });
        if (cancelled) return;
        setSeats(data.seats);
        setMeta({ totalSeats: data.totalSeats, userPriority: data.userPriority });
        setError(null);
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;
        setError(err.message);
        if (!silent) showNotification(err.message, 'error');
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };

    load(false);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 15000);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [flightId, token, reloadKey, showNotification]);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  const counts = useMemo(() => {
    const available = seats.filter((seat) => !seat.is_reserved && !seat.is_held).length;
    const held = seats.filter((seat) => seat.is_held).length;
    const booked = seats.filter((seat) => seat.is_reserved).length;
    return { available, held, booked };
  }, [seats]);

  const handleSeatClick = async (seat) => {
    if (!token || !user) {
      showNotification(
        'Sign in or pick a demo persona to place a ten-minute seat hold.',
        'warning'
      );
      return;
    }

    if (seat.is_restricted) {
      showNotification(
        'That exit-row seat is restricted for your passenger profile for safety reasons.',
        'warning'
      );
      return;
    }
    if (seat.is_reserved) {
      showNotification('That seat is already booked.', 'info');
      return;
    }
    if (seat.is_held && !seat.held_by_me) {
      showNotification('Another passenger is holding that seat right now.', 'info');
      return;
    }

    // Toggle the current selection off.
    if (selectedSeat?.seat_id === seat.seat_id) {
      setHolding(true);
      const release = await clearHeldSeat();
      setHolding(false);
      if (!release.ok) {
        showNotification(
          release.error?.message ||
            'Could not release the hold. Check the API and try again.',
          'error'
        );
        return;
      }
      showNotification(`Released seat ${seat.row_num}${seat.seat_letter}.`, 'info');
      refresh();
      return;
    }

    // Switch seats only after the previous hold is gone.
    if (selectedSeat) {
      setHolding(true);
      const release = await clearHeldSeat();
      if (!release.ok) {
        setHolding(false);
        showNotification(
          release.error?.message ||
            'Could not release your previous hold, so the seat was not changed. Try again.',
          'error'
        );
        return;
      }
      setHolding(false);
    }

    // Resume a hold created before a refresh (same passenger, Redis key alive).
    if (seat.held_by_me) {
      setHeldSeat(seat, 600);
      showNotification(
        `Resumed your existing hold on ${seat.row_num}${seat.seat_letter}. It expires within ten minutes.`,
        'success'
      );
      refresh();
      return;
    }

    setHolding(true);
    try {
      const res = await api.holdSeat(seat.seat_id, token);
      setHeldSeat(seat, res.expiresIn);
      showNotification(
        `Seat ${seat.row_num}${seat.seat_letter} held for ten minutes (Redis SET NX).`,
        'success'
      );
      refresh();
    } catch (err) {
      showNotification(err.message || 'The seat could not be held.', 'error');
      refresh();
    } finally {
      setHolding(false);
    }
  };

  const handleTimerExpired = () => {
    // Two countdowns can be mounted at once (sidebar + fixed bar). Only the
    // first one to fire for this expiry may run the cleanup.
    if (expiredForRef.current === holdExpiry) return;
    expiredForRef.current = holdExpiry;

    showNotification(
      'Your ten-minute hold expired. The seat is available to other passengers again.',
      'warning'
    );
    // The Redis key has expired by definition — clear local state without a
    // redundant DELETE request.
    clearHoldLocal();
    refresh();
  };

  const handlePersona = async (email) => {
    setPersonaLoading(email);
    try {
      await quickLoginAs(email);
      refresh();
    } catch (err) {
      showNotification(err.message || 'Could not sign in as that persona.', 'error');
    } finally {
      setPersonaLoading(null);
    }
  };

  const price = selectedSeat ? priceForClass(selectedFlight, selectedSeat.class) : null;
  const selectedIsHeld = Boolean(selectedSeat);

  return (
    <div className="container page" ref={revealRef}>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => navigate(selectedFlight ? `/flights?origin=${selectedFlight.origin}&destination=${selectedFlight.destination}` : '/flights')}
      >
        <ArrowLeftIcon size={14} />
        Back to departures
      </button>

      <div className="page-head mt-16">
        <div>
          <span className="eyebrow">Step 3 of 4 · Choose your seat</span>
          <h1 className="page-title mt-8">
            {selectedFlight
              ? `${selectedFlight.flight_number} · ${selectedFlight.origin} → ${selectedFlight.destination}`
              : 'Cabin seat map'}
          </h1>
          <p className="page-sub">
            Twenty rows, 120 physical seats. Amber seats are temporary Redis holds;
            green seats are priority aisle recommendations for your profile.
          </p>
        </div>

        <div className="flow" aria-label="Booking progress">
          <span className="flow__step is-done" data-step="1">
            Search
          </span>
          <span className="flow__sep" aria-hidden="true" />
          <span className="flow__step is-done" data-step="2">
            Flight
          </span>
          <span className="flow__sep" aria-hidden="true" />
          <span className="flow__step is-current" data-step="3">
            Seat
          </span>
          <span className="flow__sep" aria-hidden="true" />
          <span className="flow__step" data-step="4">
            Confirm
          </span>
        </div>
      </div>

      {error && seats.length === 0 && (
        <div className="panel panel--pad mb-16">
          <div className="error-banner" role="alert">
            <AlertIcon size={18} />
            <div>
              <strong>Could not load the cabin</strong>
              {error}
            </div>
          </div>
          <div className="row wrap gap-8 mt-16">
            <button type="button" className="btn btn--ghost" onClick={refresh}>
              <RefreshIcon size={15} />
              Retry
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => navigate('/flights')}>
              Browse other flights
            </button>
          </div>
        </div>
      )}

      {loading && seats.length === 0 && !error && (
        <div className="panel panel--pad" aria-busy="true">
          <div className="skeleton" style={{ height: 320, borderRadius: 24 }} />
        </div>
      )}

      {(seats.length > 0 || (!loading && !error)) && (
        <div className="seatmap-layout">
          {/* ── Cabin ───────────────────────────────────────────────────── */}
          <div>
            <div className="between wrap gap-8 mb-12">
              <span className="fs-xs dim row gap-6">
                <SeatIcon size={13} />
                Live map · refreshes every 15 seconds
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshIcon size={13} />
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {seats.length > 0 ? (
              <SeatGrid
                seats={seats}
                selectedSeat={selectedSeat}
                onSelectSeat={handleSeatClick}
                disabled={holding}
              />
            ) : (
              <div className="panel empty-state">
                <span className="empty-state__icon">
                  <SeatIcon size={24} />
                </span>
                <h3>No seats returned for this flight</h3>
                <p className="fs-sm">Run the schema and seed scripts, then refresh.</p>
              </div>
            )}
          </div>

          {/* ── Sidebar ─────────────────────────────────────────────────── */}
          <aside className="seatmap-side">
            {selectedSeat && holdExpiry ? (
              <div className="panel panel--pad panel--accent">
                <span className="eyebrow">Your selection</span>
                <div className="between mt-8">
                  <div>
                    <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                      {selectedSeat.row_num}
                      {selectedSeat.seat_letter}
                    </div>
                    <div className="fs-xs dim">
                      {selectedSeat.class} · {selectedSeat.is_aisle ? 'aisle' : selectedSeat.is_window ? 'window' : 'middle'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="price-block__label">Fare</div>
                    <div className="price-block__main" style={{ fontSize: '1.3rem' }}>
                      {inr(price)}
                    </div>
                  </div>
                </div>

                <div className="mt-12">
                  <Timer expiresAt={holdExpiry} onExpire={handleTimerExpired} />
                </div>

                <button
                  type="button"
                  className="btn btn--primary btn--block mt-12"
                  onClick={() => navigate('/checkout')}
                  disabled={holding || !selectedIsHeld}
                >
                  Continue to confirmation
                  <ArrowRightIcon size={15} />
                </button>
                <p className="fs-xs dim mt-8" style={{ lineHeight: 1.5 }}>
                  The fare is re-checked and locked by PostgreSQL inside the booking
                  transaction.
                </p>
              </div>
            ) : (
              <div className="panel panel--pad">
                <span className="eyebrow">No seat selected</span>
                <p className="fs-sm mt-8">
                  Pick any available seat to place a ten-minute hold. You can switch
                  seats as long as the previous hold is released.
                </p>
              </div>
            )}

            <div className="priority-banner">
              <span className="priority-banner__icon">
                <SparkleIcon size={17} />
              </span>
              <div>
                <h4>Priority seating engine</h4>
                {user ? (
                  <p>
                    Signed in as <strong style={{ color: 'var(--ink)' }}>{user.full_name}</strong>.
                    {meta.userPriority?.score ? (
                      <> Score <strong style={{ color: 'var(--cyan)' }}>{meta.userPriority.score} pts</strong>.</>
                    ) : (
                      ' Score 0 pts.'
                    )}{' '}
                    Recommended seats are aisle seats that are not exit rows.
                  </p>
                ) : (
                  <p>Sign in as a demo persona to see personalized aisle recommendations.</p>
                )}

                {!user && (
                  <div className="persona-mini">
                    {SAMPLE_PERSONAS.map((persona) => (
                      <button
                        key={persona.email}
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => handlePersona(persona.email)}
                        disabled={personaLoading !== null}
                      >
                        {personaLoading === persona.email
                          ? 'Signing in…'
                          : persona.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="cabin-summary">
              <div className="cabin-summary__item">
                <div className="cabin-summary__value">{counts.available}</div>
                <div className="cabin-summary__label">Open</div>
              </div>
              <div className="cabin-summary__item">
                <div className="cabin-summary__value">{counts.held}</div>
                <div className="cabin-summary__label">Held</div>
              </div>
              <div className="cabin-summary__item">
                <div className="cabin-summary__value">{counts.booked}</div>
                <div className="cabin-summary__label">Booked</div>
              </div>
            </div>

            {user && meta.userPriority?.cannotTakeExitRow && (
              <div className="priority-banner">
                <span className="priority-banner__icon" style={{ color: 'var(--red)', borderColor: 'rgba(255,107,122,.35)', background: 'var(--red-soft)' }}>
                  <AlertIcon size={17} />
                </span>
                <div>
                  <h4>Exit row restricted</h4>
                  <p>
                    Your profile cannot be assigned an emergency-exit seat. Those seats
                    are disabled and the API enforces the same rule.
                  </p>
                </div>
              </div>
            )}

            <div className="panel panel--pad">
              <span className="fs-xs dim row gap-6">
                <UsersIcon size={13} />
                Hold ownership
              </span>
              <p className="fs-xs mt-8" style={{ lineHeight: 1.6 }}>
                A Redis key belongs to the passenger who created it. Seat-switching is
                blocked if the old key cannot be released, so two holds never coexist
                under one account.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* ── Fixed selection bar ───────────────────────────────────────────── */}
      {selectedSeat && (
        <div className="hold-bar">
          <div className="hold-bar__inner">
            <div className="hold-bar__seat">
              <span className="hold-bar__seat-id">
                {selectedSeat.row_num}
                {selectedSeat.seat_letter}
              </span>
              <span>
                <span className="hold-bar__meta">Selected seat</span>
                <span className={`badge badge-${selectedSeat.class}`}>
                  {selectedSeat.class}
                </span>
              </span>
            </div>

            {holdExpiry && (
              <div style={{ flex: '0 1 300px', minWidth: 220 }}>
                <Timer
                  expiresAt={holdExpiry}
                  onExpire={handleTimerExpired}
                  sublabel="Hold expires automatically"
                />
              </div>
            )}

            <div className="hold-bar__price">
              <span className="hold-bar__meta">Locked at checkout</span>
              <div className="hold-bar__price-value">{inr(price)}</div>
            </div>

            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={() => navigate('/checkout')}
              disabled={holding}
            >
              <CheckIcon size={16} />
              Continue
              <ArrowRightIcon size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
