# AeroReserve — Frontend Design System

> Contract for every screen in `frontend/src`. If a rule is not written here, it is not
> part of the redesign. Implementation lives in `src/index.css` (tokens + components) and
> `src/App.css` (motion).

---

## 1. Creative direction — "Runway Deck"

A dark, precision-instrument aesthetic borrowed from airport operations rooms and premium
airline boarding passes: deep midnight blue, cyan instrument light, indigo depth, thin
luminous rules, and a faint perspective grid suggesting a runway at night.

The interface must feel **engineered, not decorative**. Motion communicates state:
things rise into place, instruments pulse, the hold timer breathes, the boarding pass
unfolds. Nothing bounces for amusement.

**Three rules**
1. One accent per semantic action. Cyan = primary/informational, emerald = success/price,
   amber = temporary hold/warning, red = danger/cancelled, violet = first class.
2. Depth is light, not shadow soup. Use a single soft glow + hairline border, never stacked
   drop shadows.
3. Data is the hero. Typography and spacing carry the hierarchy; emoji never replaces an icon
   in primary controls or data rows.

---

## 2. Color tokens (`:root`)

| Token | Value | Use |
|---|---|---|
| `--bg-0` | `#05080f` | Page base |
| `--bg-1` | `#080d18` | Section base |
| `--surface` | `rgba(15, 24, 43, 0.72)` | Glass panels |
| `--surface-strong` | `rgba(20, 31, 55, 0.92)` | Menus, fixed bars |
| `--line` | `rgba(148, 178, 220, 0.14)` | Hairline borders |
| `--line-strong` | `rgba(148, 178, 220, 0.28)` | Focused/hover borders |
| `--ink` | `#f2f7ff` | Primary text |
| `--ink-2` | `#a9bad3` | Secondary text |
| `--ink-3` | `#6c7f9c` | Tertiary/meta |
| `--cyan` | `#46d5ff` | Primary accent |
| `--indigo` | `#6d7cff` | Secondary accent |
| `--emerald` | `#34e0a1` | Success, money |
| `--amber` | `#ffbf4d` | Hold / warning |
| `--red` | `#ff6b7a` | Error / cancelled |
| `--violet` | `#b98cff` | First class |

Cabin classes: first `--violet`, business `--indigo`, economy `--emerald`.

---

## 3. Typography

- Family: `Plus Jakarta Sans` (already loaded in `index.html`), fallback system-ui.
- Mono: `ui-monospace, SFMono-Regular, Menlo, monospace` for PNR, timer, prices, codes.
- Scale (clamped, fluid):
  - Display `clamp(2.4rem, 6vw, 4.4rem)` / 800 / -0.045em
  - H1 `clamp(1.9rem, 3.4vw, 2.6rem)` / 800 / -0.03em
  - H2 `1.35rem` / 700 / -0.02em
  - H3 `1.02rem` / 700
  - Body `0.95rem` / 1.65
  - Meta `0.78rem` / 600 / uppercase tracking `0.12em`
- No text below `0.7rem`. No pure `#fff` on large surfaces (use `--ink`).

---

## 4. Space, radius, elevation

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 56, 80 px.
- Radii: `--r-sm 10px`, `--r-md 14px`, `--r-lg 20px`, `--r-xl 28px`, pill `999px`.
- Elevation:
  - `--shadow-1`: `0 1px 0 rgba(255,255,255,.04) inset, 0 8px 24px rgba(0,0,0,.35)`
  - `--shadow-2`: `0 18px 48px rgba(0,0,0,.5)`
  - Accent glow only on the active element: `0 0 0 1px rgba(70,213,255,.35), 0 12px 40px rgba(70,213,255,.12)`
- Container: `1180px`, gutter `clamp(16px, 4vw, 32px)`.

---

## 5. Components (class contract)

**Shell** — `.app-shell`, `.site-main`, `.container`, `.page`, `.page-head`, `.eyebrow`,
`.page-title`, `.page-sub`, `.flow` (booking progress), `.flow__step`.

**Navigation** — `.nav`, `.nav__inner`, `.brand`, `.brand__mark`, `.brand__name`,
`.nav__links`, `.nav-link`, `.nav__actions`, `.nav-burger`, `.nav__panel`,
`.persona-menu`, `.persona-item`, `.user-chip`.

