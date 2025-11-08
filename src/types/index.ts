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
 * Transcription event containing the transcribed text and metadata (LEGACY - deprecated in v2.0.0)
 * @deprecated Use SnippetTranscriptionEvent or SessionTranscriptionEvent instead
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
 * Real-time 15-second snippet transcription event
 */
export interface SnippetTranscriptionEvent {
  /** The transcribed snippet text */
  text: string;

  /** Source of the audio (microphone or system audio) */
  source: AudioSource;

  /** Confidence score from 0.0 to 1.0 */
  confidence: number;

  /** Timestamp when the transcription was completed */
  timestamp: number;

  /** Index of this snippet within the current session (0, 1, 2...) */
  snippetIndex: number;

  /** Engine that performed the transcription */
  engine: TranscriptionEngineType;

  /** Event type discriminator */
  type: 'snippet';
}

/**
 * Complete session transcript event (emitted after stopping)
 */
export interface SessionTranscriptionEvent {
  /** The complete transcript text */
  text: string;

  /** Source of the audio (microphone or system audio) */
  source: AudioSource;

  /** Average confidence score from 0.0 to 1.0 */
  confidence: number;

  /** Session start timestamp */
  timestamp: number;

  /** Unique session identifier */
  sessionId: string;

  /** Whether this is the complete final transcript */
  isComplete: boolean;

  /** Engine that performed the transcription */
  engine: TranscriptionEngineType;

  /** Event type discriminator */
  type: 'session';

  /** Session metadata */
  metadata: {
    /** Total audio duration in milliseconds */
    duration: number;

    /** Total word count */
    wordCount: number;

    /** Time taken to process in milliseconds */
    processingTime: number;
  };
}

/**
 * Recording metadata and lifecycle information
 */
export interface RecordingMetadata {
  /** Unique session identifier */
  sessionId: string;

  /** Path to the recorded audio file */
  audioFilePath: string;

  /** Duration in milliseconds */
  duration: number;

  /** File size in bytes */
  fileSize: number;

  /** Sample rate in Hz */
  sampleRate: number;

  /** Number of channels */
  channels: number;

  /** Session start timestamp */
  startTime: number;

  /** Session end timestamp (when stopped) */
  endTime?: number;
}

/**
 * Recording progress information
 */
export interface RecordingProgress {
  /** Unique session identifier */
  sessionId: string;

  /** Current duration in milliseconds */
  duration: number;

  /** Current file size in bytes */
  fileSize: number;
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
 * Snippet pipeline configuration
 */
export interface SnippetPipelineConfig {
  /** Enable snippet pipeline */
  enabled: boolean;

  /** Interval in seconds for snippet chunks (default: 15) */
  intervalSeconds?: number;

  /** Engine to use for snippets */
  engine: TranscriptionEngineType;

  /** Minimum confidence threshold for emitting snippets (0.0-1.0) */
  confidenceThreshold?: number;

  /** Engine-specific options */
  engineOptions?: Record<string, any>;
}

/**
 * Session transcript pipeline configuration
 */
export interface SessionTranscriptConfig {
  /** Enable session transcript pipeline */
  enabled: boolean;

  /** Engine to use for session transcription */
  engine: TranscriptionEngineType;

  /** Minimum confidence threshold for session transcript (0.0-1.0) */
  confidenceThreshold?: number;

  /** Engine-specific options */
  engineOptions?: Record<string, any>;
}

/**
 * Recording configuration
 */
export interface RecordingConfig {
  /** Enable audio recording */
  enabled: boolean;

  /** Directory to save recordings */
  outputDir: string;

  /** Audio file format (only WAV supported currently) */
  format: 'wav';

  /** Automatically delete recording after successful transcription */
  autoCleanup?: boolean;

  /** Maximum recording duration in seconds (safety limit) */
  maxDuration?: number;
}

/**
 * Configuration options for the AudioTranscriber (v2.0.0)
 */
export interface TranscriberOptions {
  /** Enable microphone capture */
  enableMicrophone?: boolean;

