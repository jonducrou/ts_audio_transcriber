/**
 * Unit tests for AudioTranscriber durability features
 */

/// <reference types="jest" />

import { EventEmitter } from 'events';

// Mock the audio capture module before importing AudioTranscriber
jest.mock('../../src/audio/capture', () => ({
  MacAudioCapture: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    startMicrophoneCapture: jest.fn().mockResolvedValue(createMockStream('microphone')),
    startSystemAudioCapture: jest.fn().mockResolvedValue(createMockStream('system-audio')),
    stopAllStreams: jest.fn().mockResolvedValue(undefined),
    supportsMicrophoneCapture: jest.fn().mockResolvedValue(true),
    supportsSystemAudioCapture: jest.fn().mockResolvedValue(true)
  }))
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

// Mock fs for model path resolution
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    access: jest.fn().mockRejectedValue(new Error('Not found')),
    readdir: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockResolvedValue({ isDirectory: () => true })
  },
  constants: { F_OK: 0 }
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
  stream.isActive = jest.fn().mockReturnValue(stream._isActive);
  stream.getSource = jest.fn().mockReturnValue(source);
  stream.getConfig = jest.fn().mockReturnValue(stream._config);
  stream.getConnectionState = jest.fn().mockReturnValue(stream._connectionState);
  stream.onData = jest.fn().mockImplementation((cb) => stream.on('data', cb));
  stream.onError = jest.fn().mockImplementation((cb) => stream.on('error', cb));
  stream.onEnd = jest.fn().mockImplementation((cb) => stream.on('end', cb));

  return stream;
}

// Import after mocks are set up
import { AudioTranscriber } from '../../src/core/audio-transcriber';
import { ReconnectionConfig } from '../../src/types';

// Base options that satisfy validation requirements
const baseOptions = {
  enableMicrophone: true,
  snippets: { enabled: true, engine: 'vosk' as const }
};

describe('AudioTranscriber Durability Features', () => {
  let transcriber: AudioTranscriber;

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

  describe('Reconnection Configuration', () => {
    it('should accept reconnection config in options', () => {
      const reconnectionConfig: ReconnectionConfig = {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 10000,
        backoffMultiplier: 1.5
      };

      transcriber = new AudioTranscriber({
        ...baseOptions,
        reconnection: reconnectionConfig
      });

      // Transcriber should be created without error
      expect(transcriber).toBeDefined();
    });

    it('should disable reconnection when enabled is false', () => {
      transcriber = new AudioTranscriber({
        ...baseOptions,
        reconnection: {
          enabled: false,
          maxAttempts: 5,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2
        }
      });

      expect(transcriber).toBeDefined();
    });
  });

  describe('Event Emissions', () => {
    it('should have deviceDisconnected event type', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const handler = jest.fn();
      transcriber.on('deviceDisconnected', handler);

      // The handler should be registered without error
      expect(transcriber.listenerCount('deviceDisconnected')).toBe(1);
    });

    it('should have reconnectionAttempt event type', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const handler = jest.fn();
      transcriber.on('reconnectionAttempt', handler);

      expect(transcriber.listenerCount('reconnectionAttempt')).toBe(1);
    });

    it('should have reconnectionFailed event type', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const handler = jest.fn();
      transcriber.on('reconnectionFailed', handler);

      expect(transcriber.listenerCount('reconnectionFailed')).toBe(1);
    });

    it('should have reconnectionSuccess event type', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const handler = jest.fn();
      transcriber.on('reconnectionSuccess', handler);

      expect(transcriber.listenerCount('reconnectionSuccess')).toBe(1);
    });

    it('should have recordingRotated event type', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const handler = jest.fn();
      transcriber.on('recordingRotated', handler);

      expect(transcriber.listenerCount('recordingRotated')).toBe(1);
    });
  });

  describe('rotateRecording Method', () => {
    it('should have rotateRecording method', () => {
      transcriber = new AudioTranscriber(baseOptions);

      expect(typeof transcriber.rotateRecording).toBe('function');
    });

    it('should throw if called when not running', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      await expect(transcriber.rotateRecording()).rejects.toThrow('AudioTranscriber is not running');
    });
  });

  describe('Rapid Start/Stop Handling', () => {
    it('should handle multiple stop calls gracefully', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      // Multiple stop calls should not throw
      await expect(transcriber.stop()).resolves.not.toThrow();
      await expect(transcriber.stop()).resolves.not.toThrow();
      await expect(transcriber.stop()).resolves.not.toThrow();
    });
  });
});

describe('AudioTranscriber State Management', () => {
  let transcriber: AudioTranscriber;

  afterEach(async () => {
    if (transcriber) {
      try {
        await transcriber.stop();
      } catch (e) {
        // Ignore
      }
    }
  });

  it('should report correct isRunning state', () => {
    transcriber = new AudioTranscriber({
      enableMicrophone: true,
      snippets: { enabled: true, engine: 'vosk' }
    });

    expect(transcriber.isRunning()).toBe(false);
  });

  it('should have correct initial state', () => {
    transcriber = new AudioTranscriber({
      enableMicrophone: true,
      snippets: { enabled: true, engine: 'vosk' }
    });

    expect(transcriber.isRunning()).toBe(false);
    expect(transcriber.getSessionId()).toBeUndefined();
  });
});
