import { EventEmitter } from 'events';
import {
  TranscriptionEngine,
  EngineConfig,
  TranscriptionEvent,
  AudioSource,
  TranscriptionEngineType,
  AudioStreamConfig,
  TranscriptionError,
  TranscriptionErrorType
} from '../../types';

/**
 * Abstract base class for transcription engines
 */
export abstract class BaseTranscriptionEngine extends EventEmitter implements TranscriptionEngine {
  protected config?: EngineConfig;
  protected isInitialized = false;
  protected engineReady = false;

  abstract getEngineType(): TranscriptionEngineType;
  abstract getSupportedLanguages(): string[];
  abstract supportsRealTimeStreaming(): boolean;
  abstract getRecommendedAudioConfig(): AudioStreamConfig;

  /**
   * Initialize the engine with configuration
   */
  async initialize(config: EngineConfig): Promise<void> {
    if (this.isInitialized) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Engine is already initialized'
      );
    }

    this.config = config;

    try {
      await this.initializeEngine(config);
      this.isInitialized = true;
      this.engineReady = true;
      this.emit('ready');
    } catch (error) {
      this.engineReady = false;
      throw new TranscriptionError(
        TranscriptionErrorType.ENGINE_INITIALIZATION_FAILED,
        `Failed to initialize ${this.getEngineType()} engine`,
        error as Error
      );
    }
  }

  /**
   * Process audio data and return transcription
   */
  async processAudio(audioData: Buffer, source: AudioSource, timestamp: number): Promise<TranscriptionEvent | null> {
    if (!this.engineReady) {
      throw new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Engine is not ready for processing'
      );
    }

    try {
      const result = await this.processAudioData(audioData, source, timestamp);

      if (result) {
        // Add engine type to the result
        result.engine = this.getEngineType();
        this.emit('transcription', result);
      }

      return result;
    } catch (error) {
      const transcriptionError = new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        `Error processing audio with ${this.getEngineType()} engine`,
        error as Error
      );
      this.emit('error', transcriptionError);
      throw transcriptionError;
    }
  }

  /**
   * Clean up engine resources
   */
  async destroy(): Promise<void> {
    try {
      if (this.engineReady) {
        await this.cleanupEngine();
      }
    } catch (error) {
      console.warn(`Error during ${this.getEngineType()} engine cleanup:`, error);
    } finally {
      this.isInitialized = false;
      this.engineReady = false;
      this.removeAllListeners();
    }
  }

  /**
   * Check if the engine is ready for processing
   */
  isReady(): boolean {
    return this.engineReady && this.isInitialized;
  }

  /**
   * Get current configuration
   */
  getConfig(): EngineConfig {
    if (!this.config) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Engine is not initialized'
      );
    }
    return { ...this.config };
  }

  /**
   * Validate language support
   */
  protected validateLanguage(language: string): boolean {
    const supportedLanguages = this.getSupportedLanguages();
    return supportedLanguages.includes(language) || supportedLanguages.includes('*');
  }

  /**
   * Calculate confidence score for transcription
   * This is a basic implementation - engines should override for better accuracy
   */
  protected calculateConfidence(text: string, engineConfidence?: number): number {
    if (engineConfidence !== undefined) {
      return Math.max(0.0, Math.min(1.0, engineConfidence));
    }

    // Basic confidence calculation based on text characteristics
    if (!text || text.trim().length === 0) {
      return 0.0;
    }

    let confidence = 0.5; // Base confidence

    // Longer texts tend to be more reliable
    if (text.length > 10) confidence += 0.1;
    if (text.length > 50) confidence += 0.1;

    // Presence of punctuation suggests better quality
    if (/[.!?]/.test(text)) confidence += 0.1;

    // Avoid repeated characters (often indicates poor audio)
    const repeatedChars = /(.)\1{3,}/.test(text);
    if (repeatedChars) confidence -= 0.3;

    // Reasonable word count
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 2 && wordCount < 20) confidence += 0.1;

    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Convert audio buffer to the format expected by the engine
   */
  protected convertAudioFormat(audioData: Buffer, targetConfig: AudioStreamConfig): Buffer {
    // Basic implementation - engines should override for specific format requirements
    return audioData;
  }

  /**
   * Check if the audio data meets minimum quality requirements
   */
  protected validateAudioData(audioData: Buffer): boolean {
    if (!audioData || audioData.length === 0) {
      return false;
    }

    // For real-time streaming, allow smaller chunks
    // Minimum of ~10ms at 16kHz = 160 samples * 2 bytes = 320 bytes
    const minBytes = 320;
    return audioData.length >= minBytes;
  }

  /**
   * Abstract methods that must be implemented by concrete engines
   */
  protected abstract initializeEngine(config: EngineConfig): Promise<void>;
  protected abstract processAudioData(audioData: Buffer, source: AudioSource, timestamp: number): Promise<TranscriptionEvent | null>;
  protected abstract cleanupEngine(): Promise<void>;

  /**
   * Optional method for engines that support model loading
   */
  protected async loadModel?(modelPath: string): Promise<void>;

  /**
   * Optional method for engines that support custom vocabularies
   */
  protected async setVocabulary?(vocabulary: string[]): Promise<void>;

  /**
   * Optional method for engines that support speaker detection
   */
  protected async enableSpeakerDetection?(enabled: boolean): Promise<void>;
}