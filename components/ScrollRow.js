'use client';
import { useRef } from 'react';

const DRAG_THRESHOLD_PX = 6;

/**
 * Horizontal card row that can be dragged with the mouse.
 * Touch and trackpad scrolling keep using the native overflow behavior;
 * this only adds click-and-drag for mouse users, where a hidden scrollbar
 * otherwise makes the overflow unreachable.
 */
export default function ScrollRow({ className = 'anime-row', children }) {
  const rowRef = useRef(null);
  const dragRef = useRef({ pointerId: null, startX: 0, startScrollLeft: 0, dragged: false });

  function handlePointerDown(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const row = rowRef.current;
    if (!row || row.scrollWidth <= row.clientWidth) return;

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: row.scrollLeft,
      dragged: false,
    };
  }

  function handlePointerMove(e) {
    const drag = dragRef.current;
    const row = rowRef.current;
    if (!row || drag.pointerId !== e.pointerId) return;

    const deltaX = e.clientX - drag.startX;
    if (!drag.dragged) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;
      drag.dragged = true;
      row.classList.add('dragging');
      try {
        row.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort; dragging still works without it.
      }
    }

    row.scrollLeft = drag.startScrollLeft - deltaX;
  }

  function handlePointerEnd(e) {
    const drag = dragRef.current;
    const row = rowRef.current;
    if (drag.pointerId !== e.pointerId) return;

    drag.pointerId = null;
    if (row) {
      row.classList.remove('dragging');
      try {
        row.releasePointerCapture(e.pointerId);
      } catch {
        // Already released.
      }
    }

    if (drag.dragged) {
      // Let the trailing click fire (and get suppressed) before clearing.
      window.setTimeout(() => {
        dragRef.current.dragged = false;
      }, 0);
    }
  }

  function handleClickCapture(e) {
    if (dragRef.current.dragged) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current.dragged = false;
    }
  }

  return (
    <div
      ref={rowRef}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={handleClickCapture}
      onDragStart={e => e.preventDefault()}
    >
      {children}
    </div>
  );
}
