/**
 * Fixed-window rate limiting per client, with the IETF RateLimit header
 * fields (draft-ietf-httpapi-ratelimit-headers):
 *
 *   RateLimit-Policy: "default";q=120;w=60
 *   RateLimit: "default";r=117;t=42
 *
 * plus the widely deployed RateLimit-Limit / RateLimit-Remaining /
 * RateLimit-Reset fields, and Retry-After on 429 (RFC 9110). In-memory, so
 * the limit applies per server process.
 */

import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

export interface RateLimitOptions {
  /** Requests allowed per window and client. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Policy name used in the RateLimit / RateLimit-Policy fields. */
  policy?: string;
  /** Clock override for tests (ms). */
  now?: () => number;
}

export const RATE_LIMIT_HEADERS = ["RateLimit", "RateLimit-Policy", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"];

/**
 * The client a request is counted against. Behind the shep.bot edge, Caddy
 * replaces any client-sent X-Forwarded-For with the real address and
 * ingress-nginx appends after it, so the leftmost entry is the client.
 */
export function clientKey(c: Context): string {
  const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { limit, windowSec } = opts;
  const policy = opts.policy ?? "default";
  const now = opts.now ?? Date.now;
  const windowMs = windowSec * 1000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;

  return async (c, next) => {
    const t = now();
    if (t >= nextSweep) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      nextSweep = t + windowMs;
    }
    const key = clientKey(c);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    const remaining = Math.max(0, limit - entry.count);
    const reset = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    const headers: Record<string, string> = {
      "RateLimit-Policy": `"${policy}";q=${limit};w=${windowSec}`,
      RateLimit: `"${policy}";r=${remaining};t=${reset}`,
      "RateLimit-Limit": String(limit),
      "RateLimit-Remaining": String(remaining),
      "RateLimit-Reset": String(reset),
    };
    if (entry.count > limit) {
      return c.json(
        { error: `Rate limit exceeded: ${limit} requests per ${windowSec}s. Retry after ${reset}s.`, retryAfter: reset },
        429,
        { ...headers, "Retry-After": String(reset) },
      );
    }
    await next();
    for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
  };
}
