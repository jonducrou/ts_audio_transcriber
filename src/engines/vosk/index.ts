/**
 * Vosk speech recognition engine
 */

export { VoskTranscriptionEngine } from './vosk-engine';

// Re-export types for convenience
export type {
  TranscriptionEngine,
  EngineConfig,
  TranscriptionEvent
} from '../../types';