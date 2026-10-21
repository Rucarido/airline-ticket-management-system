// =============================================================================
// App.jsx — Routing, shell chrome, atmosphere, and the global toast
// =============================================================================
import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';

import './App.css';
import { BookingProvider, useBooking } from './BookingContext';
import Navbar from './components/Navbar';
import {
  AlertIcon,
  CheckCircleIcon,
  InfoIcon,
  PlaneIcon,
  XIcon,
} from './components/Icons';

import Home from './pages/Home';
import Flights from './pages/Flights';
import SeatMap from './pages/SeatMap';
import Checkout from './pages/Checkout';
import Confirmation from './pages/Confirmation';
import MyBookings from './pages/MyBookings';
import Auth from './pages/Auth';

const TOAST_META = {
  success: { Icon: CheckCircleIcon, label: 'Confirmed' },
  error: { Icon: AlertIcon, label: 'Action needed' },
  warning: { Icon: AlertIcon, label: 'Heads up' },
  info: { Icon: InfoIcon, label: 'System' },
};

function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="atmosphere__grid" />
      <div className="atmosphere__orb atmosphere__orb--a" />
      <div className="atmosphere__orb atmosphere__orb--b" />
      <div className="atmosphere__orb atmosphere__orb--c" />
      <div className="atmosphere__scan" />
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

function NotificationToast() {
  const { notification, dismissNotification } = useBooking();
  if (!notification) return null;

  const type = TOAST_META[notification.type] ? notification.type : 'info';
  const { Icon, label } = TOAST_META[type];

  return (
    <div className={`toast toast--${type}`} role="status" aria-live="polite">
      <span className="toast__icon">
        <Icon size={16} />
      </span>
      <div className="toast__body">
        <div className="toast__title">{label}</div>
        <div className="toast__msg">{notification.message}</div>
      </div>
      <button
        type="button"
        className="toast__close"
        onClick={dismissNotification}
        aria-label="Dismiss notification"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <PlaneIcon size={15} />
          AeroReserve
        </div>
        <div className="footer__meta">
          Advanced Database Systems · PostgreSQL 16 · Redis 8 · Kafka 7.6 · React 19
        </div>
      </div>
    </footer>
  );
}

function MainLayout() {
  return (
    <div className="app-shell">
      <Atmosphere />
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <ScrollToTop />
      <Navbar />
      <NotificationToast />
      <main id="main" className="site-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/flights" element={<Flights />} />
          <Route path="/seats/:flightId" element={<SeatMap />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/confirmation" element={<Confirmation />} />
          <Route path="/my-bookings" element={<MyBookings />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <BookingProvider>
        <MainLayout />
      </BookingProvider>
    </BrowserRouter>
  );
}
