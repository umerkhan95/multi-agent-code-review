import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ReviewError,
  ErrorCodes,
  withRetry,
  withTimeout,
  isReviewError,
  formatError
} from '../src/utils/error-handler.js';

/**
 * Tests for retry (exponential backoff) and timeout wrappers
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withRetry', () => {
  it('returns the result on the first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds after transient failures', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValue('recovered');

    await expect(withRetry(fn, 3, 1)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED after maxRetries total attempts', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('boom'));

    const error = await withRetry(fn, 3, 1).catch((e: unknown) => e);

    expect(fn).toHaveBeenCalledTimes(3);
    expect(isReviewError(error)).toBe(true);
    const reviewError = error as ReviewError;
    expect(reviewError.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    expect(reviewError.metadata).toEqual({ attempts: 3, lastError: 'boom' });
  });

  it('waits with exponential backoff between attempts', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // remove jitter for deterministic delays
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('fail'));

    const result = withRetry(fn, 3, 1000).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // First backoff: 1000 * 2^0 = 1000ms
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second backoff: 1000 * 2^1 = 2000ms
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    // No wait after the final attempt
    const error = await result;
    expect((error as ReviewError).code).toBe(ErrorCodes.RETRY_EXHAUSTED);
  });

  it('adds up to 100ms of jitter to the backoff', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // +50ms jitter
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const result = withRetry(fn, 2, 1000);

    await vi.advanceTimersByTimeAsync(1049);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe('ok');
  });
});

describe('withTimeout', () => {
  it('resolves when the function completes before the timeout', async () => {
    await expect(withTimeout(async () => 'fast', 1000)).resolves.toBe('fast');
  });

  it('rejects with AGENT_TIMEOUT and timeoutMs metadata when too slow', async () => {
    vi.useFakeTimers();
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000));

    const result = withTimeout(slow, 100, 'Agent took too long').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);

    const error = await result;
    expect(isReviewError(error)).toBe(true);
    const reviewError = error as ReviewError;
    expect(reviewError.code).toBe(ErrorCodes.AGENT_TIMEOUT);
    expect(reviewError.message).toBe('Agent took too long');
    expect(reviewError.metadata).toEqual({ timeoutMs: 100 });
  });

  it('propagates errors thrown by the function', async () => {
    await expect(withTimeout(async () => Promise.reject(new Error('inner')), 1000)).rejects.toThrow('inner');
  });

  it('clears the timeout timer after completion', async () => {
    vi.useFakeTimers();

    await withTimeout(async () => 'done', 10_000);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('isReviewError / formatError', () => {
  it('identifies ReviewError instances', () => {
    expect(isReviewError(new ReviewError('x', ErrorCodes.AGENT_FAILED))).toBe(true);
    expect(isReviewError(new Error('x'))).toBe(false);
    expect(isReviewError('x')).toBe(false);
  });

  it('formats ReviewError, Error and unknown values', () => {
    expect(formatError(new ReviewError('PR missing', ErrorCodes.PR_NOT_FOUND))).toBe('[PR_NOT_FOUND] PR missing');
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError(42)).toBe('42');
  });

  it('sets name, code and metadata on ReviewError', () => {
    const error = new ReviewError('bad config', ErrorCodes.INVALID_CONFIG, { key: 'ANTHROPIC_MODEL' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ReviewError');
    expect(error.code).toBe('INVALID_CONFIG');
    expect(error.metadata).toEqual({ key: 'ANTHROPIC_MODEL' });
  });
});
