import { ReconnectionManager } from '../../src/core/reconnection-manager';

describe('ReconnectionManager', () => {
  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const manager = new ReconnectionManager();
      const config = manager.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxAttempts).toBe(5);
      expect(config.baseDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('should merge provided config with defaults', () => {
      const manager = new ReconnectionManager({
        maxAttempts: 3,
        baseDelayMs: 500
      });
      const config = manager.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.baseDelayMs).toBe(500);
      // Defaults should be preserved
      expect(config.enabled).toBe(true);
      expect(config.maxDelayMs).toBe(30000);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff delays', () => {
      const manager = new ReconnectionManager({
        baseDelayMs: 1000,
        backoffMultiplier: 2
      });

      // First attempt (attempt 0): 1000 * 2^0 = 1000ms
      expect(manager.calculateDelay()).toBe(1000);

      // After first attempt
      manager.startAttempt();
      // Second attempt: 1000 * 2^1 = 2000ms
      expect(manager.calculateDelay()).toBe(2000);

      manager.startAttempt();
      // Third attempt: 1000 * 2^2 = 4000ms
      expect(manager.calculateDelay()).toBe(4000);
    });

    it('should cap delay at maxDelayMs', () => {
      const manager = new ReconnectionManager({
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2
      });

      // Simulate multiple attempts to exceed max
      manager.startAttempt(); // 1
      manager.startAttempt(); // 2
      manager.startAttempt(); // 3
      manager.startAttempt(); // 4 - delay would be 16000, capped to 5000

      expect(manager.calculateDelay()).toBeLessThanOrEqual(5000);
    });
  });

  describe('canRetry', () => {
    it('should return true when attempts remain and enabled', () => {
      const manager = new ReconnectionManager({ maxAttempts: 3 });

      expect(manager.canRetry()).toBe(true);

      manager.startAttempt();
      expect(manager.canRetry()).toBe(true);

      manager.startAttempt();
      expect(manager.canRetry()).toBe(true);

      manager.startAttempt();
      expect(manager.canRetry()).toBe(false); // Max reached
    });

    it('should return false when disabled', () => {
      const manager = new ReconnectionManager({ enabled: false });

      expect(manager.canRetry()).toBe(false);
    });
  });

  describe('startAttempt', () => {
    it('should increment attempt count and return attempt info', () => {
      const manager = new ReconnectionManager({
        baseDelayMs: 1000,
        backoffMultiplier: 2
      });

      const attempt1 = manager.startAttempt();
      expect(attempt1.attemptNumber).toBe(1);
      expect(attempt1.delay).toBe(2000); // 1000 * 2^1

      const attempt2 = manager.startAttempt();
      expect(attempt2.attemptNumber).toBe(2);
      expect(attempt2.delay).toBe(4000); // 1000 * 2^2
    });

    it('should track disconnect time from first attempt', () => {
      const manager = new ReconnectionManager();

      expect(manager.getDisconnectTime()).toBeUndefined();

      const beforeStart = Date.now();
      manager.startAttempt();
      const afterStart = Date.now();

      const disconnectTime = manager.getDisconnectTime();
      expect(disconnectTime).toBeDefined();
      expect(disconnectTime).toBeGreaterThanOrEqual(beforeStart);
      expect(disconnectTime).toBeLessThanOrEqual(afterStart);
    });

    it('should set isReconnecting to true', () => {
      const manager = new ReconnectionManager();

      expect(manager.isReconnecting()).toBe(false);

      manager.startAttempt();

      expect(manager.isReconnecting()).toBe(true);
    });
  });

  describe('onSuccess', () => {
    it('should return stats and reset manager', () => {
      const manager = new ReconnectionManager();

      manager.startAttempt();
      manager.startAttempt();

      const result = manager.onSuccess();

      expect(result.attemptsRequired).toBe(2);
      expect(result.reconnectionTimeMs).toBeGreaterThanOrEqual(0);

      // Should be reset
      expect(manager.getAttemptCount()).toBe(0);
      expect(manager.isReconnecting()).toBe(false);
      expect(manager.getDisconnectTime()).toBeUndefined();
    });
  });

  describe('onFinalFailure', () => {
    it('should return failure stats without resetting', () => {
      const manager = new ReconnectionManager({ maxAttempts: 2 });

      manager.startAttempt();
      manager.startAttempt();

      const result = manager.onFinalFailure();

      expect(result.totalAttempts).toBe(2);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

      // Should NOT be reset yet (caller decides when to reset)
      expect(manager.getAttemptCount()).toBe(2);
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      const manager = new ReconnectionManager();

      manager.startAttempt();
      manager.startAttempt();

      expect(manager.getAttemptCount()).toBe(2);
      expect(manager.isReconnecting()).toBe(true);

      manager.reset();

      expect(manager.getAttemptCount()).toBe(0);
      expect(manager.isReconnecting()).toBe(false);
      expect(manager.getDisconnectTime()).toBeUndefined();
    });
  });

  describe('getElapsedMs', () => {
    it('should return 0 when not disconnected', () => {
      const manager = new ReconnectionManager();

      expect(manager.getElapsedMs()).toBe(0);
    });

    it('should return elapsed time since disconnect', async () => {
      const manager = new ReconnectionManager();

      manager.startAttempt();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(manager.getElapsedMs()).toBeGreaterThanOrEqual(50);
    });
  });
});