**Surfaces** — `.panel`, `.panel--pad`, `.panel--accent`, `.card`, `.card--interactive`,
`.empty-state`, `.error-banner`, `.skeleton`.

**Controls** — `.btn` + `.btn--primary|--ghost|--danger|--block|--sm|--lg`,
`.field`, `.field__label`, `.field__hint`, `.input`, `.select`, `.checkbox`.

**Hero** — `.hero`, `.hero__copy`, `.hero__kicker`, `.hero__title`, `.hero__lead`,
`.hero__stats`, `.stat`, `.search-panel`.

**Cards** — `.persona-card`, `.feature-card`, `.tech-strip`, `.tech-pill`.

**Flights** — `.flight-card`, `.flight-card__id`, `.flight-route`, `.route-node`,
`.route-line`, `.price-block`, `.class-prices`, `.class-chip`.

**Seats** — `.cabin-scroll`, `.airplane-fuselage`, `.airplane-nose`, `.seat-row`,
`.seat-side`, `.seat-aisle-spacer`, `.seat-cell`, `.seat-available`, `.seat-reserved`,
`.seat-held`, `.seat-selected`, `.seat-recommended`, `.seat-restricted`, `.legend`,
`.legend__item`, `.section-divider`, `.hold-bar`, `.hold-bar__inner`, `.timer`,
`.priority-banner`.

**Checkout / pass** — `.review-grid`, `.review-item`, `.price-table`, `.price-row`,
`.price-row--total`, `.acid-note`, `.boarding-pass`, `.boarding-pass__bar`, `.pnr`,
`.barcode`, `.pass-grid`, `.pass-field`.

**Feedback** — `.toast`, `.toast--{success,error,warning,info}`, `.toast__icon`,
`.toast__close`.

Utilities: `.muted`, `.dim`, `.mono`, `.row`, `.between`, `.wrap`, `.stack`,
`.sr-only`, `.skip-link`.

---

## 6. Motion

- Engine: CSS keyframes + the Web Animations API for entrances; **anime.js 4** for
  scroll-reveal of `[data-reveal]` elements (`src/lib/motion.js`).
- Durations: micro 120–180ms, standard 240–320ms, entrance 600–800ms.
- Easing: `cubic-bezier(.16,1,.3,1)` (out-expo) for entrances; `ease` for color only.
- Ambient loops allowed: 18–26s drift on background orbs, 3s pulse on live indicators.
- Only animate `transform`, `opacity`, `filter`. Never animate layout properties.
- Every entrance has a reduced-motion fallback that renders the final state immediately.
- `prefers-reduced-motion: reduce` disables all animation and smooth scrolling globally.

---

## 7. Accessibility

- Minimum contrast 4.5:1 for body text, 3:1 for large text and focus rings.
- Visible `:focus-visible` ring: `0 0 0 2px var(--bg-0), 0 0 0 4px var(--cyan)`.
- Every input has an associated `<label htmlFor>`; every icon-only control has `aria-label`.
- Seats are real `<button>` elements with `aria-label`, `aria-pressed`, and `disabled` for
  unavailable states. Legend swatches are `aria-hidden`.
- Skip link to `#main`.
- Status changes go through `role="status"` (toast) and `aria-live="polite"`.
- Touch targets ≥ 40px; the cabin scrolls horizontally instead of shrinking below 36px.

---

## 8. Responsive

| Width | Behaviour |
|---|---|
| ≥ 1024px | Two-column hero, cabin + 320px sidebar, 3-up cards |
| 768–1023px | Stacked hero, cabin full width, 2-up cards |
| < 768px | Single column, burger nav, horizontal cabin scroll, stacked hold bar |
| < 480px | Fluid type, full-width buttons, 38px seats |

---

## 9. Non-negotiables

- Do not change API paths, request bodies, or the backend contract.
- Seat map payload is `{ seats, total_seats, user_priority }`; normalize once in `api.js`.
- Hold TTL comes from `ttl_seconds`; default 600.
- The authoritative price is the one returned by `POST /api/bookings`
  (`booking.final_price`), not a client-side calculation.
- No new runtime dependency. Motion uses the native Web Animations API and CSS,
  with an immediate-visible fallback for `prefers-reduced-motion`.
