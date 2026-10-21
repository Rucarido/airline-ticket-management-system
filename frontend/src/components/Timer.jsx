// =============================================================================
// components/Timer.jsx — Redis hold countdown
// =============================================================================
// One-shot by design: after expiry it fires onExpire exactly once per
// `expiresAt` value, even if the parent re-renders or StrictMode replays the
// effect. The callback is read from a ref so a new function identity does not
// restart the countdown.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { ClockIcon } from './Icons';

function secondsUntil(expiresAt) {
  const target = Number(expiresAt);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

export default function Timer({
  expiresAt,
  onExpire,
  label = 'Seat hold active',
  sublabel = 'Redis TTL · 600s',
}) {
  const [timeLeft, setTimeLeft] = useState(() => secondsUntil(expiresAt));

  const onExpireRef = useRef(onExpire);
  const firedRef = useRef(false);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    firedRef.current = false;

    const tick = () => {
      const remaining = secondsUntil(expiresAt);
      setTimeLeft(remaining);

      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        if (typeof onExpireRef.current === 'function') {
          onExpireRef.current();
        }
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [expiresAt]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const variant =
    timeLeft <= 120 ? ' timer--critical' : timeLeft <= 300 ? ' timer--warning' : '';

  return (
    <div
      className={`timer${variant}`}
      role="timer"
      aria-live="off"
      aria-label={`${label}: ${minutes} minutes ${seconds} seconds remaining`}
    >
      <span className="timer__icon">
        <ClockIcon size={17} />
      </span>
      <span>
        <span className="timer__label">{label}</span>
        <span className="timer__sub">{sublabel}</span>
      </span>
      <span className="timer__time">{formatted}</span>
    </div>
  );
}
