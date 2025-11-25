/**
 * Jest setup file - runs before all tests
 */

/// <reference types="jest" />

// Increase default timeout for async operations
jest.setTimeout(30000);

// Increase max listeners to prevent MaxListenersExceededWarning during tests
process.setMaxListeners(20);

// Store original process listeners for cleanup
const originalSigintListeners = process.listeners('SIGINT').slice();
const originalSigtermListeners = process.listeners('SIGTERM').slice();

// Clean up process listeners after each test to prevent accumulation
afterEach(() => {
  // Remove any SIGINT listeners added during the test
  const currentSigint = process.listeners('SIGINT');
  currentSigint.forEach(listener => {
    if (!originalSigintListeners.includes(listener)) {
      process.removeListener('SIGINT', listener as NodeJS.SignalsListener);
    }
  });

  // Remove any SIGTERM listeners added during the test
  const currentSigterm = process.listeners('SIGTERM');
  currentSigterm.forEach(listener => {
    if (!originalSigtermListeners.includes(listener)) {
      process.removeListener('SIGTERM', listener as NodeJS.SignalsListener);
    }
  });
});

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
}

// Keep warnings and errors visible
// jest.spyOn(console, 'warn').mockImplementation(() => {});
// jest.spyOn(console, 'error').mockImplementation(() => {});

// Global test utilities
declare global {
  namespace NodeJS {
    interface Global {
      // Add any global test utilities here
    }
  }
}

// Helper to create a delay promise
export const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// Helper to wait for an event with timeout
export const waitForEvent = <T>(
  emitter: { once: (event: string, listener: (arg: T) => void) => void },
  event: string,
  timeoutMs: number = 5000
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeoutMs);

    emitter.once(event, (arg: T) => {
      clearTimeout(timeout);
      resolve(arg);
    });
  });
};

// Export for use in tests
export {};