  /** Enable system audio capture */
  enableSystemAudio?: boolean;

  /** Custom microphone device ID to use */
  microphoneDeviceId?: string;

  /** Audio stream configuration */
  audioConfig?: AudioStreamConfig;

  /** Snippet pipeline configuration */
  snippets?: SnippetPipelineConfig;

  /** Session transcript pipeline configuration */
  sessionTranscript?: SessionTranscriptConfig;

  /** Recording configuration */
  recording?: RecordingConfig;

  /** @deprecated Use snippets.enabled instead */
  enablePartialResults?: boolean;

  /** @deprecated Use snippets.confidenceThreshold or sessionTranscript.confidenceThreshold instead */
  confidenceThreshold?: number;

  /** @deprecated Use recording configuration instead */
  maxBufferDuration?: number;

  /** @deprecated Not implemented in v2.0.0 */
  autoDetectLanguage?: boolean;

  /** @deprecated Not implemented in v2.0.0 */
  enableSpeakerDetection?: boolean;

  /** @deprecated Use snippets.engineOptions instead */
  engine?: EngineConfig;
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
 * Performance metrics for monitoring transcription performance (v2.0.0)
 */
export interface PerformanceMetrics {
  /** Snippet pipeline: total snippets processed */
  snippetCount: number;

  /** Snippet pipeline: average processing latency in milliseconds */
  snippetAverageLatency: number;

  /** Snippet pipeline: average confidence score */
  snippetAverageConfidence: number;

  /** Session pipeline: total sessions processed */
  sessionTranscriptCount: number;

  /** Session pipeline: average processing time in milliseconds */
  sessionAverageProcessingTime: number;

  /** Session pipeline: average confidence score */
  sessionAverageConfidence: number;

  /** Current CPU usage percentage (estimated) */
  cpuUsage: number;

  /** Memory usage in MB */
  memoryUsage: number;

  /** Number of errors encountered */
  errorCount: number;

  /** Timestamp of last update */
  lastUpdated: number;

  /** @deprecated Use snippetCount instead */
  transcriptionCount?: number;

  /** @deprecated Use snippetAverageLatency instead */
  averageLatency?: number;

  /** @deprecated Use snippetAverageConfidence or sessionAverageConfidence instead */
  averageConfidence?: number;

  /** @deprecated Not tracked in v2.0.0 */
  partialResultCount?: number;
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
 * Event types emitted by the AudioTranscriber (v2.0.0)
 */
export interface AudioTranscriberEvents {
  /** Emitted every ~15 seconds with real-time snippet */
  snippet: (event: SnippetTranscriptionEvent) => void;

  /** Emitted after stopping with complete session transcript */
  sessionTranscript: (event: SessionTranscriptionEvent) => void;

  /** Emitted when recording starts */
  recordingStarted: (metadata: RecordingMetadata) => void;

  /** Emitted when recording stops */
  recordingStopped: (metadata: RecordingMetadata) => void;

  /** Emitted periodically during recording with progress */
  recordingProgress: (progress: RecordingProgress) => void;

  /** Emitted when an error occurs */
  error: (error: TranscriptionError) => void;

  /** Emitted when transcriber starts */
  started: () => void;

  /** Emitted when transcriber stops */
  stopped: () => void;

  /** Emitted periodically with performance metrics */
  metrics: (metrics: PerformanceMetrics) => void;

  /** @deprecated Removed in v2.0.0 - use snippet or sessionTranscript instead */
  transcription?: (event: TranscriptionEvent) => void;

  /** @deprecated Not implemented in v2.0.0 */
  deviceChange?: (devices: AudioDevice[]) => void;

  /** @deprecated Not implemented in v2.0.0 */
  engineReady?: (engineType: TranscriptionEngineType) => void;

  /** @deprecated Not implemented in v2.0.0 */
  engineError?: (engineType: TranscriptionEngineType, error: Error) => void;

  /** @deprecated Not implemented in v2.0.0 */
  engineSwitch?: (from: TranscriptionEngineType, to: TranscriptionEngineType) => void;
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