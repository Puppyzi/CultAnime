'use client';

import { useEffect, useId, useRef, useState } from 'react';

export default function SeasonSelector({ seasons, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionsRef = useRef([]);
  const menuId = useId();
  const selectedIndex = Math.max(
    0,
    seasons.findIndex((season) => season.id === selectedId)
  );
  const selected = seasons[selectedIndex];

  useEffect(() => {
    if (!open) return;
    optionsRef.current[selectedIndex]?.focus();
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, selectedIndex]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event, index) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % seasons.length
        : event.key === 'ArrowUp'
          ? (index - 1 + seasons.length) % seasons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? seasons.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      optionsRef.current[next]?.focus();
    }
  }

  if (!selected) return null;

  return (
    <div
      className="season-selector"
      ref={rootRef}
      onBlur={(event) => {
        // Touch browsers can clear focus before dispatching an option's click.
        // Outside taps are handled by pointerdown; only close here for a known focus destination.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="season-selector-trigger"
        aria-label={'Select season: ' + selected.season_label}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === 'Escape') close();
        }}
      >
        <span className={'season-selector-chevron' + (open ? ' open' : '')} aria-hidden="true">
          ▾
        </span>
        <span>{selected.season_label}</span>
      </button>
      {open && (
        <div id={menuId} className="season-selector-menu" role="menu" aria-label="Available seasons">
          {seasons.map((season, index) => (
            <button
              key={season.id}
              ref={(element) => {
                optionsRef.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={season.id === selectedId}
              className={'season-selector-option' + (season.id === selectedId ? ' active' : '')}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => {
                onChange(season.id);
                close();
              }}
            >
              <span>{season.season_label}</span>
              <span className="season-selector-count">
                {season.episode_count} {season.episode_count === 1 ? 'Episode' : 'Episodes'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
