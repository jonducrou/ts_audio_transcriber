import { ReconnectionConfig } from '../types';

/**
 * Default reconnection configuration values
 */
const DEFAULT_CONFIG: Required<ReconnectionConfig> = {
  enabled: true,
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

/**
 * Manages reconnection state and exponential backoff logic for device resilience
 */
export class ReconnectionManager {
  private _attemptCount = 0;
  private _isReconnecting = false;
  private _disconnectTime?: number;
  private _config: Required<ReconnectionConfig>;

  constructor(config?: Partial<ReconnectionConfig>) {
    this._config = {
      ...DEFAULT_CONFIG,
      ...config
    };
  }

  /**
   * Calculate the delay for the current attempt using exponential backoff
   * Formula: baseDelay * (multiplier ^ attemptCount), capped at maxDelay
   */
  calculateDelay(): number {
    const delay = this._config.baseDelayMs *
      Math.pow(this._config.backoffMultiplier, this._attemptCount);
    return Math.min(delay, this._config.maxDelayMs);
  }

  /**
   * Check if another reconnection attempt can be made
   */
  canRetry(): boolean {
    return this._config.enabled && this._attemptCount < this._config.maxAttempts;
  }

  /**
   * Start a new reconnection attempt
   * Returns the attempt number and calculated delay
   */
  startAttempt(): { attemptNumber: number; delay: number } {
    this._attemptCount++;
    if (!this._disconnectTime) {
      this._disconnectTime = Date.now();
    }
    this._isReconnecting = true;
    return {
      attemptNumber: this._attemptCount,
      delay: this.calculateDelay()
    };
  }

  /**
   * Called when reconnection succeeds
   * Returns statistics about the reconnection
   */
  onSuccess(): { attemptsRequired: number; reconnectionTimeMs: number } {
    const result = {
      attemptsRequired: this._attemptCount,
      reconnectionTimeMs: this._disconnectTime ? Date.now() - this._disconnectTime : 0
    };
    this.reset();
    return result;
  }

  /**
   * Called when all reconnection attempts have been exhausted
   * Returns statistics about the failed reconnection
   */
  onFinalFailure(): { totalAttempts: number; elapsedMs: number } {
    const result = {
      totalAttempts: this._attemptCount,
      elapsedMs: this._disconnectTime ? Date.now() - this._disconnectTime : 0
    };
    // Don't reset - let the caller decide when to reset
    return result;
  }

  /**
   * Reset the manager to initial state
   * Call this after a successful reconnection or when starting fresh
   */
  reset(): void {
    this._attemptCount = 0;
    this._isReconnecting = false;
    this._disconnectTime = undefined;
  }

  /**
   * Check if currently in a reconnection cycle
   */
  isReconnecting(): boolean {
    return this._isReconnecting;
  }

  /**
   * Get the current configuration (readonly)
   */
  getConfig(): Required<ReconnectionConfig> {
    return { ...this._config };
  }

  /**
   * Get the current attempt count
   */
  getAttemptCount(): number {
    return this._attemptCount;
  }

  /**
   * Get the time since disconnect (or undefined if not disconnected)
   */
  getDisconnectTime(): number | undefined {
    return this._disconnectTime;
  }

  /**
   * Get elapsed time since disconnect in milliseconds
   */
  getElapsedMs(): number {
    return this._disconnectTime ? Date.now() - this._disconnectTime : 0;
  }
}
