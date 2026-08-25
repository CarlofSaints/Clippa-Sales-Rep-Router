/**
 * SQL Proxy client — calls the Railway-hosted `aria-sql-proxy`.
 *
 * This app never connects to SQL Server directly. It calls a shared proxy over
 * HTTPS; the proxy holds the credentials and, more importantly, a STATIC
 * outbound IP that is whitelisted on the SQL Server firewall. Vercel's egress
 * addresses are dynamic, which is the entire reason the proxy exists.
 *
 * ⚠️ It is a SHARED service. The ARIA Scorecard portal, the Haier BA Tracker and
 * iRam LIVE all call the same instance with the same key. Its named-query
 * registry is additive, so adding a query for this app is safe, but changing or
 * removing one is not.
 *
 * ⚠️ The proxy REFUSES raw SQL. `query` must name something already registered
 * in `aria-sql-proxy/src/routes/query.ts`. That is the security property worth
 * preserving: a compromised caller can run the queries somebody reviewed, and
 * nothing else.
 *
 * Env (same values the other three apps use):
 *   SQL_PROXY_URL      base URL, no trailing slash, no /query
 *   SQL_PROXY_API_KEY  shared secret, sent as x-api-key
 */

/** Tolerate a bare domain and a trailing slash, so `${base}/query` always resolves. */
function normaliseBase(raw: string): string {
  let u = (raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, "");
}

const PROXY_URL = () => normaliseBase(process.env.SQL_PROXY_URL || "");
const PROXY_KEY = () => (process.env.SQL_PROXY_API_KEY || "").trim();

/** The client's name as SQL knows it. Confirm against `list_clients` before trusting it. */
export const CLIPPA_SQL_CLIENT = "CLIPPA SALES";

export interface ProxyResponse<T = Record<string, unknown>> {
  data: T[];
  count: number;
}

export function isSqlProxyConfigured(): boolean {
  return Boolean(PROXY_URL() && PROXY_KEY());
}

/**
 * Run a NAMED query on the proxy.
 *
 * Errors carry the proxy's own message: a 401 means the key is wrong, and a 400
 * naming an unknown query means it has not been registered yet, which is a
 * different problem with a different fix. Collapsing them into "SQL failed"
 * wastes the one clue there is.
 */
export async function sqlQuery<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {},
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {}
): Promise<ProxyResponse<T>> {
  const base = PROXY_URL();
  const key = PROXY_KEY();
  if (!base || !key) {
    throw new Error("SQL_PROXY_URL or SQL_PROXY_API_KEY is not set on this deployment.");
  }

  // A hung proxy must not hold a serverless function open until the platform
  // kills it, because that failure arrives with no message at all.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, params }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SQL proxy returned ${res.status}: ${body.slice(0, 400)}`);
    }
    return (await res.json()) as ProxyResponse<T>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`The SQL proxy did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface ColumnProfile {
  name: string;
  /** How many of the sampled rows have a non-empty value. */
  populated: number;
  populatedPercent: number;
  /** One real value, so "what does this actually look like" is answerable. */
  sample: string | null;
}

/**
 * Describe what came back.
 *
 * Reports how POPULATED each column is, not merely which columns exist. A column
 * that is present but empty on every row is the difference between "SQL has this
 * data" and "SQL has somewhere to put it", and only the second one blocks us.
 *
 * Columns are collected across ALL sampled rows rather than read off row one,
 * because these result sets are sparse and row one routinely omits fields that
 * later rows carry.
 */
export function profileColumns(rows: Record<string, unknown>[], sampleSize = 200): ColumnProfile[] {
  const sample = rows.slice(0, sampleSize);
  const names = new Set<string>();
  for (const row of sample) for (const k of Object.keys(row)) names.add(k);

  const isEmpty = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "");

  return [...names].map((name) => {
    let populated = 0;
    let firstValue: string | null = null;
    for (const row of sample) {
      const v = row[name];
      if (isEmpty(v)) continue;
      populated++;
      if (firstValue === null) firstValue = String(v).slice(0, 60);
    }
    return {
      name,
      populated,
      populatedPercent: sample.length === 0 ? 0 : Math.round((populated / sample.length) * 1000) / 10,
      sample: firstValue,
    };
  }).sort((a, b) => b.populated - a.populated || a.name.localeCompare(b.name));
}
