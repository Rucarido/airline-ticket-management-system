// =============================================================================
// pages/Auth.jsx — Sign in, registration, and 1-click demo personas
// =============================================================================
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as api from '../api';
import { SAMPLE_PERSONAS, useBooking } from '../BookingContext';
import { useReveal } from '../lib/motion';
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  LockIcon,
  LogOutIcon,
  SparkleIcon,
  UserIcon,
} from '../components/Icons';

const safeReturnTo = (from) => {
  if (typeof from !== 'string') return '/';
  if (!from.startsWith('/') || from.startsWith('//') || from.startsWith('/auth')) return '/';
  return from;
};

export default function Auth() {
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('1995-06-15');
  const [loyaltyTier, setLoyaltyTier] = useState('none');
  const [accessibility, setAccessibility] = useState(false);

  const [loading, setLoading] = useState(false);
  const [personaLoading, setPersonaLoading] = useState(null);
  const [error, setError] = useState(null);

  const { user, loginUser, logoutUser, quickLoginAs, showNotification } = useBooking();
  const navigate = useNavigate();
  const location = useLocation();
  const revealRef = useReveal([]);

  const returnTo = safeReturnTo(location.state?.from);

  useEffect(() => {
    setError(null);
  }, [tab]);

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginUser(email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.register({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        dob,
        loyalty_tier: loyaltyTier,
        accessibility,
      });
      showNotification('Account created. Signing you in…', 'success');
      await loginUser(email.trim(), password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePersona = async (personaEmail) => {
    setPersonaLoading(personaEmail);
    setError(null);
    try {
      await quickLoginAs(personaEmail);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign in as that persona.');
    } finally {
      setPersonaLoading(null);
    }
  };

  const handleSignOut = async () => {
    await logoutUser();
  };

  return (
    <div className="container container--tight auth-wrap" ref={revealRef}>
      <div className="auth-head">
        <span className="eyebrow" style={{ justifyContent: 'center' }}>
          Passenger account
        </span>
        <h1>Sign in to reserve</h1>
        <p>
          A JWT identifies the passenger who owns a Redis hold and who may confirm the
          booking.
        </p>
      </div>

      {user && (
        <div className="panel panel--pad panel--accent mb-20">
          <div className="between wrap gap-12">
            <div className="row gap-12">
              <span className="user-chip__avatar" style={{ width: 40, height: 40 }}>
                {user.full_name?.slice(0, 1) || 'A'}
              </span>
              <div>
                <div className="fw-700">Signed in as {user.full_name}</div>
                <div className="fs-xs dim">
                  {user.email} ·{' '}
                  {user.loyalty_tier && user.loyalty_tier !== 'none'
                    ? `${user.loyalty_tier} tier`
                    : 'standard tier'}
                </div>
              </div>
            </div>
            <div className="row wrap gap-8">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => navigate(returnTo, { replace: true })}
              >
                Continue
                <ArrowRightIcon size={14} />
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleSignOut}>
                <LogOutIcon size={14} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="auth-grid">
        <aside className="auth-aside" data-reveal>
          <div className="row gap-8 mb-8">
            <SparkleIcon size={16} />
            <h3 style={{ margin: 0 }}>Demo personas</h3>
          </div>
          <p>
            One click signs in with seeded credentials. Use these to demonstrate the
            priority-seating algorithm without typing passwords.
          </p>

          <div className="persona-stack">
            {SAMPLE_PERSONAS.map((persona) => (
              <button
                key={persona.email}
                type="button"
                className="persona-row"
                onClick={() => handlePersona(persona.email)}
                disabled={personaLoading !== null || loading}
              >
                <span>
                  <span className="persona-row__name" style={{ display: 'block' }}>
                    {persona.name}
                  </span>
                  <span className="persona-row__role">{persona.role}</span>
                </span>
                <span className="badge badge-priority">
                  {personaLoading === persona.email ? '…' : persona.badge}
                </span>
              </button>
            ))}
          </div>

          <div className="tech-strip">
            <span className="tech-pill">
              <i /> JWT bearer
            </span>
            <span className="tech-pill">
              <i /> bcryptjs
            </span>
          </div>
        </aside>

        <section className="panel auth-panel" data-reveal>
          <div className="tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              id="tab-login"
              aria-selected={tab === 'login'}
              aria-controls="panel-login"
              className={`tab${tab === 'login' ? ' is-active' : ''}`}
              onClick={() => setTab('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              id="tab-register"
              aria-selected={tab === 'register'}
              aria-controls="panel-register"
              className={`tab${tab === 'register' ? ' is-active' : ''}`}
              onClick={() => setTab('register')}
            >
              Create account
            </button>
          </div>

          {error && (
            <div className="error-banner mb-16" role="alert">
              <AlertIcon size={17} />
              <div>{error}</div>
            </div>
          )}

          {tab === 'login' ? (
            <form
              id="panel-login"
              role="tabpanel"
              aria-labelledby="tab-login"
              onSubmit={handleLoginSubmit}
              className="form-stack"
            >
              <div className="field">
                <label className="field__label" htmlFor="login-email">
                  <UserIcon size={12} />
                  Email address
                </label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="rahul@example.com"
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="login-password">
                  <LockIcon size={12} />
                  Password
                </label>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password123!"
                />
              </div>

              <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={loading}>
                {loading ? (
                  <>
                    <span className="btn__spinner" aria-hidden="true" />
                    Authenticating…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRightIcon size={15} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form
              id="panel-register"
              role="tabpanel"
              aria-labelledby="tab-register"
              onSubmit={handleRegisterSubmit}
              className="form-stack"
            >
              <div className="field">
                <label className="field__label" htmlFor="register-name">
                  Full name
                </label>
                <input
                  id="register-name"
                  className="input"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="First and last name"
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="register-email">
                  Email address
                </label>
                <input
                  id="register-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="register-password">
                  Password
                </label>
                <input
                  id="register-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>

              <div className="form-row">
                <div className="field">
                  <label className="field__label" htmlFor="register-dob">
                    Date of birth
                  </label>
                  <input
                    id="register-dob"
                    className="input"
                    type="date"
                    required
                    value={dob}
                    onChange={(event) => setDob(event.target.value)}
                  />
                  <span className="field__hint">Drives the age component of priority.</span>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="register-tier">
                    Loyalty tier
                  </label>
                  <select
                    id="register-tier"
                    className="select"
                    value={loyaltyTier}
                    onChange={(event) => setLoyaltyTier(event.target.value)}
                  >
                    <option value="none">None</option>
                    <option value="silver">Silver (+8 pts)</option>
                    <option value="gold">Gold (+15 pts)</option>
                  </select>
                </div>
              </div>

              <label className="checkbox" htmlFor="register-accessibility">
                <input
                  id="register-accessibility"
                  type="checkbox"
                  checked={accessibility}
                  onChange={(event) => setAccessibility(event.target.checked)}
                />
                <span>
                  <strong style={{ color: 'var(--ink)' }}>Accessibility support (+30 pts)</strong>
                  <span className="fs-xs dim" style={{ display: 'block' }}>
                    Aisle recommendations are prioritized and exit rows are excluded.
                  </span>
                </span>
              </label>

              <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={loading}>
                {loading ? (
                  <>
                    <span className="btn__spinner" aria-hidden="true" />
                    Creating account…
                  </>
                ) : (
                  <>
                    <CheckIcon size={15} />
                    Create passenger account
                  </>
                )}
              </button>
            </form>
          )}

          <p className="fs-xs dim mt-16" style={{ lineHeight: 1.6 }}>
            Demo credentials: every sample persona uses the password{' '}
            <code>Password123!</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
