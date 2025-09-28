/**
 * TypeScript Audio Transcriber
 * Open source real-time audio transcription library for macOS with microphone and system audio support
 */

// Main exports
export { AudioTranscriber } from './core/audio-transcriber';

// Type exports
export type {
  // Core types
  TranscriberOptions,
  TranscriptionEvent,
  AudioTranscriberEvents,
  PerformanceMetrics,

  // Audio types
  AudioSource,
  AudioDevice,
  AudioStream,
  AudioStreamConfig,
  AudioCapture,

  // Transcription types
  TranscriptionEngine,
  TranscriptionEngineType,
  EngineConfig,

  // Advanced types
  ModelInfo,
  TranscriptionPlugin,
  EngineFactory,
  EngineRegistry
} from './types';

// Engine exports (for advanced usage)
export { VoskTranscriptionEngine } from './engines/vosk/vosk-engine';
export { BaseTranscriptionEngine } from './engines/base/base-engine';

// Audio implementation exports (for advanced usage)
export { MacAudioCapture } from './audio/capture';
export { ScreenCaptureAudioStream } from './audio/stream';

// Re-export the error class and enum for instanceof checks
export { TranscriptionError, TranscriptionErrorType } from './types';

/**
 * Create a new AudioTranscriber instance with the given options
 *
 * @param options Configuration options for the transcriber
 * @returns A new AudioTranscriber instance
 *
 * @example
 * ```typescript
 * import { createTranscriber } from 'ts-audio-transcriber';
 *
 * const transcriber = createTranscriber({
 *   enableMicrophone: true,
 *   enableSystemAudio: false,
 *   engine: {
 *     engine: 'vosk',
 *     language: 'en'
 *   }
 * });
 *
 * transcriber.on('transcription', (event) => {
 *   console.log(`${event.source}: ${event.text}`);
 * });
 *
 * await transcriber.start();
 * ```
 */
import { AudioTranscriber as _AudioTranscriber } from './core/audio-transcriber';

export function createTranscriber(options: any = {}): any {
  return new _AudioTranscriber(options);
}

/**
 * Default export is the AudioTranscriber class
 */
export default _AudioTranscriber;