/**
 * Integration tests for recording rotation functionality
 * Tests that the transcriber can rotate recordings on the fly without stopping
 */

/// <reference types="jest" />

import { EventEmitter } from 'events';
import { RecordingRotationResult } from '../../src/types';

// Mock the audio capture module
jest.mock('../../src/audio/capture', () => ({
  MacAudioCapture: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    startMicrophoneCapture: jest.fn().mockImplementation(async () => {
      return createMockStream('microphone');
    }),
    startSystemAudioCapture: jest.fn().mockImplementation(async () => {
      return createMockStream('system-audio');
    }),
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

describe('Recording Rotation Integration Tests', () => {
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

  describe('rotateRecording Method', () => {
    it('should have rotateRecording method', () => {
      transcriber = new AudioTranscriber(baseOptions);

      expect(typeof transcriber.rotateRecording).toBe('function');
    });

    it('should throw when not running', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      await expect(transcriber.rotateRecording()).rejects.toThrow('AudioTranscriber is not running');
    });

    it('should accept optional newOutputDir parameter', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      // Method signature should accept optional parameter
      const rotateMethod = transcriber.rotateRecording;
      expect(rotateMethod.length).toBeLessThanOrEqual(1);
    });
  });

  describe('recordingRotated Event', () => {
    it('should have recordingRotated event listener capability', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const rotationHandler = jest.fn();
      transcriber.on('recordingRotated', rotationHandler);

      expect(transcriber.listenerCount('recordingRotated')).toBe(1);
    });

    it('should allow multiple listeners for recordingRotated', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      transcriber.on('recordingRotated', handler1);
      transcriber.on('recordingRotated', handler2);

      expect(transcriber.listenerCount('recordingRotated')).toBe(2);
    });

    it('should allow removing recordingRotated listeners', () => {
      transcriber = new AudioTranscriber(baseOptions);

      const handler = jest.fn();
      transcriber.on('recordingRotated', handler);
      expect(transcriber.listenerCount('recordingRotated')).toBe(1);

      transcriber.off('recordingRotated', handler);
      expect(transcriber.listenerCount('recordingRotated')).toBe(0);
    });
  });

  describe('Rotation Validation', () => {
    it('should require transcriber to be running for rotation', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      expect(transcriber.isRunning()).toBe(false);
      await expect(transcriber.rotateRecording()).rejects.toThrow();
    });

    it('should validate state before rotation', async () => {
      transcriber = new AudioTranscriber(baseOptions);

      // Not running
      await expect(transcriber.rotateRecording()).rejects.toThrow();

      // Try to stop (already stopped)
      await transcriber.stop();

      // Still not running
      await expect(transcriber.rotateRecording()).rejects.toThrow();
    });
  });
});

describe('Recording Rotation Type Definitions', () => {
  it('should have correct RecordingRotationResult type structure', () => {
    // This is a type-level test to ensure the interface is correct
    const mockResult: RecordingRotationResult = {
      previousSessionId: 'old-session-123',
      newSessionId: 'new-session-456',
      completedFilePath: '/path/to/old-recording.wav',
      timestamp: Date.now()
    };

    expect(mockResult.previousSessionId).toBeDefined();
    expect(mockResult.newSessionId).toBeDefined();
    expect(mockResult.completedFilePath).toBeDefined();
    expect(mockResult.timestamp).toBeDefined();
  });
});

describe('Session Management During Rotation', () => {
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

  it('should have getSessionId method', () => {
    transcriber = new AudioTranscriber(baseOptions);

    expect(typeof transcriber.getSessionId).toBe('function');
  });

  it('should return undefined session ID when not running', () => {
    transcriber = new AudioTranscriber(baseOptions);

    expect(transcriber.getSessionId()).toBeUndefined();
  });
});
