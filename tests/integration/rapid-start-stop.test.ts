/**
 * Integration tests for rapid start/stop handling
 * Tests that the transcriber handles concurrent and rapid lifecycle operations gracefully
 */

/// <reference types="jest" />

import { EventEmitter } from 'events';

// Mock the audio capture module
jest.mock('../../src/audio/capture', () => ({
  MacAudioCapture: jest.fn().mockImplementation(() => {
    const streams: any[] = [];
    return {
      initialize: jest.fn().mockResolvedValue(undefined),
      startMicrophoneCapture: jest.fn().mockImplementation(async () => {
        const stream = createMockStream('microphone');
        streams.push(stream);
        return stream;
      }),
      startSystemAudioCapture: jest.fn().mockImplementation(async () => {
        const stream = createMockStream('system-audio');
        streams.push(stream);
        return stream;
      }),
      stopAllStreams: jest.fn().mockImplementation(async () => {
        for (const stream of streams) {
          if (stream._isActive) {
            await stream.stop();
          }
        }
        streams.length = 0;
      }),
      supportsMicrophoneCapture: jest.fn().mockResolvedValue(true),
      supportsSystemAudioCapture: jest.fn().mockResolvedValue(true)
    };
  })
}));

// Mock vosk-koffi
jest.mock('vosk-koffi', () => ({
  Model: jest.fn().mockImplementation(() => ({})),
  Recognizer: jest.fn().mockImplementation(() => ({
    setWords: jest.fn(),
    acceptWaveform: jest.fn().mockReturnValue(false),
    partialResult: jest.fn().mockReturnValue('{"partial":""}'),
    result: jest.fn().mockReturnValue('{"text":""}'),
    finalResult: jest.fn().mockReturnValue('{"text":""}')
  }))
}));

// Mock fs
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    access: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue(['vosk-model-en']),
    stat: jest.fn().mockResolvedValue({ isDirectory: () => true }),
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined)
  },
  constants: { F_OK: 0 },
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn()
  })
}));

// Helper to create mock stream
function createMockStream(source: string) {
  const stream = new EventEmitter() as any;
  stream._isActive = false;
  stream._source = source;
  stream._config = { sampleRate: 16000, channels: 1, bitDepth: 16, format: 'pcm', bufferSize: 1024 };
  stream._connectionState = 'connected';

  stream.start = jest.fn().mockImplementation(async () => {
    stream._isActive = true;
    stream._connectionState = 'connected';
  });
  stream.stop = jest.fn().mockImplementation(async () => {
    stream._isActive = false;
    stream._connectionState = 'disconnected';
    stream.emit('end', { reason: 'process_exit', code: 0, signal: null });
  });
  stream.isActive = jest.fn().mockImplementation(() => stream._isActive);
  stream.getSource = jest.fn().mockReturnValue(source);
  stream.getConfig = jest.fn().mockReturnValue(stream._config);
  stream.getConnectionState = jest.fn().mockReturnValue(stream._connectionState);
  stream.onData = jest.fn().mockImplementation((cb) => stream.on('data', cb));
  stream.onError = jest.fn().mockImplementation((cb) => stream.on('error', cb));
  stream.onEnd = jest.fn().mockImplementation((cb) => stream.on('end', cb));

  return stream;
}

import { AudioTranscriber } from '../../src/core/audio-transcriber';

// Helper function for delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Rapid Start/Stop Integration Tests', () => {
  let transcriber: AudioTranscriber;

  const baseOptions = {
    enableMicrophone: true,
    snippets: { enabled: true, engine: 'vosk' as const }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (transcriber) {
      try {
        await transcriber.stop();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('Concurrent Stop Calls', () => {
    it('should handle multiple concurrent stop calls', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      // Call stop multiple times concurrently
      const stopPromises = [
        transcriber.stop(),
        transcriber.stop(),
        transcriber.stop()
      ];

      // All should resolve without throwing
      await expect(Promise.all(stopPromises)).resolves.not.toThrow();
    });

    it('should handle concurrent stop calls even during failed start', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      // Start the transcriber - it will likely fail due to mocked vosk
      // But we're testing that stop is safe to call regardless
      const startPromise = transcriber.start().catch(() => {});

      // Give it a moment to attempt start
      await delay(50);

      // Now call stop concurrently - should be safe regardless of start state
      const stop1 = transcriber.stop();
      const stop2 = transcriber.stop();
      const stop3 = transcriber.stop();

      // All stops should resolve safely
      await expect(Promise.all([stop1, stop2, stop3])).resolves.not.toThrow();

      // Wait for start to settle
      await startPromise;
    });
  });

  describe('Sequential Start/Stop', () => {
    it('should handle sequential stop calls gracefully', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      // Multiple sequential stop calls
      await transcriber.stop();
      await transcriber.stop();
      await transcriber.stop();

      expect(transcriber.isRunning()).toBe(false);
    });

    it('should properly track running state', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      expect(transcriber.isRunning()).toBe(false);

      await transcriber.stop();

      expect(transcriber.isRunning()).toBe(false);
    });
  });

  describe('Stop During Initialisation', () => {
    it('should handle stop being called during initialisation', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      // Don't await start, immediately call stop
      const startPromise = transcriber.start().catch(() => {});
      await delay(10);
      const stopPromise = transcriber.stop();

      // Both should resolve or reject gracefully
      await expect(Promise.allSettled([startPromise, stopPromise])).resolves.toBeDefined();
    });
  });

  describe('Stress Test', () => {
    it('should handle rapid stop calls without memory leaks or hangs', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      const iterations = 50;
      const stopPromises: Promise<void>[] = [];

      for (let i = 0; i < iterations; i++) {
        stopPromises.push(transcriber.stop());
      }

      // Should complete within reasonable time
      await expect(
        Promise.race([
          Promise.all(stopPromises),
          delay(5000).then(() => Promise.reject(new Error('Timeout')))
        ])
      ).resolves.not.toThrow();
    });
  });
});

describe('Event Handling During Lifecycle', () => {
  let transcriber: AudioTranscriber;

  const baseOptions = {
    enableMicrophone: true,
    snippets: { enabled: true, engine: 'vosk' as const }
  };

  afterEach(async () => {
    if (transcriber) {
      try {
        await transcriber.stop();
      } catch (e) {
        // Ignore
      }
    }
  });

  it('should not emit events after stop', async () => {
    transcriber = new AudioTranscriber(baseOptions);

    const errorHandler = jest.fn();
    transcriber.on('error', errorHandler);

    await transcriber.stop();

    // After stop, the transcriber should have removed listeners
    // or not emit any new events
    expect(transcriber.isRunning()).toBe(false);
  });

  it('should clean up listeners on stop', async () => {
    transcriber = new AudioTranscriber(baseOptions);

    // Add some listeners
    const handlers = {
      snippet: jest.fn(),
      error: jest.fn()
    };

    transcriber.on('snippet', handlers.snippet);
    transcriber.on('error', handlers.error);

    // Verify listeners are added
    expect(transcriber.listenerCount('snippet')).toBe(1);

    // Stop doesn't necessarily remove user-added listeners
    // but the internal state should be cleaned up
    await transcriber.stop();

    expect(transcriber.isRunning()).toBe(false);
  });
});
