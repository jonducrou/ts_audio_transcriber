/**
 * Audio capture module for macOS using ScreenCaptureKit
 */

export { ScreenCaptureAudioStream } from './stream';
export { MacAudioCapture } from './capture';

// Re-export types for convenience
export type {
  AudioCapture,
  AudioStream,
  AudioDevice,
  AudioStreamConfig,
  AudioSource
} from '../types';