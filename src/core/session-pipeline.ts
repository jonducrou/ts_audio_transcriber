import * as fs from 'fs';
import {
  SessionTranscriptConfig,
  SessionTranscriptionEvent,
  RecordingMetadata,
  AudioSource,
  TranscriptionEngine,
  TranscriptionError,
  TranscriptionErrorType,
  EngineConfig
} from '../types';
import { VoskTranscriptionEngine } from '../engines/vosk/vosk-engine';
import { WhisperTranscriptionEngine } from '../engines/whisper/whisper-engine';

/**
 * SessionPipeline handles post-session complete transcription
 * Optimised for accuracy with Whisper engine processing from disk
 */
export class SessionPipeline {
  private _config: SessionTranscriptConfig;
  private _engine: TranscriptionEngine | null = null;
  private _isRunning: boolean = false;
  private _emitCallback: (event: SessionTranscriptionEvent) => void;

  constructor(
    config: SessionTranscriptConfig,
    emitCallback: (event: SessionTranscriptionEvent) => void
  ) {
    this._config = {
      confidenceThreshold: 0.7,
      ...config
    };
    this._emitCallback = emitCallback;
  }

  /**
   * Initialize and start the session pipeline
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Session pipeline is already running'
      );
    }

    // Create and initialize engine
    this._engine = this.createEngine(this._config.engine);

    const engineConfig: EngineConfig = {
      engine: this._config.engine,
      ...this._config.engineOptions
    };

    await this._engine.initialize(engineConfig);

    this._isRunning = true;

    console.log(`SessionPipeline: Started with ${this._config.engine} engine`);
    console.log(`SessionPipeline: Threshold ${this._config.confidenceThreshold}`);
  }

  /**
   * Stop the session pipeline
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    this._isRunning = false;

    // Cleanup engine
    if (this._engine) {
      await this._engine.destroy();
      this._engine = null;
    }

    console.log('SessionPipeline: Stopped');
  }

  /**
   * Process complete session from recording file
   */
  async processFinalSession(
    recordingMetadata: RecordingMetadata,
    source: AudioSource = 'microphone'
  ): Promise<void> {
    if (!this._isRunning || !this._engine) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Session pipeline is not running'
      );
    }

    console.log(`SessionPipeline: Processing final session ${recordingMetadata.sessionId}`);
    console.log(`SessionPipeline: Reading from ${recordingMetadata.audioFilePath}`);

    const startTime = Date.now();

    try {
      // Read entire audio file from disk
      const audioData = await this.readAudioFile(recordingMetadata.audioFilePath);

      console.log(`SessionPipeline: Read ${audioData.length} bytes, processing with ${this._config.engine}...`);

      // Process with transcription engine
      const result = await this._engine.processAudio(audioData, source, recordingMetadata.startTime);

      if (!result) {
        console.warn('SessionPipeline: No transcription result returned');
        return;
      }

      const processingTime = Date.now() - startTime;

      // Check confidence threshold
      if (result.confidence < this._config.confidenceThreshold!) {
        console.warn(`SessionPipeline: Session transcript below confidence threshold: ${result.confidence} < ${this._config.confidenceThreshold}`);
        // Still emit but user can check confidence
      }

      // Create session transcript event
      const sessionEvent: SessionTranscriptionEvent = {
        text: result.text,
        source: result.source,
        confidence: result.confidence,
        timestamp: recordingMetadata.startTime,
        sessionId: recordingMetadata.sessionId,
        isComplete: true,
        engine: result.engine,
        type: 'session',
        metadata: {
          duration: recordingMetadata.duration,
          wordCount: this.countWords(result.text),
          processingTime
        }
      };

      console.log(`SessionPipeline: Processed ${recordingMetadata.duration}ms session in ${processingTime}ms`);
      console.log(`SessionPipeline: Transcript length: ${result.text.length} chars, ${sessionEvent.metadata.wordCount} words`);
      console.log(`SessionPipeline: Confidence: ${result.confidence}`);

      this._emitCallback(sessionEvent);

    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Failed to process session transcript',
        error as Error
      );
    }
  }

  /**
   * Check if pipeline is running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Read audio file from disk (skip WAV header)
   */
  private async readAudioFile(filePath: string): Promise<Buffer> {
    try {
      // Check file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`Audio file not found: ${filePath}`);
      }

      // Read entire file
      const fileBuffer = await fs.promises.readFile(filePath);

      // WAV files have 44-byte header, skip it to get PCM data
      // Check for RIFF header to confirm it's a WAV file
      if (fileBuffer.toString('utf8', 0, 4) === 'RIFF' && fileBuffer.toString('utf8', 8, 12) === 'WAVE') {
        // Find data chunk
        let offset = 12;
        while (offset < fileBuffer.length) {
          const chunkId = fileBuffer.toString('utf8', offset, offset + 4);
          const chunkSize = fileBuffer.readUInt32LE(offset + 4);

          if (chunkId === 'data') {
            // Found data chunk, return PCM data
            return fileBuffer.slice(offset + 8, offset + 8 + chunkSize);
          }

          offset += 8 + chunkSize;
        }

        // If we get here, no data chunk found, assume entire file after header
        return fileBuffer.slice(44);
      }

      // Not a WAV file, return as-is (raw PCM)
      return fileBuffer;

    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        `Failed to read audio file: ${filePath}`,
        error as Error
      );
    }
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Create transcription engine instance
   */
  private createEngine(engineType: 'vosk' | 'whisper'): TranscriptionEngine {
    switch (engineType) {
      case 'vosk':
        return new VoskTranscriptionEngine();
      case 'whisper':
        return new WhisperTranscriptionEngine();
      default:
        throw new TranscriptionError(
          TranscriptionErrorType.INVALID_CONFIGURATION,
          `Unsupported engine type for session: ${engineType}`
        );
    }
  }
}
