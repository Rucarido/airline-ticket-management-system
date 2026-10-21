// =============================================================================
// components/Navbar.jsx — Header navigation & 1-click demo persona switcher
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { SAMPLE_PERSONAS, useBooking } from '../BookingContext';
import {
  ArrowRightIcon,
  ChevronDownIcon,
  LogOutIcon,
  PlaneIcon,
  SparkleIcon,
} from './Icons';

const navLinkClass = ({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`;

export default function Navbar() {
  const { user, userInitials, logoutUser, quickLoginAs, showNotification } = useBooking();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [switching, setSwitching] = useState(null);

  const personaRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Close every transient menu when the route changes.
  useEffect(() => {
    setMobileOpen(false);
    setPersonaOpen(false);
  }, [location.pathname]);

  // Close the persona menu on outside click or Escape.
  useEffect(() => {
    if (!personaOpen) return undefined;

    const onPointerDown = (event) => {
      if (personaRef.current && !personaRef.current.contains(event.target)) {
        setPersonaOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setPersonaOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [personaOpen]);

  const handleSelectPersona = async (email) => {
    setSwitching(email);
    try {
      await quickLoginAs(email);
      setPersonaOpen(false);
      setMobileOpen(false);
    } catch (err) {
      showNotification(err.message || 'Could not sign in as that persona.', 'error');
    } finally {
      setSwitching(null);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setPersonaOpen(false);
    setMobileOpen(false);
  };

  return (
    <header className={`nav${mobileOpen ? ' is-open' : ''}`}>
      <div className="nav__inner">
        <Link to="/" className="brand" aria-label="AeroReserve home">
          <span className="brand__mark">
            <PlaneIcon size={21} strokeWidth={2} />
          </span>
          <span>
            <span className="brand__name">
              Aero<em>Reserve</em>
            </span>
            <span className="brand__tag">Reservation deck</span>
          </span>
        </Link>

        <button
          type="button"
          className="nav-burger"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          aria-controls="primary-nav"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>

        <div className="nav__panel" id="primary-nav">
          <nav className="nav__links" aria-label="Primary">
            <NavLink to="/" end className={navLinkClass}>
              Search flights
            </NavLink>
            {user && (
              <NavLink to="/my-bookings" className={navLinkClass}>
                My bookings
              </NavLink>
            )}
            <NavLink to="/auth" className={navLinkClass}>
              Account
            </NavLink>
          </nav>

          <div className="nav__actions">
            <div className="persona-wrap" ref={personaRef}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-expanded={personaOpen}
                aria-haspopup="menu"
                onClick={() => setPersonaOpen((open) => !open)}
              >
                <SparkleIcon size={14} />
                Demo personas
                <ChevronDownIcon size={12} />
              </button>

              {personaOpen && (
                <div className="persona-menu" role="menu" aria-label="Demo personas">
                  <div className="persona-menu__label">Sign in as — tests priority seating</div>
                  {SAMPLE_PERSONAS.map((persona) => {
                    const active = user?.email === persona.email;
                    return (
                      <button
                        key={persona.email}
                        type="button"
                        role="menuitem"
                        className={`persona-item${active ? ' is-active' : ''}`}
                        onClick={() => handleSelectPersona(persona.email)}
                        disabled={switching === persona.email}
                      >
                        <span className="persona-item__row">
                          <span className="persona-item__name">{persona.name}</span>
                          <span className="badge badge-priority">{persona.badge}</span>
                        </span>
                        <span className="persona-item__role">{persona.role}</span>
                        <span className="persona-item__score">
                          {switching === persona.email
                            ? 'Signing in…'
                            : `Priority score ${persona.priority}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {user ? (
              <div className="user-chip">
                <span className="user-chip__avatar" aria-hidden="true">
                  {userInitials || 'AR'}
                </span>
                <span className="user-chip__text">
                  <span className="user-chip__name">{user.full_name}</span>
                  <span className="user-chip__meta">
                    {user.loyalty_tier && user.loyalty_tier !== 'none'
                      ? `${user.loyalty_tier} tier`
                      : 'Standard'}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label={`Sign out ${user.full_name}`}
                  onClick={handleLogout}
                >
                  <LogOutIcon size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => navigate('/auth')}
              >
                Sign in
                <ArrowRightIcon size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
