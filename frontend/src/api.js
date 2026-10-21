// =============================================================================
// api.js — Frontend API Client
// =============================================================================
// Uses standard fetch() with relative paths (/api/...).
// Vite's proxy forwards requests to http://localhost:3001 in development.
//
// Contract notes (do not change without updating the backend):
//   GET  /api/seats/:flightId  -> { seats: [], total_seats, user_priority }
//   POST /api/seats/hold       -> { ttl_seconds }
//   POST /api/bookings         -> { pnr, booking } where booking.final_price is authoritative
// =============================================================================

/**
 * @typedef {Object} RequestOptions
 * @property {AbortSignal} [signal]
 */

async function request(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(endpoint, { ...options, headers });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const networkError = new Error(
      'Cannot reach the AeroReserve API. Is the backend running on port 3001?'
    );
    networkError.status = 0;
    networkError.cause = err;
    throw networkError;
  }

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => '');
  }

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && data.error) ||
      (typeof data === 'string' && data.trim()) ||
      `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ── AUTHENTICATION ───────────────────────────────────────────────────────────
export async function login(email, password) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(userData) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
}

// ── FLIGHTS ──────────────────────────────────────────────────────────────────
export async function getAirports(options = {}) {
  return request('/api/flights/airports', { signal: options.signal });
}

export async function searchFlights({ origin, destination, date } = {}, options = {}) {
  const params = new URLSearchParams();
  if (origin) params.append('origin', origin);
  if (destination) params.append('destination', destination);
  if (date) params.append('date', date);

  const query = params.toString();
  return request(`/api/flights/search${query ? `?${query}` : ''}`, {
    signal: options.signal,
  });
}

export async function getFlightById(flightId, options = {}) {
  return request(`/api/flights/${flightId}`, { signal: options.signal });
}

// ── SEATS & REDIS HOLDS ──────────────────────────────────────────────────────
/**
 * Fetches the seat map and normalizes the backend envelope into a stable shape.
 * The backend returns `{ seats }`; older code assumed a bare array. Normalizing
 * here keeps every consumer safe.
 */
export async function getSeatMap(flightId, token = null, options = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const data = await request(`/api/seats/${flightId}`, {
    headers,
    signal: options.signal,
  });

  const seats = Array.isArray(data)
    ? data
    : Array.isArray(data?.seats)
    ? data.seats
    : [];

  return {
    flightId: data?.flight_id ?? Number(flightId),
    totalSeats: data?.total_seats ?? seats.length,
    userPriority: data?.user_priority ?? null,
    seats,
  };
}

export async function holdSeat(seatId, token, options = {}) {
  const data = await request('/api/seats/hold', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ seatId }),
    signal: options.signal,
  });

  return {
    ...data,
    expiresIn: data?.ttl_seconds ?? data?.expiresIn ?? 600,
  };
}

export async function releaseHold(seatId, token, options = {}) {
  return request(`/api/seats/hold/${seatId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal,
  });
}

// ── BOOKINGS & ACID WORKFLOW ─────────────────────────────────────────────────
export async function createBooking({ flightId, seatId, seatClass }, token, options = {}) {
  return request('/api/bookings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ flightId, seatId, seatClass }),
    signal: options.signal,
  });
}

export async function getMyBookings(token, options = {}) {
  return request('/api/bookings/mine', {
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal,
  });
}

export async function cancelBooking(bookingId, token, options = {}) {
  return request(`/api/bookings/${bookingId}/cancel`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal,
  });
}
