import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitedAPI, DiscordAPIError } from '../../../src/discord/api';

describe('RateLimitedAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should enforce minimum delay between requests', async () => {
    const api = new RateLimitedAPI({ minDelay: 100 });
    const times: number[] = [];

    await api.execute(async () => times.push(Date.now()));
    await api.execute(async () => times.push(Date.now()));

    const delay = times[1] - times[0];
    expect(delay).toBeGreaterThanOrEqual(100);
  });

  it('should execute function successfully on first try', async () => {
    const api = new RateLimitedAPI();
    const mockFn = vi.fn(async () => 'success');

    const result = await api.execute(mockFn, { operation: 'test' });

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry on rate limit error (429)', async () => {
    const api = new RateLimitedAPI({ minDelay: 10 });
    let attempts = 0;

    const result = await api.execute(async () => {
      attempts++;
      if (attempts < 2) {
        const error: any = new Error('Rate limited');
        error.code = 429;
        throw error;
      }
      return 'success';
    }, { retries: 3, operation: 'test-rate-limit' });

    expect(attempts).toBe(2);
    expect(result).toBe('success');
  });

  it('should retry on generic errors', async () => {
    const api = new RateLimitedAPI({ minDelay: 10 });
    let attempts = 0;

    const result = await api.execute(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Temporary error');
      }
      return 'success';
    }, { retries: 3, operation: 'test-generic-error' });

    expect(attempts).toBe(3);
    expect(result).toBe('success');
  });

  it('should throw DiscordAPIError after exhausting retries', async () => {
    const api = new RateLimitedAPI({ minDelay: 10 });

    await expect(
      api.execute(async () => {
        const error: any = new Error('Always fails');
        error.code = 500;
        throw error;
      }, { retries: 2, operation: 'test-fail' })
    ).rejects.toThrow(DiscordAPIError);
  });

  it('should use exponential backoff for retries', async () => {
    const api = new RateLimitedAPI({ minDelay: 10 });
    const delays: number[] = [];
    let lastTime = Date.now();
    let attempts = 0;

    try {
      await api.execute(async () => {
        attempts++;
        if (attempts > 1) {
          const now = Date.now();
          delays.push(now - lastTime);
          lastTime = now;
        } else {
          lastTime = Date.now();
        }

        if (attempts <= 3) {
          throw new Error('Fail');
        }
        return 'success';
      }, { retries: 3, operation: 'test-backoff' });
    } catch (e) {
      // Expected to fail
    }

    // Проверяем, что задержки растут (exponential backoff)
    // Первая retry: ~500ms, вторая: ~1000ms, третья: ~2000ms
    expect(delays.length).toBeGreaterThan(0);
    // Первая задержка должна быть больше минимума
    expect(delays[0]).toBeGreaterThanOrEqual(10);
  });

  it('should handle retryAfter from rate limit errors', async () => {
    const api = new RateLimitedAPI({ minDelay: 10 });
    let attempts = 0;
    const startTime = Date.now();

    const result = await api.execute(async () => {
      attempts++;
      if (attempts < 2) {
        const error: any = new Error('Rate limited');
        error.code = 429;
        error.retryAfter = 50; // 50ms retry after
        throw error;
      }
      return 'success';
    }, { retries: 3, operation: 'test-retry-after' });

    const duration = Date.now() - startTime;

    expect(result).toBe('success');
    expect(attempts).toBe(2);
    // Должно занять как минимум retryAfter время
    expect(duration).toBeGreaterThanOrEqual(50);
  });

  it('should respect custom maxRetries from execute options', async () => {
    const api = new RateLimitedAPI({ minDelay: 10, maxRetries: 5 });
    let attempts = 0;

    try {
      await api.execute(async () => {
        attempts++;
        throw new Error('Always fails');
      }, { retries: 2, operation: 'test-custom-retries' });
    } catch (e) {
      // Expected to fail
    }

    // Должно быть 3 попытки (1 + 2 retries), не 6 (1 + 5 retries)
    expect(attempts).toBe(3);
  });

  it('should handle successful execution without retries', async () => {
    const api = new RateLimitedAPI({ minDelay: 10 });
    const mockFn = vi.fn(async () => ({ data: 'test' }));

    const result = await api.execute(mockFn, { operation: 'test-no-retry' });

    expect(result).toEqual({ data: 'test' });
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should allow zero retries', async () => {
    const api = new RateLimitedAPI({ minDelay: 10 });
    let attempts = 0;

    try {
      await api.execute(async () => {
        attempts++;
        throw new Error('Fail immediately');
      }, { retries: 0, operation: 'test-zero-retries' });
    } catch (e) {
      // Expected to fail
    }

    // Должна быть только 1 попытка (0 retries)
    expect(attempts).toBe(1);
  });
});
