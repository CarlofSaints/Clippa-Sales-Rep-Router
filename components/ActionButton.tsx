"use client";

import type { ReactNode } from "react";

/**
 * A button that says what it is about to do.
 *
 * These pages mix three very different kinds of action — reading a cached file,
 * querying the client's SQL server for a minute, and writing to every store —
 * and the old labels ("Reload", "Apply", "Run live") gave no way to tell them
 * apart. A hint under each one is cheaper than learning the difference by
 * pressing it.
 *
 * The hint describes what happens ON PRESS, in the present tense, and always
 * says whether IMS is touched and whether anything is saved.
 */

type Variant = "primary" | "secondary" | "positive";

const STYLE: Record<Variant, string> = {
  primary: "rounded-lg bg-clippa-red px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50",
  secondary:
    "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50",
  positive:
    "rounded-lg border border-green-300 px-3 py-2 text-sm font-medium text-green-800 hover:bg-green-50 disabled:opacity-50",
};

export default function ActionButton({
  label,
  hint,
  onClick,
  disabled,
  variant = "secondary",
  title,
}: {
  label: ReactNode;
  /** What pressing it does. Keep it to one line. */
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: Variant;
  title?: string;
}) {
  return (
    <span className="inline-flex max-w-[15rem] flex-col gap-1">
      <button onClick={onClick} disabled={disabled} title={title} className={STYLE[variant]}>
        {label}
      </button>
      {/* Stays legible when the button is disabled: the hint is often the
          explanation for WHY it is disabled. */}
      <span className="text-[11px] leading-tight text-gray-500">{hint}</span>
    </span>
  );
}
