"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draggable column widths, remembered per grid.
 *
 * Widths live in localStorage so a layout someone has adjusted survives a
 * reload. Every read and write is wrapped: localStorage throws outright in some
 * contexts (private windows, blocked site data), and a grid that cannot render
 * because it could not remember a column width is a worse bug than a column
 * being the wrong width.
 */

export interface ColumnWidths {
  width: (key: string, fallback: number) => number;
  startResize: (key: string, fallback: number) => (e: React.MouseEvent) => void;
  reset: () => void;
  resizing: string | null;
  /** True once any column has been adjusted, so a Reset control can hide itself. */
  customised: boolean;
}

const MIN_WIDTH = 48;
const MAX_WIDTH = 900;

export function useColumnWidths(storageKey: string): ColumnWidths {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<string | null>(null);

  // A ref as well as state: the mousemove handler is attached once and would
  // otherwise close over the widths from the render that created it.
  const drag = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setWidths(JSON.parse(raw));
    } catch {
      // No stored layout, or storage is unavailable. Defaults are fine.
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: Record<string, number>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Widths still apply for this session; they just will not be remembered.
      }
    },
    [storageKey]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, d.startWidth + (e.clientX - d.startX)));
      setWidths((prev) => ({ ...prev, [d.key]: next }));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      setResizing(null);
      // Read the committed state rather than the drag's last frame.
      setWidths((prev) => {
        persist(prev);
        return prev;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [persist]);

  const width = useCallback((key: string, fallback: number) => widths[key] ?? fallback, [widths]);

  const startResize = useCallback(
    (key: string, fallback: number) => (e: React.MouseEvent) => {
      // The handle sits inside a header that sorts on click. Without this, every
      // resize would also re-sort the grid under the cursor.
      e.preventDefault();
      e.stopPropagation();
      drag.current = { key, startX: e.clientX, startWidth: widths[key] ?? fallback };
      setResizing(key);
    },
    [widths]
  );

  const reset = useCallback(() => {
    setWidths({});
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Nothing stored to clear.
    }
  }, [storageKey]);

  return { width, startResize, reset, resizing, customised: Object.keys(widths).length > 0 };
}
