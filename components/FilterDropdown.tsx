"use client";

import { useState, useEffect, useRef } from "react";

/**
 * A multi-select filter chip with its own search box.
 *
 * Lifted out of the Stores page when a second grid needed one. It was already
 * the third inline copy of a filter in this app when the sortable-header work
 * consolidated those, so it moves here before a fourth appears.
 */
export function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(next);
  };

  const activeCount = selected.size;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-clippa-red ${
          activeCount > 0
            ? "border-clippa-red bg-red-50 text-clippa-red font-medium"
            : "border-gray-200 text-gray-700 hover:bg-gray-50"
        }`}
      >
        {label}
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-clippa-red text-white text-[10px] font-bold">
            {activeCount}
          </span>
        )}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-clippa-red"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-2">No matches</p>
            ) : (
              filtered.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.value)}
                    onChange={() => toggle(o.value)}
                    className="accent-clippa-red w-3.5 h-3.5"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>
          {activeCount > 0 && (
            <div className="p-2 border-t border-gray-100">
              <button
                onClick={() => onChange(new Set())}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
