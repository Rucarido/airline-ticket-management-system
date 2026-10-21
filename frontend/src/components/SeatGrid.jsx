// =============================================================================
// components/SeatGrid.jsx — Interactive 20-row aircraft cabin
// =============================================================================
// Seats are real <button> elements so keyboard and screen-reader users can book.
// Unavailable seats are genuinely disabled (not just visually dimmed), and the
// cabin scrolls horizontally on narrow screens instead of shrinking below the
// minimum touch target.
// =============================================================================
import { useMemo } from 'react';
import { PlaneIcon, SparkleIcon } from './Icons';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const LEFT = ['A', 'B', 'C'];
const RIGHT = ['D', 'E', 'F'];

const CLASS_LABEL = {
  first: 'First class',
  business: 'Business class',
  economy: 'Economy class',
};

const CLASS_BADGE = {
  first: 'badge badge-first',
  business: 'badge badge-business',
  economy: 'badge badge-economy',
};

function seatAriaLabel(seat, flags) {
  const parts = [
    `Seat ${seat.row_num}${seat.seat_letter}`,
    CLASS_LABEL[seat.class] || seat.class,
  ];
  if (seat.is_window) parts.push('window');
  if (seat.is_aisle) parts.push('aisle');
  if (seat.is_exit_row) parts.push('exit row');
  if (flags.isSelected) parts.push('selected');
  else if (flags.isReserved) parts.push('unavailable, already booked');
  else if (flags.isOtherHold) parts.push('unavailable, held by another passenger');
  else if (flags.isRestricted) parts.push('unavailable, restricted for your profile');
  else if (flags.isRecommended) parts.push('recommended for you');
  if (flags.isOwnHold) parts.push('your current hold');
  return parts.join(', ');
}

export default function SeatGrid({ seats, selectedSeat, onSelectSeat, disabled = false }) {
  const { rows, rowNumbers } = useMemo(() => {
    const maxRow = seats.reduce((max, seat) => Math.max(max, Number(seat.row_num) || 0), 0);
    const totalRows = Math.max(20, maxRow);
    const map = {};

    for (let row = 1; row <= totalRows; row += 1) {
      map[row] = { A: null, B: null, C: null, D: null, E: null, F: null };
    }
    seats.forEach((seat) => {
      if (map[seat.row_num] && LETTERS.includes(seat.seat_letter)) {
        map[seat.row_num][seat.seat_letter] = seat;
      }
    });

    return {
      rows: map,
      rowNumbers: Array.from({ length: totalRows }, (_, index) => index + 1),
    };
  }, [seats]);

  const renderSeat = (seat, letter) => {
    if (!seat) {
      return (
        <span
          key={`empty-${letter}`}
          className="seat-cell"
          style={{ visibility: 'hidden' }}
          aria-hidden="true"
        />
      );
    }

    const isSelected = selectedSeat?.seat_id === seat.seat_id;
    const isReserved = Boolean(seat.is_reserved);
    const isOwnHold = Boolean(seat.is_held && seat.held_by_me && !isSelected);
    const isOtherHold = Boolean(seat.is_held && !seat.held_by_me && !isSelected);
    const isRestricted = Boolean(seat.is_restricted);
    const isRecommended = Boolean(seat.is_recommended) && !isReserved && !isOtherHold;
    const isDisabled = disabled || isReserved || isOtherHold || isRestricted;

    let className = 'seat-cell seat-available';
    if (isReserved) className = 'seat-cell seat-reserved';
    else if (isRestricted) className = 'seat-cell seat-restricted';
    else if (isOtherHold) className = 'seat-cell seat-held';
    else if (isSelected) className = 'seat-cell seat-selected';
    else if (isOwnHold) className = 'seat-cell seat-own-hold';
    else if (isRecommended) className = 'seat-cell seat-recommended';

    const flags = { isSelected, isReserved, isOwnHold, isOtherHold, isRestricted, isRecommended };

    return (
      <button
        key={seat.seat_id}
        type="button"
        className={className}
        onClick={() => onSelectSeat(seat)}
        disabled={isDisabled}
        aria-pressed={isSelected}
        aria-label={seatAriaLabel(seat, flags)}
        title={seatAriaLabel(seat, flags)}
      >
        <span>{seat.seat_letter}</span>
        {isRecommended && (
          <span className="seat-star" aria-hidden="true">
            <SparkleIcon size={8} strokeWidth={2.4} />
          </span>
        )}
      </button>
    );
  };

  // Group consecutive rows by cabin class so dividers appear exactly where the
  // backend data changes class (no hard-coded row numbers).
  const sections = [];
  rowNumbers.forEach((rowNumber) => {
    const rowSeats = rows[rowNumber];
    const sample = rowSeats.A || rowSeats.B || rowSeats.C || rowSeats.D || rowSeats.E || rowSeats.F;
    const cabin = sample?.class || 'economy';
    const last = sections[sections.length - 1];
    if (!last || last.cabin !== cabin) {
      sections.push({ cabin, from: rowNumber, to: rowNumber });
    } else {
      last.to = rowNumber;
    }
  });

  return (
    <div className="cabin-scroll">
      <div className="airplane-fuselage">
        <div className="airplane-nose">
          <PlaneIcon size={12} />
          Cockpit
        </div>

        <div className="legend" aria-label="Seat legend">
          <span className="legend__item">
            <span className="legend__swatch" aria-hidden="true" /> Available
          </span>
          <span className="legend__item">
            <span className="legend__swatch" aria-hidden="true" style={{ background: 'linear-gradient(150deg,#46d5ff,#6d7cff)', borderColor: '#dff7ff' }} /> Selected
          </span>
          <span className="legend__item">
            <span className="legend__swatch" aria-hidden="true" style={{ background: 'rgba(52,224,161,.18)', borderColor: 'rgba(52,224,161,.6)' }} /> Priority aisle
          </span>
          <span className="legend__item">
            <span className="legend__swatch" aria-hidden="true" style={{ background: 'rgba(255,191,77,.18)', borderColor: 'rgba(255,191,77,.55)' }} /> Held
          </span>
          <span className="legend__item">
            <span className="legend__swatch" aria-hidden="true" style={{ background: 'rgba(148,178,220,.04)', borderColor: 'rgba(148,178,220,.12)' }} /> Booked
          </span>
        </div>

        {sections.map((section) => (
          <div key={`${section.cabin}-${section.from}`}>
            <div className="section-divider">
              <span className={CLASS_BADGE[section.cabin] || 'badge badge-economy'}>
                {CLASS_LABEL[section.cabin] || section.cabin} · rows {section.from}–{section.to}
              </span>
            </div>

            {rowNumbers
              .filter((rowNumber) => rowNumber >= section.from && rowNumber <= section.to)
              .map((rowNumber) => {
                const rowSeats = rows[rowNumber];
                const isExit = LETTERS.some((letter) => rowSeats[letter]?.is_exit_row);
                return (
                  <div
                    key={rowNumber}
                    className={`seat-row${isExit ? ' exit-row-banner' : ''}`}
                  >
                    {isExit && <div className="exit-row-label">Emergency exit row · restricted</div>}
                    <div className="seat-side">
                      {LEFT.map((letter) => renderSeat(rowSeats[letter], letter))}
                    </div>
                    <div className="seat-aisle-spacer" aria-hidden="true">
                      {rowNumber}
                    </div>
                    <div className="seat-side">
                      {RIGHT.map((letter) => renderSeat(rowSeats[letter], letter))}
                    </div>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
