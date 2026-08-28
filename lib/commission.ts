/**
 * What a rep earns on their portfolio.
 *
 * Every number here is a SETTING, never a constant. The rate and the threshold
 * were 3.25% and R550 000 a month when this was written, and the whole point of
 * this file is that nobody has to touch code when they change. A rate baked
 * into a component is a rate somebody eventually pays the wrong person on.
 *
 * Pure on purpose: this decides money, so it is asserted directly rather than
 * inferred from what a page happens to render.
 */

export type ThresholdBasis =
  /** Commission is paid on the revenue ABOVE the threshold only. */
  | "excess"
  /** The threshold is a gate: clear it and the FULL portfolio earns. */
  | "gate";

export interface CommissionSettings {
  /** Percent, as a percent. 3.25 means 3.25%, not 325%. */
  ratePercent: number;
  /** Rands of portfolio revenue per month before anything is earned. */
  thresholdMonthly: number;
  /**
   * ⚠️ Which of the two readings of "3.25% from R550k" applies.
   *
   * Settable rather than assumed, because the phrase is genuinely ambiguous and
   * the two answers differ by a factor of three on a real portfolio. Getting it
   * wrong is a payroll error, not a display bug.
   */
  basis: ThresholdBasis;
  /** Free text, so whoever changes the rate can say why and when. */
  note: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_COMMISSION: CommissionSettings = {
  ratePercent: 3.25,
  thresholdMonthly: 550000,
  basis: "excess",
  note: "",
  updatedAt: null,
  updatedBy: null,
};

export interface CommissionResult {
  /** The monthly revenue the calculation ran on. */
  monthlyRevenue: number;
  /** Whether the threshold was cleared at all. */
  qualifies: boolean;
  /** The rands the rate was actually applied to. */
  commissionable: number;
  /** What the rep earns for the month. */
  earning: number;
  /**
   * How far short a rep who does not qualify is, in rands. Zero once they
   * qualify. This is the number a manager can act on, and it is the reason the
   * result is an object rather than a bare number.
   */
  shortfall: number;
}

/**
 * ⚠️ Takes MONTHLY revenue. The threshold is expressed per month, so feeding it
 * a six-month portfolio total would clear the bar six times too easily. Callers
 * hold six-month IMS figures, so the division belongs at the call site where
 * the period is known, not hidden in here.
 */
export function computeCommission(
  monthlyRevenue: number,
  settings: CommissionSettings
): CommissionResult {
  const revenue = Number.isFinite(monthlyRevenue) ? Math.max(0, monthlyRevenue) : 0;
  const threshold = Math.max(0, settings.thresholdMonthly || 0);
  const rate = (settings.ratePercent || 0) / 100;

  // At exactly the threshold the rep has REACHED it, so it counts as qualifying.
  // Under "excess" that still earns nothing, which is correct and not a bug.
  const qualifies = revenue >= threshold;
  const commissionable = !qualifies ? 0 : settings.basis === "gate" ? revenue : revenue - threshold;

  return {
    monthlyRevenue: revenue,
    qualifies,
    commissionable,
    earning: commissionable * rate,
    shortfall: qualifies ? 0 : threshold - revenue,
  };
}

/** Reject nonsense before it is saved, and say which field is wrong. */
export function commissionProblem(s: Partial<CommissionSettings>): string | null {
  const rate = Number(s.ratePercent);
  const threshold = Number(s.thresholdMonthly);
  if (!Number.isFinite(rate)) return "Commission rate must be a number.";
  // 100% is allowed. Above it is almost certainly a decimal entered as a
  // percent, and silently accepting it would pay somebody their whole portfolio.
  if (rate < 0 || rate > 100) return "Commission rate must be between 0 and 100 percent.";
  if (!Number.isFinite(threshold)) return "Threshold must be a number.";
  if (threshold < 0) return "Threshold cannot be negative.";
  if (s.basis !== "excess" && s.basis !== "gate") return "Threshold basis must be either excess or gate.";
  return null;
}
