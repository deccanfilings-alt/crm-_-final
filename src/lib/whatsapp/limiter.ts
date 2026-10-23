export interface RateLimiterOptions {
  ratePerSec?: number;
}

export class SerialRateLimiter {
  private minIntervalMs: number;
  private nextSlotTime: number = 0;

  constructor(options: RateLimiterOptions = {}) {
    const envRate = process.env.WHATSAPP_SEND_RATE_PER_SEC
      ? parseFloat(process.env.WHATSAPP_SEND_RATE_PER_SEC)
      : undefined;
    const rate = options.ratePerSec ?? (envRate && !isNaN(envRate) && envRate > 0 ? envRate : 2);
    this.minIntervalMs = Math.ceil(1000 / rate);
  }

  public async waitNextSlot(): Promise<void> {
    const now = Date.now();
    const waitTime = Math.max(0, this.nextSlotTime - now);
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.nextSlotTime = Date.now() + this.minIntervalMs;
  }

  public penalize(backoffMs: number): void {
    const now = Date.now();
    const targetSlot = now + Math.max(0, backoffMs);
    this.nextSlotTime = Math.max(this.nextSlotTime, targetSlot);
  }

  public getMinIntervalMs(): number {
    return this.minIntervalMs;
  }

  public getNextSlotTime(): number {
    return this.nextSlotTime;
  }
}

/**
 * Calculates exponential backoff delay with full jitter for retries.
 *   - attempt: 1-indexed (1, 2, 3, 4, 5)
 *   - delay = random(0, min(1000 * 2^attempt, 32000)) ms
 *   - If retryAfterHeader is present, use it (in seconds, capped at 60s)
 */
export function calculateBackoffDelay(
  attempt: number,
  retryAfterHeader?: string | number | null
): number {
  if (retryAfterHeader !== undefined && retryAfterHeader !== null) {
    const seconds = typeof retryAfterHeader === 'number' ? retryAfterHeader : parseInt(String(retryAfterHeader), 10);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, 60000);
    }
  }

  const maxCap = Math.min(1000 * Math.pow(2, attempt), 32000);
  return Math.floor(Math.random() * (maxCap + 1));
}
