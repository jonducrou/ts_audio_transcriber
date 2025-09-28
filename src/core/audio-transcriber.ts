import { EventEmitter } from 'events';
import {
  AudioTranscriberEvents,
  TranscriberOptions,
  AudioDevice,
  TranscriptionEvent,
  TranscriptionError,
  TranscriptionErrorType,
  PerformanceMetrics,
  AudioCapture,
  TranscriptionEngine,
  AudioStream,
  EngineConfig,
  TranscriptionEngineType
} from '../types';
import { MacAudioCapture } from '../audio/capture';
import { VoskTranscriptionEngine } from '../engines/vosk/vosk-engine';

/**
 * Main AudioTranscriber class that orchestrates audio capture and transcription
 */
export class AudioTranscriber extends EventEmitter {
  private _audioCapture: AudioCapture;
  private _transcriptionEngine: TranscriptionEngine;
  private _options: TranscriberOptions;
  private _isRunning = false;
  private _microphoneStream?: AudioStream;
  private _systemAudioStream?: AudioStream;
  private _metrics: PerformanceMetrics;
  private _metricsInterval?: NodeJS.Timeout;
  private _processingQueue: Array<{ data: Buffer; source: string; timestamp: number }> = [];
  private _isProcessing = false;

  constructor(options: TranscriberOptions = {}) {
    super();

    this._options = {
      enableMicrophone: true,
      enableSystemAudio: false,
      enablePartialResults: true,
      confidenceThreshold: 0.3,
      maxBufferDuration: 10,
      autoDetectLanguage: false,
      enableSpeakerDetection: false,
      engine: {
        engine: 'vosk',
        language: 'en'
      },
      audioConfig: {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        format: 'pcm',
        bufferSize: 1024
      },
      ...options
    };

    this._audioCapture = new MacAudioCapture();
    this._transcriptionEngine = this.createTranscriptionEngine();

    this._metrics = {
      averageLatency: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      transcriptionCount: 0,
      errorCount: 0,
      partialResultCount: 0,
      averageConfidence: 0,
      lastUpdated: Date.now()
    };

    this.setupErrorHandling();
  }

