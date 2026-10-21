// =============================================================================
// BookingContext.jsx — Global State for Airline Ticket Reservation
// =============================================================================
// Owns: session (JWT + passenger), the in-progress flight/seat selection, the
// Redis-hold countdown, and the single active toast.
//
// Hold-safety rules enforced here:
//   1. A hold is always released with the token of the passenger who created it.
//   2. Switching identity releases the previous passenger's hold first.
//   3. clearHeldSeat() reports success, so callers can refuse to move on when a
//      release failed instead of silently orphaning a Redis key.
//   4. The toast timer compares notification ids, so an older timer can never
//      dismiss a newer message.
// =============================================================================
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as api from './api';

const BookingContext = createContext(null);

export const SAMPLE_PERSONAS = [
  {
    name: 'Rahul Sharma',
    email: 'rahul@example.com',
    role: 'Standard Adult (Age 29)',
    priority: '0 pts',
    badge: 'Standard',
  },
  {
    name: 'Shanti Patel',
    email: 'shanti@example.com',
    role: 'Senior Citizen (Age 70, Silver)',
    priority: '48 pts',
    badge: 'Senior & Silver',
  },
  {
    name: 'Arjun Mehta',
    email: 'arjun@example.com',
    role: 'Accessibility Need (Gold Tier)',
    priority: '45 pts',
    badge: 'Accessibility & Gold',
  },
];

function readStoredUser() {
  try {
    const saved = localStorage.getItem('aero_user');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function BookingProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('aero_token') || null);
  const [user, setUser] = useState(readStoredUser);

  const [selectedFlight, setSelectedFlight] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [holdExpiry, setHoldExpiry] = useState(null);
  const [notification, setNotification] = useState(null);

  const notificationTimer = useRef(null);

  const dismissNotification = useCallback(() => {
    if (notificationTimer.current) {
      clearTimeout(notificationTimer.current);
      notificationTimer.current = null;
    }
    setNotification(null);
  }, []);

  const showNotification = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setNotification({ message, type, id });

    if (notificationTimer.current) clearTimeout(notificationTimer.current);
    notificationTimer.current = setTimeout(() => {
      // Only the toast that scheduled this timer may be dismissed by it.
      setNotification((current) => (current?.id === id ? null : current));
      notificationTimer.current = null;
    }, 5000);
  }, []);

  useEffect(
    () => () => {
      if (notificationTimer.current) clearTimeout(notificationTimer.current);
    },
    []
  );

  const persistSession = (nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    if (nextToken) localStorage.setItem('aero_token', nextToken);
    else localStorage.removeItem('aero_token');
    if (nextUser) localStorage.setItem('aero_user', JSON.stringify(nextUser));
    else localStorage.removeItem('aero_user');
  };

  const clearHoldState = () => {
    setSelectedSeat(null);
    setHoldExpiry(null);
  };

  /**
   * Releases a hold using the token that created it.
   * 404/403 mean the key is no longer ours to manage, so local state may be
   * cleared safely. Other errors leave local state intact so the caller can retry.
   */
  const releaseHoldQuietly = async (seat, authToken) => {
    if (!seat || !authToken) return { ok: true, skipped: true };
    try {
      await api.releaseHold(seat.seat_id, authToken);
      return { ok: true };
    } catch (err) {
      if (err.status === 404 || err.status === 403) return { ok: true, stale: true };
      return { ok: false, error: err };
    }
  };

  const loginUser = useCallback(
    async (email, password) => {
      const res = await api.login(email, password);
      const samePassenger =
        user && String(user.passenger_id) === String(res.user?.passenger_id);

      if (!samePassenger && selectedSeat && token) {
        const release = await releaseHoldQuietly(selectedSeat, token);
        if (!release.ok) {
          showNotification(
            'Signed in, but the previous seat hold could not be released. It will expire automatically within 10 minutes.',
            'warning'
          );
        } else {
          clearHoldState();
        }
      } else if (!samePassenger) {
        clearHoldState();
      }

      persistSession(res.token, res.user);
      showNotification(`Welcome back, ${res.user.full_name}!`, 'success');
      return res.user;
    },
    [selectedSeat, showNotification, token, user]
  );

  const quickLoginAs = useCallback(
    (email) => loginUser(email, 'Password123!'),
    [loginUser]
  );

  const logoutUser = useCallback(async () => {
    if (selectedSeat && token) {
      const release = await releaseHoldQuietly(selectedSeat, token);
      if (!release.ok) {
        showNotification(
          'Logged out, but the seat hold could not be released. It will expire within 10 minutes.',
          'warning'
        );
      }
    }
    clearHoldState();
    persistSession(null, null);
    showNotification('Signed out successfully.', 'info');
  }, [selectedSeat, showNotification, token]);

  /**
   * Seat-switch entry point. Returns { ok } so the seat page can stop when the
   * previous Redis key could not be removed (prevents two active holds).
   */
  const clearHeldSeat = useCallback(async () => {
    if (!selectedSeat || !token) {
      clearHoldState();
      return { ok: true };
    }
    const release = await releaseHoldQuietly(selectedSeat, token);
    if (release.ok) clearHoldState();
    return release;
  }, [selectedSeat, token]);

  /**
   * After a confirmed booking the backend has already deleted the Redis key.
   * Clear the local countdown without issuing a redundant DELETE.
   */
  const clearHoldLocal = useCallback(() => {
    clearHoldState();
  }, []);

  const setHeldSeat = useCallback((seat, expiresInSeconds = 600) => {
    setSelectedSeat(seat);
    setHoldExpiry(Date.now() + Math.max(1, Number(expiresInSeconds) || 600) * 1000);
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      userInitials: initials(user?.full_name),
      selectedFlight,
      setSelectedFlight,
      selectedSeat,
      setSelectedSeat,
      holdExpiry,
      setHeldSeat,
      clearHeldSeat,
      clearHoldLocal,
      loginUser,
      logoutUser,
      quickLoginAs,
      notification,
      showNotification,
      dismissNotification,
    }),
    [
      token,
      user,
      selectedFlight,
      selectedSeat,
      holdExpiry,
      setHeldSeat,
      clearHeldSeat,
      clearHoldLocal,
      loginUser,
      logoutUser,
      quickLoginAs,
      notification,
      showNotification,
      dismissNotification,
    ]
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error('useBooking must be used within a BookingProvider');
  }
  return context;
}
