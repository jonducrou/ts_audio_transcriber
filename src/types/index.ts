/**
 * Core TypeScript types and interfaces for the Open Source Audio Transcriber library
 */

/**
 * Audio source types supported by the transcriber
 */
export type AudioSource = 'microphone' | 'system-audio';

/**
 * Available transcription engines
 */
export type TranscriptionEngineType = 'vosk' | 'whisper';

/**
 * Transcription event containing the transcribed text and metadata
 */
export interface TranscriptionEvent {
  /** The transcribed text */
  text: string;

  /** Source of the audio (microphone or system audio) */
  source: AudioSource;

  /** Confidence score from 0.0 to 1.0 */
  confidence: number;

  /** Timestamp when the transcription was completed */
  timestamp: number;

  /** Whether this is a partial (ongoing) or final transcription */
  isPartial: boolean;

  /** Optional speaker ID if speaker detection is enabled */
  speakerId?: string;

  /** Engine that performed the transcription */
  engine: TranscriptionEngineType;
}

/**
 * Audio device information
 */
export interface AudioDevice {
  /** Unique device identifier */
  id: string;

  /** Human-readable device name */
  name: string;

  /** Type of audio device */
  type: 'input' | 'output';

  /** Whether this is the default device */
  isDefault: boolean;

  /** Device-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * Audio stream configuration
 */
export interface AudioStreamConfig {
  /** Sample rate in Hz (default: 16000) */
  sampleRate?: number;

  /** Number of audio channels (default: 1) */
  channels?: number;

  /** Bit depth (default: 16) */
  bitDepth?: number;

  /** Buffer size in samples (default: 1024) */
  bufferSize?: number;

  /** Audio format (default: 'pcm') */
  format?: 'pcm' | 'wav' | 'raw';
}

/**
 * Configuration options for transcription engines
 */
export interface EngineConfig {
  /** Primary transcription engine to use */
  engine: TranscriptionEngineType;

  /** Fallback engine if primary fails */
  fallbackEngine?: TranscriptionEngineType;

  /** Language code for transcription (e.g., 'en', 'fr', 'de') */
  language?: string;

  /** Path to custom model file */
  modelPath?: string;

  /** Engine-specific configuration */
  engineOptions?: Record<string, any>;
}

/**
 * Configuration options for the AudioTranscriber
 */
export interface TranscriberOptions {
  /** Enable microphone capture */
  enableMicrophone?: boolean;

  /** Enable system audio capture */
  enableSystemAudio?: boolean;

  /** Transcription engine configuration */
  engine?: EngineConfig;

  /** Audio stream configuration */
  audioConfig?: AudioStreamConfig;

  /** Custom microphone device ID to use */
  microphoneDeviceId?: string;

  /** Whether to emit partial transcription results */
  enablePartialResults?: boolean;

  /** Minimum confidence threshold for emitting results (0.0-1.0) */
  confidenceThreshold?: number;

  /** Maximum audio buffer size in seconds before processing */
  maxBufferDuration?: number;

  /** Enable automatic language detection */
  autoDetectLanguage?: boolean;