  /**
   * Start audio transcription
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'AudioTranscriber is already running'
      );
    }

    try {
      console.log('=== AUDIOTRANSCRIBER START ===');
      console.log('Options:', JSON.stringify(this._options, null, 2));

      // Initialize audio capture
      if (this._audioCapture.initialize) {
        await this._audioCapture.initialize();
      }

      // Initialize transcription engine
      await this._transcriptionEngine.initialize(this._options.engine!);

      // Request permissions
      const hasPermissions = await this._audioCapture.requestPermissions();
      if (!hasPermissions) {
        throw new TranscriptionError(
          TranscriptionErrorType.PERMISSION_DENIED,
          'Audio capture permissions denied'
        );
      }

      // Start audio streams based on configuration
      const streamPromises: Promise<void>[] = [];

      if (this._options.enableMicrophone) {
        streamPromises.push(this.startMicrophoneCapture());
      }

      if (this._options.enableSystemAudio) {
        streamPromises.push(this.startSystemAudioCapture());
      }

      if (streamPromises.length === 0) {
        throw new TranscriptionError(
          TranscriptionErrorType.INVALID_CONFIGURATION,
          'At least one audio source must be enabled'
        );
      }

      await Promise.all(streamPromises);

      this._isRunning = true;
      this.startMetricsCollection();
      this.emit('started');

      console.log('AudioTranscriber started successfully');

    } catch (error) {
      await this.cleanup();
      if (error instanceof TranscriptionError) {
        this._metrics.errorCount++;
        this.emit('error', error);
        throw error;
      }

      const transcriptionError = new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Failed to start AudioTranscriber',
        error as Error
      );
      this._metrics.errorCount++;
      this.emit('error', transcriptionError);
      throw transcriptionError;
    }
  }

  /**
   * Stop audio transcription
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    try {
      console.log('Stopping AudioTranscriber...');
      this._isRunning = false;

      // Stop metrics collection
      if (this._metricsInterval) {
        clearInterval(this._metricsInterval);
        this._metricsInterval = undefined;
      }

      // Stop audio streams
      const stopPromises: Promise<void>[] = [];

      if (this._microphoneStream) {
        stopPromises.push(this._microphoneStream.stop());
        this._microphoneStream = undefined;
      }

      if (this._systemAudioStream) {
        stopPromises.push(this._systemAudioStream.stop());
        this._systemAudioStream = undefined;
      }

      // Stop all streams in audio capture
      stopPromises.push(this._audioCapture.stopAllStreams());

      await Promise.all(stopPromises);

      // Clean up transcription engine
      await this._transcriptionEngine.destroy();

      // Process any remaining items in queue
      await this.flushProcessingQueue();

      this.emit('stopped');
      console.log('AudioTranscriber stopped successfully');

    } catch (error) {
      const transcriptionError = new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Error stopping AudioTranscriber',
        error as Error
      );
      this._metrics.errorCount++;
      this.emit('error', transcriptionError);
      throw transcriptionError;
    }
  }

  /**
   * Get available audio devices
   */
  async getAvailableDevices(): Promise<AudioDevice[]> {
    try {
      return await this._audioCapture.getAvailableDevices();
    } catch (error) {
      const transcriptionError = new TranscriptionError(
        TranscriptionErrorType.DEVICE_NOT_FOUND,
        'Failed to get available audio devices',
        error as Error
      );
      this._metrics.errorCount++;
      this.emit('error', transcriptionError);
      throw transcriptionError;
    }
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this._metrics };
  }

  /**
   * Check if the transcriber is currently running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Update transcriber options (requires restart to take effect)
   */
  updateOptions(options: Partial<TranscriberOptions>): void {
    this._options = { ...this._options, ...options };
    console.log('Options updated. Restart required for changes to take effect.');
  }

  /**
   * Get current configuration
   */
  getOptions(): TranscriberOptions {
    return { ...this._options };
  }

  /**
   * Get transcription engine information
   */
  getEngineInfo(): {
    type: TranscriptionEngineType;
    isReady: boolean;
    supportedLanguages: string[];
    supportsRealTime: boolean;
    config: EngineConfig;
  } {
    return {
      type: this._transcriptionEngine.getEngineType(),
      isReady: this._transcriptionEngine.isReady(),
      supportedLanguages: this._transcriptionEngine.getSupportedLanguages(),
      supportsRealTime: this._transcriptionEngine.supportsRealTimeStreaming(),
      config: this._transcriptionEngine.getConfig()
    };
  }

  /**
   * Type-safe event emitter methods
   */
  public on<K extends keyof AudioTranscriberEvents>(
    event: K,
    listener: AudioTranscriberEvents[K]
  ): this {
    return super.on(event, listener);
  }

  public emit<K extends keyof AudioTranscriberEvents>(
    event: K,
    ...args: Parameters<AudioTranscriberEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  private createTranscriptionEngine(): TranscriptionEngine {
    const engineType = this._options.engine?.engine || 'vosk';

    switch (engineType) {
      case 'vosk':
        return new VoskTranscriptionEngine();
      default:
        throw new TranscriptionError(
          TranscriptionErrorType.INVALID_CONFIGURATION,
          `Unsupported transcription engine: ${engineType}`
        );
    }
  }

  private async startMicrophoneCapture(): Promise<void> {
    try {
      const supports = await this._audioCapture.supportsMicrophoneCapture();
      if (!supports) {
        throw new TranscriptionError(
          TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
          'Microphone capture is not supported on this system'
        );
      }

      this._microphoneStream = await this._audioCapture.startMicrophoneCapture(
        this._options.microphoneDeviceId,
        this._options.audioConfig
      );

      this.setupStreamHandlers(this._microphoneStream, 'microphone');
      console.log('Microphone capture started');

    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        'Failed to start microphone capture',
        error as Error
      );
    }
  }

  private async startSystemAudioCapture(): Promise<void> {
    try {
      const supports = await this._audioCapture.supportsSystemAudioCapture();
      if (!supports) {
        throw new TranscriptionError(
          TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
          'System audio capture is not supported on this system'
        );
      }

      this._systemAudioStream = await this._audioCapture.startSystemAudioCapture(
        this._options.audioConfig
      );

      this.setupStreamHandlers(this._systemAudioStream, 'system-audio');
      console.log('System audio capture started');

    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        'Failed to start system audio capture',
        error as Error
      );
    }
  }

  private setupStreamHandlers(stream: AudioStream, source: 'microphone' | 'system-audio'): void {
    stream.onData(async (audioData: Buffer, timestamp: number) => {
      if (!this._isRunning) return;

      console.log(`Received audio data from ${source}: ${audioData.length} bytes`);

      try {
        // Add to processing queue
        this._processingQueue.push({
          data: audioData,
          source,
          timestamp
        });

        console.log(`Queue size: ${this._processingQueue.length}, Processing: ${this._isProcessing}`);

        // Process queue if not already processing
        if (!this._isProcessing) {
          await this.processQueue();
        }

      } catch (error) {
        const transcriptionError = new TranscriptionError(
          TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
          `Error processing ${source} audio`,
          error as Error
        );
        this._metrics.errorCount++;
        this.emit('error', transcriptionError);
      }
    });

    stream.onError((error: Error) => {
      const transcriptionError = new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        `${source} stream error`,
        error
      );
      this._metrics.errorCount++;
      this.emit('error', transcriptionError);
    });

    stream.onEnd(() => {
      console.log(`${source} stream ended`);
      if (this._isRunning) {
        // Try to restart the stream if we're still supposed to be running
        setTimeout(() => {
          if (this._isRunning) {
            if (source === 'microphone') {
              this.startMicrophoneCapture().catch(err => {
                console.error('Failed to restart microphone capture:', err);
              });
            } else {
              this.startSystemAudioCapture().catch(err => {
                console.error('Failed to restart system audio capture:', err);
              });
            }
          }
        }, 1000);
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      while (this._processingQueue.length > 0 && this._isRunning) {
        const item = this._processingQueue.shift();
        if (!item) break;

        const startTime = Date.now();

        console.log(`Processing audio item: ${item.data.length} bytes from ${item.source}`);

        // Process audio with transcription engine
        const transcriptionEvent = await this._transcriptionEngine.processAudio(
          item.data,
          item.source as any,
          item.timestamp
        );

        if (transcriptionEvent) {
          const latency = Date.now() - startTime;
          this.updateMetrics(latency, transcriptionEvent);

          console.log(`Got transcription: "${transcriptionEvent.text}" (confidence: ${transcriptionEvent.confidence}, partial: ${transcriptionEvent.isPartial})`);

          // Only emit if partial results are enabled or this is a final result
          if (this._options.enablePartialResults || !transcriptionEvent.isPartial) {
            // Apply confidence threshold
            if (transcriptionEvent.confidence >= (this._options.confidenceThreshold || 0.0)) {
              console.log(`Emitting transcription: "${transcriptionEvent.text}"`);
              this.emit('transcription', transcriptionEvent);
            } else {
              console.log(`Transcription below confidence threshold: ${transcriptionEvent.confidence} < ${this._options.confidenceThreshold}`);
            }
          } else {
            console.log('Skipping partial result (partial results disabled)');
          }
        } else {
          console.log('No transcription event returned');
        }

        // Prevent blocking the event loop
        if (this._processingQueue.length > 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    } catch (error) {
      console.error('Error in processing queue:', error);
    } finally {
      this._isProcessing = false;
    }
  }

  private async flushProcessingQueue(): Promise<void> {
    const maxWaitTime = 5000; // 5 seconds max wait
    const startTime = Date.now();

    while (this._processingQueue.length > 0 && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this._processingQueue.length > 0) {
      console.warn(`Discarded ${this._processingQueue.length} items from processing queue`);
      this._processingQueue = [];
    }
  }

  private setupErrorHandling(): void {
    this.on('error', (error: TranscriptionError) => {
      console.error('AudioTranscriber error:', error.message);
    });

    // Handle process termination gracefully
    const gracefulShutdown = async (signal: string) => {
      if (this._isRunning) {
        console.log(`Received ${signal}, stopping AudioTranscriber...`);
        try {
          await this.stop();
          process.exit(0);
        } catch (err) {
          console.error('Error during graceful shutdown:', err);
          process.exit(1);
        }
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  }

  private startMetricsCollection(): void {
    this._metricsInterval = setInterval(() => {
      this.updateSystemMetrics();
      this.emit('metrics', this.getMetrics());
    }, 5000); // Update every 5 seconds
  }

  private updateMetrics(latency: number, event: TranscriptionEvent): void {
    this._metrics.transcriptionCount++;

    if (event.isPartial) {
      this._metrics.partialResultCount++;
    }

    // Update running average of latency
    const count = this._metrics.transcriptionCount;
    this._metrics.averageLatency =
      ((this._metrics.averageLatency * (count - 1)) + latency) / count;

    // Update running average of confidence
    this._metrics.averageConfidence =
      ((this._metrics.averageConfidence * (count - 1)) + event.confidence) / count;

    this._metrics.lastUpdated = Date.now();
  }

  private updateSystemMetrics(): void {
    // Basic system metrics
    const memUsage = process.memoryUsage();
    this._metrics.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024);

    // Estimate CPU usage based on processing activity
    const processingLoad = Math.min(this._processingQueue.length * 2, 100);
    this._metrics.cpuUsage = Math.min(processingLoad + (this._metrics.transcriptionCount * 0.01), 100);

    this._metrics.lastUpdated = Date.now();
  }

  private async cleanup(): Promise<void> {
    try {
      if (this._metricsInterval) {
        clearInterval(this._metricsInterval);
        this._metricsInterval = undefined;
      }

      const cleanupPromises: Promise<any>[] = [];

      if (this._microphoneStream) {
        cleanupPromises.push(this._microphoneStream.stop());
        this._microphoneStream = undefined;
      }

      if (this._systemAudioStream) {
        cleanupPromises.push(this._systemAudioStream.stop());
        this._systemAudioStream = undefined;
      }

      cleanupPromises.push(this._audioCapture.stopAllStreams());

      if (this._transcriptionEngine.isReady()) {
        cleanupPromises.push(this._transcriptionEngine.destroy());
      }

      await Promise.all(cleanupPromises);

      this._processingQueue = [];
      this._isProcessing = false;

    } catch (error) {
      console.warn('Error during cleanup:', error);
    }
  }
}