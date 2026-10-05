import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

/**
 * Throttling is off under test. The suite deliberately registers and logs in
 * far more often than any real client, so leaving limits on would only measure
 * the limiter. Every other environment, development included, gets real limits.
 */
const skip = () => process.env.NODE_ENV === 'test';

const headers = { standardHeaders: true, legacyHeaders: false } as const;

/** Refusals travel in the same envelope as every other response. */
const refusal = (message: string) => ({
    success: false as const,
    error: { code: 'RATE_LIMITED', message },
});

/** Blanket ceiling, so no single client can flood the API. */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    ...headers,
    skip,
    message: refusal('Too many requests, please try again later'),
});

/**
 * Credential endpoints. Successful calls are not counted, so someone signing in
 * legitimately is never affected while brute force is capped at ten misses.
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    ...headers,
    skip,
    message: refusal('Too many authentication attempts, please try again later'),
});

/**
 * Reset-link requests. Every one that names a real account sends a mail, and
 * every one answers 200 whether or not it did, so there are no failures for
 * `authLimiter` to count. Counted in full instead, and kept low: nobody needs
 * a sixth reset link within the hour.
 */
export const resetRequestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    ...headers,
    skip,
    message: refusal('Too many reset requests, please try again later'),
});

/**
 * Habit generation spends real money at OpenAI on every call, so it is keyed by
 * user rather than by address: sharing an office network should not let one
 * person burn everyone's quota, and rotating addresses should not multiply it.
 */
export const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    keyGenerator: req => req.userId ?? ipKeyGenerator(req.ip ?? ''),
    ...headers,
    skip,
    message: refusal('AI habit generation is limited to 5 requests per hour'),
});

/**
 * Publishing to the public library. Keyed by user for the same reason as AI
 * generation — every publication spends a moderation call — but the real reason
 * for a cap is that nothing else limits it: anyone may publish, immediately and
 * without having walked the plan, so one person could otherwise pour fifty
 * near-identical plans into the library in an afternoon.
 */
export const publishLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: 5,
    keyGenerator: req => req.userId ?? ipKeyGenerator(req.ip ?? ''),
    ...headers,
    skip,
    message: refusal('Publishing is limited to 5 plans per day'),
});

/**
 * The coach. The real limit is structural — a card is unique per period, so
 * asking again generates nothing — and this is only a ceiling for a client stuck
 * in a loop, keyed by user for the same reason the other paid endpoints are.
 */
export const coachLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    keyGenerator: req => req.userId ?? ipKeyGenerator(req.ip ?? ''),
    ...headers,
    skip,
    message: refusal('The coach is limited to 30 requests per hour'),
});