  /** Enable speaker diarization if supported */
  enableSpeakerDetection?: boolean;
}

/**
 * Error types that can occur during transcription
 */
export enum TranscriptionErrorType {
  PERMISSION_DENIED = 'permission_denied',
  DEVICE_NOT_FOUND = 'device_not_found',
  AUDIO_CAPTURE_FAILED = 'audio_capture_failed',
  TRANSCRIPTION_ENGINE_ERROR = 'transcription_engine_error',
  INVALID_CONFIGURATION = 'invalid_configuration',
  MODEL_NOT_FOUND = 'model_not_found',
  UNSUPPORTED_LANGUAGE = 'unsupported_language',
  RESOURCE_EXHAUSTED = 'resource_exhausted',
  ENGINE_INITIALIZATION_FAILED = 'engine_initialization_failed'
}

/**
 * Custom error class for transcription-related errors
 */
export class TranscriptionError extends Error {
  constructor(
    public readonly type: TranscriptionErrorType,
    message: string,
    public readonly originalError?: Error,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/**
 * Audio stream interface for captured audio data
 */
export interface AudioStream {
  /** Start the audio stream */
  start(): Promise<void>;

  /** Stop the audio stream */
  stop(): Promise<void>;

  /** Whether the stream is currently active */
  isActive(): boolean;

  /** Get the source type of this stream */
  getSource(): AudioSource;

  /** Get stream configuration */
  getConfig(): AudioStreamConfig;

  /** Event handler for audio data */
  onData(callback: (data: Buffer, timestamp: number) => void): void;

  /** Event handler for stream errors */
  onError(callback: (error: Error) => void): void;

  /** Event handler for stream end */
  onEnd(callback: () => void): void;

  /** Remove event listeners */
  removeAllListeners(): void;
}

/**
 * Audio capture interface for accessing system audio and microphone
 */
export interface AudioCapture {
  /** Initialize the audio capture system */
  initialize?(): Promise<void>;

  /** Get list of available audio devices */
  getAvailableDevices(): Promise<AudioDevice[]>;

  /** Start capturing microphone audio */
  startMicrophoneCapture(deviceId?: string, config?: AudioStreamConfig): Promise<AudioStream>;

  /** Start capturing system audio */
  startSystemAudioCapture(config?: AudioStreamConfig): Promise<AudioStream>;

  /** Check if microphone capture is supported */
  supportsMicrophoneCapture(): Promise<boolean>;

  /** Check if system audio capture is supported */
  supportsSystemAudioCapture(): Promise<boolean>;

  /** Request necessary permissions for audio capture */
  requestPermissions(): Promise<boolean>;

  /** Stop all active streams */
  stopAllStreams(): Promise<void>;
}

/**
 * Transcription engine interface for processing audio data
 */
export interface TranscriptionEngine {
  /** Initialize the transcription engine */
  initialize(config: EngineConfig): Promise<void>;

  /** Process audio data and return transcription */
  processAudio(audioData: Buffer, source: AudioSource, timestamp: number): Promise<TranscriptionEvent | null>;

  /** Clean up engine resources */
  destroy(): Promise<void>;

  /** Check if the engine is ready for processing */
  isReady(): boolean;

  /** Get supported languages */
  getSupportedLanguages(): string[];

  /** Get engine type */
  getEngineType(): TranscriptionEngineType;

  /** Get current configuration */
  getConfig(): EngineConfig;

  /** Check if engine supports real-time streaming */
  supportsRealTimeStreaming(): boolean;

  /** Get recommended audio configuration for this engine */
  getRecommendedAudioConfig(): AudioStreamConfig;
}

/**
 * Performance metrics for monitoring transcription performance
 */
export interface PerformanceMetrics {
  /** Average processing latency in milliseconds */
  averageLatency: number;

  /** Current CPU usage percentage (estimated) */
  cpuUsage: number;

  /** Memory usage in MB */
  memoryUsage: number;

  /** Number of transcriptions processed */
  transcriptionCount: number;

  /** Number of errors encountered */
  errorCount: number;

  /** Number of partial results emitted */
  partialResultCount: number;

  /** Average confidence score */
  averageConfidence: number;

  /** Timestamp of last update */
  lastUpdated: number;

  /** Engine-specific metrics */
  engineMetrics?: Record<string, number>;
}

/**
 * Model information for transcription engines
 */
export interface ModelInfo {
  /** Model identifier */
  id: string;

  /** Human-readable model name */
  name: string;

  /** Language code */
  language: string;

  /** Model size in bytes */
  size: number;

  /** Model accuracy rating (0.0-1.0) */
  accuracy: number;

  /** Whether model supports real-time processing */
  supportsRealTime: boolean;

  /** Download URL for the model */
  downloadUrl?: string;

  /** Local file path if model is installed */
  localPath?: string;

  /** Model version */
  version?: string;

  /** Compatible engine types */
  compatibleEngines: TranscriptionEngineType[];
}

/**
 * Event types emitted by the AudioTranscriber
 */
export interface AudioTranscriberEvents {
  /** Emitted when transcription text is available */
  transcription: (event: TranscriptionEvent) => void;

  /** Emitted when an error occurs */
  error: (error: TranscriptionError) => void;

  /** Emitted when transcriber starts */
  started: () => void;

  /** Emitted when transcriber stops */
  stopped: () => void;

  /** Emitted when audio device state changes */
  deviceChange: (devices: AudioDevice[]) => void;

  /** Emitted periodically with performance metrics */
  metrics: (metrics: PerformanceMetrics) => void;

  /** Emitted when an engine is initialized */
  engineReady: (engineType: TranscriptionEngineType) => void;

  /** Emitted when an engine fails */
  engineError: (engineType: TranscriptionEngineType, error: Error) => void;

  /** Emitted when switching between engines */
  engineSwitch: (from: TranscriptionEngineType, to: TranscriptionEngineType) => void;
}

/**
 * Plugin interface for extending transcription capabilities
 */
export interface TranscriptionPlugin {
  /** Plugin name */
  name: string;

  /** Plugin version */
  version: string;

  /** Initialize the plugin */
  initialize(config: Record<string, any>): Promise<void>;

  /** Process transcription event */
  processTranscription?(event: TranscriptionEvent): Promise<TranscriptionEvent>;

  /** Process audio data before transcription */
  processAudio?(audioData: Buffer, source: AudioSource): Promise<Buffer>;

  /** Clean up plugin resources */
  destroy(): Promise<void>;
}

/**
 * Factory function type for creating transcription engines
 */
export type EngineFactory = (config: EngineConfig) => Promise<TranscriptionEngine>;

/**
 * Registry for managing transcription engines
 */
export interface EngineRegistry {
  /** Register a new engine factory */
  registerEngine(type: TranscriptionEngineType, factory: EngineFactory): void;

  /** Create an engine instance */
  createEngine(type: TranscriptionEngineType, config: EngineConfig): Promise<TranscriptionEngine>;

  /** Get available engine types */
  getAvailableEngines(): TranscriptionEngineType[];

  /** Check if an engine type is registered */
  hasEngine(type: TranscriptionEngineType): boolean;
}