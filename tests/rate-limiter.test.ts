import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, DEFAULT_RATE_LIMITS, withRateLimit } from '../src/utils/rate-limiter.js';

/**
 * Tests for the sliding-window rate limiter
 * Fake timers also mock Date.now, so the 60s window can be advanced deterministically.
 */

const WINDOW_MS = 60_000;

/** Track whether a promise has settled without awaiting it */
function track(promise: Promise<unknown>): { settled: () => boolean } {
  let settled = false;
  promise.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  return { settled: () => settled };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('allows requests initially', () => {
    const limiter = new RateLimiter();

    expect(limiter.canProceed()).toBe(true);
    expect(limiter.getStatus()).toEqual({
      activeRequests: 0,
      requestsInWindow: 0,
      tokensInWindow: 0,
      availableRequests: DEFAULT_RATE_LIMITS.maxRequestsPerMinute,
      availableTokens: DEFAULT_RATE_LIMITS.maxTokensPerMinute
    });
  });

  it('records requests and tokens on acquire', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 10_000 });

    await limiter.acquire(1500);
    await limiter.acquire(500);

    expect(limiter.getStatus()).toEqual({
      activeRequests: 2,
      requestsInWindow: 2,
      tokensInWindow: 2000,
      availableRequests: 8,
      availableTokens: 8000
    });
  });

  it('updates the last record with actual tokens on release', async () => {
    const limiter = new RateLimiter();

    await limiter.acquire(1000);
    limiter.release(250);

    expect(limiter.getStatus()).toMatchObject({ activeRequests: 0, tokensInWindow: 250 });
  });

  it('respects maxConcurrent: acquire blocks until release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });

    await limiter.acquire(100);
    expect(limiter.canProceed(100)).toBe(false);

    const second = track(limiter.acquire(100));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(second.settled()).toBe(false);

    limiter.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(second.settled()).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });

  // Release wakes the queued waiter, but a new caller may grab the slot first.
  // Sweep the newcomer's arrival across microtask offsets to hit every interleaving.
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'never exceeds maxConcurrent when a freed slot is contested (newcomer after %i microtasks)',
    async (microtasks) => {
      const limiter = new RateLimiter({ maxConcurrent: 1 });

      await limiter.acquire(100);
      const waiter = track(limiter.acquire(100));
      await vi.advanceTimersByTimeAsync(0);

      limiter.release();
      for (let i = 0; i < microtasks; i++) await Promise.resolve();
      const newcomer = track(limiter.acquire(100));
      await vi.advanceTimersByTimeAsync(0);

      expect(limiter.getStatus().activeRequests).toBe(1);
      expect(Number(waiter.settled()) + Number(newcomer.settled())).toBe(1);

      limiter.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(waiter.settled() && newcomer.settled()).toBe(true);
      expect(limiter.getStatus().activeRequests).toBe(1);
    }
  );

  it('respects maxRequestsPerMinute until the window slides', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxConcurrent: 10 });

    await limiter.acquire(10);
    await limiter.acquire(10);
    expect(limiter.canProceed(10)).toBe(false);

    const third = track(limiter.acquire(10));
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1000);
    expect(third.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(third.settled()).toBe(true);
    expect(limiter.getStatus().requestsInWindow).toBe(1);
  });

  it('respects maxTokensPerMinute', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 1000, maxConcurrent: 10 });

    await limiter.acquire(800);
    expect(limiter.canProceed(200)).toBe(true);
    expect(limiter.canProceed(201)).toBe(false);

    const next = track(limiter.acquire(500));
    await vi.advanceTimersByTimeAsync(WINDOW_MS / 2);
    expect(next.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(WINDOW_MS / 2 + 5000);
    expect(next.settled()).toBe(true);
    expect(limiter.getStatus().tokensInWindow).toBe(500);
  });

  it('prunes records older than 60 seconds (sliding window)', async () => {
    const limiter = new RateLimiter();

    await limiter.acquire(1000);
    limiter.release();
    vi.advanceTimersByTime(30_000);
    await limiter.acquire(2000);
    limiter.release();

    expect(limiter.getStatus()).toMatchObject({ requestsInWindow: 2, tokensInWindow: 3000 });

    vi.advanceTimersByTime(30_001);
    expect(limiter.getStatus()).toMatchObject({ requestsInWindow: 1, tokensInWindow: 2000 });

    vi.advanceTimersByTime(30_000);
    expect(limiter.getStatus()).toMatchObject({ requestsInWindow: 0, tokensInWindow: 0 });
  });
});

describe('withRateLimit', () => {
  it('releases the slot after success', async () => {
    const limiter = new RateLimiter();

    await expect(withRateLimit(limiter, async () => 'done', 100)).resolves.toBe('done');
    expect(limiter.getStatus()).toMatchObject({ activeRequests: 0, requestsInWindow: 1 });
  });

  it('releases the slot after an error', async () => {
    const limiter = new RateLimiter();

    await expect(
      withRateLimit(limiter, async () => Promise.reject(new Error('api down')), 100)
    ).rejects.toThrow('api down');
    expect(limiter.getStatus().activeRequests).toBe(0);
  });
});
