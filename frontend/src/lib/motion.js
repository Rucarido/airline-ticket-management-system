// =============================================================================
// lib/motion.js — scroll reveal using the native Web Animations API
// =============================================================================
// No runtime dependency: the Entrance language is delivered with `element.animate`
// plus CSS transitions, so the UI never depends on an extra package being
// installed. Content is always visible when motion is reduced or WAAPI is missing.
//
// Contract:
//   * Mark elements with `data-reveal`; optionally set `data-reveal-delay="120"`.
//   * Attach the returned ref to a page/section root.
//   * Already-revealed elements are never hidden again when `deps` change.
// =============================================================================
import { useEffect, useRef } from 'react';

const EASE = 'cubic-bezier(0.22, 0.68, 0.16, 1)';
const DURATION = 700;
const STEP = 70;

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function showImmediately(element) {
  element.style.opacity = '1';
  element.style.transform = 'none';
  element.dataset.revealed = 'true';
}

function reveal(element, index) {
  if (element.dataset.revealed === 'true') return;
  element.dataset.revealed = 'true';

  const delay = Number(element.dataset.revealDelay ?? Math.min(index, 7) * STEP);

  // Final state first so the element is never left invisible if animation fails.
  element.style.opacity = '1';
  element.style.transform = 'none';

  if (typeof element.animate !== 'function') return;

  try {
    element.animate(
      [
        { opacity: 0, transform: 'translateY(22px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: DURATION,
        delay,
        easing: EASE,
        fill: 'backwards',
      }
    );
  } catch {
    /* the final inline styles already show the element */
  }
}

/**
 * Reveals every unrevealed [data-reveal] descendant once it scrolls into view.
 *
 * @param {unknown[]} deps - re-scan when these change (e.g. list data arriving)
 * @returns {import('react').RefObject<HTMLElement>}
 */
export function useReveal(deps = []) {
  const scopeRef = useRef(null);
  // Collapse the caller's dependency values into a primitive so the effect has
  // a statically verifiable, stable dependency list.
  const dependencyKey = deps.join('|');

  useEffect(() => {
    const root = scopeRef.current;
    if (!root) return undefined;

    const targets = Array.from(root.querySelectorAll('[data-reveal]'));
    if (targets.length === 0) return undefined;

    const reduceMotion =
      prefersReducedMotion() || typeof IntersectionObserver === 'undefined';

    if (reduceMotion) {
      targets.forEach(showImmediately);
      return undefined;
    }

    targets.forEach((element) => {
      // Never re-hide something a previous scan already revealed.
      if (element.dataset.revealed === 'true') return;
      element.style.opacity = '0';
      element.style.transform = 'translateY(22px)';
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          const index = targets.indexOf(entry.target);
          reveal(entry.target, index < 0 ? 0 : index);
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.08 }
    );

    targets.forEach((element) => {
      if (element.dataset.revealed === 'true') return;
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [dependencyKey]);

  return scopeRef;
}

/**
 * Runs a one-off entrance on a ref'd element. Safe when WAAPI is unavailable
 * and a no-op when the user prefers reduced motion.
 */
export function animateOnce(element, keyframes, options = {}) {
  if (!element || prefersReducedMotion() || typeof element.animate !== 'function') {
    return null;
  }
  return element.animate(keyframes, {
    duration: 600,
    easing: EASE,
    fill: 'both',
    ...options,
  });
}

export { prefersReducedMotion };
