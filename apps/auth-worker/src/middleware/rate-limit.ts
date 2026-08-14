import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../env.js';

/**
 * A per-IP rate limit on the unauthenticated surface — ported from
 * Board_Game_Catalog's middleware (PLATFORM.md §4.1 requires this posture
 * wherever the Worker is the only gate; conformance §8.2 #7).
 *
 * Two endpoints here are reachable without a valid credential: `/api/health`
 * (open by design) and every route's token check, which runs before its 401.
 * Verifying a signature is real CPU; an attacker who cannot pass the check
 * can still make us try.
 *
 * ⚠️ Fails OPEN if the binding is missing — a deliberate trade. A
 * misconfigured binding failing closed would take the estate's admissions
 * down to prevent a hypothetical abuse; failing open returns to the prior
 * posture and says so in the log. The binding is optional in `Env` for the
 * same reason: `wrangler dev` without it should run the app, not refuse.
 */

/** Cloudflare's rate-limiting binding. Not yet in @cloudflare/workers-types. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function rateLimit(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const limiter = c.env.RATE_LIMITER;
    if (!limiter) {
      // Once per isolate is plenty; this is a config error, not a request error.
      if (!warned) {
        warned = true;
        console.warn('RATE_LIMITER binding missing — unauthenticated surface is unthrottled');
      }
      return next();
    }

    // CF-Connecting-IP is set by Cloudflare on every request that reaches a
    // Worker and cannot be spoofed by the client — unlike X-Forwarded-For.
    const ip = c.req.header('CF-Connecting-IP');
    // No IP means the request did not arrive through the edge — a test, or
    // `wrangler dev`. A constant key would throttle all of local dev together.
    if (!ip) return next();

    const { success } = await limiter.limit({ key: ip });
    if (!success) {
      return c.json(
        { error: 'rate_limited', detail: 'Too many requests. Wait a moment and try again.' },
        429,
      );
    }
    await next();
  };
}

let warned = false;
