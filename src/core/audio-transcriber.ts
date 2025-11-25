import { EventEmitter } from 'events';
import {
  AudioTranscriberEvents,
  TranscriberOptions,
  AudioDevice,
  SnippetTranscriptionEvent,
  SessionTranscriptionEvent,
  RecordingMetadata,
  RecordingProgress,
  TranscriptionError,
  TranscriptionErrorType,
  PerformanceMetrics,
  AudioCapture,
  AudioStream,
  AudioSource,
  DeviceDisconnectedEvent,
  ReconnectionAttemptEvent,
  ReconnectionFailedEvent,
  ReconnectionSuccessEvent,
  RecordingRotationResult
} from '../types';
import { MacAudioCapture } from '../audio/capture';
import { StreamEndContext } from '../audio/stream';
import { SessionRecorder } from './session-recorder';
import { SnippetPipeline } from './snippet-pipeline';
import { SessionPipeline } from './session-pipeline';
import { ReconnectionManager } from './reconnection-manager';

/**
 * Main AudioTranscriber class - orchestrates dual-mode transcription (v2.0.0)
 *
 * Provides two simultaneous transcription modes:
 * 1. Snippet Pipeline: Real-time 15-second chunks (Vosk, low latency)
 * 2. Session Pipeline: Complete session transcript (Vosk, high accuracy)
 */
export class AudioTranscriber extends EventEmitter {
  private _audioCapture: AudioCapture;
  private _sessionRecorder?: SessionRecorder;
  private _snippetPipeline?: SnippetPipeline;
  private _sessionPipeline?: SessionPipeline;
  private _options: TranscriberOptions;
  private _isRunning = false;
  private _isStopping = false;
  private _stopPromise?: Promise<void>;
  private _stopResolve?: () => void;
  private _microphoneStream?: AudioStream;
  private _systemAudioStream?: AudioStream;
  private _metrics: PerformanceMetrics;
  private _metricsInterval?: NodeJS.Timeout;
  private _recordingProgressInterval?: NodeJS.Timeout;
  private _microphoneReconnectManager: ReconnectionManager;
  private _systemAudioReconnectManager: ReconnectionManager;

  constructor(options: TranscriberOptions = {}) {
    super();

    // Set defaults
    this._options = {
      enableMicrophone: true,
      enableSystemAudio: false,
      audioConfig: {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        format: 'pcm',
        bufferSize: 1024
      },
      ...options
    };

    // Validate configuration
    this.validateOptions();

    this._audioCapture = new MacAudioCapture();

    this._metrics = {
      snippetCount: 0,
      snippetAverageLatency: 0,
      snippetAverageConfidence: 0,
      sessionTranscriptCount: 0,
      sessionAverageProcessingTime: 0,
      sessionAverageConfidence: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      errorCount: 0,
      lastUpdated: Date.now()
    };

    this.setupErrorHandling();

    // Initialize reconnection managers with user config or defaults
    this._microphoneReconnectManager = new ReconnectionManager(options.reconnection);
    this._systemAudioReconnectManager = new ReconnectionManager(options.reconnection);
  }

  /**
   * Start audio transcription (both pipelines and recording as configured)
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'AudioTranscriber is already running'
      );
    }

    // Wait for stop() to complete if in progress (Promise-based coordination)
    if (this._isStopping && this._stopPromise) {
      console.log('Waiting for previous stop() to complete...');
      try {
        // Wait for stop promise with timeout
        await Promise.race([
          this._stopPromise,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Stop timeout')), 5000)
          )
        ]);
      } catch (error) {
        throw new TranscriptionError(
          TranscriptionErrorType.INVALID_CONFIGURATION,
          'Previous stop() operation did not complete in time. Please try again.'
        );
      }
    }

    try {
      console.log('=== AUDIOTRANSCRIBER v2.0.0 START ===');
      console.log('Configuration:', {
        microphone: this._options.enableMicrophone,
        systemAudio: this._options.enableSystemAudio,
        snippets: this._options.snippets?.enabled,
        session: this._options.sessionTranscript?.enabled,
        recording: this._options.recording?.enabled
      });

      // Initialize audio capture
      if (this._audioCapture.initialize) {
        await this._audioCapture.initialize();
      }

      // Request permissions
      const hasPermissions = await this._audioCapture.requestPermissions();
      if (!hasPermissions) {
        throw new TranscriptionError(
          TranscriptionErrorType.PERMISSION_DENIED,
          'Audio capture permissions denied'
        );
      }

      // Initialize recording if enabled
      if (this._options.recording?.enabled) {
        this._sessionRecorder = new SessionRecorder(
          this._options.recording,
          this._options.audioConfig!
        );
        const metadata = await this._sessionRecorder.start();
        this.emit('recordingStarted', metadata);

        // Start progress reporting
        this._recordingProgressInterval = setInterval(() => {
          if (this._sessionRecorder?.isRecording()) {
            this.emit('recordingProgress', this._sessionRecorder.getProgress());
          }
        }, 5000); // Every 5 seconds
      }

      // Initialize snippet pipeline if enabled
      if (this._options.snippets?.enabled) {
        this._snippetPipeline = new SnippetPipeline(
          this._options.snippets,
          this.emitSnippet.bind(this)
        );
        await this._snippetPipeline.start();
      }

      // Initialize session pipeline if enabled
      if (this._options.sessionTranscript?.enabled) {
        this._sessionPipeline = new SessionPipeline(
          this._options.sessionTranscript,
          this.emitSessionTranscript.bind(this)
        );
        await this._sessionPipeline.start();
      }

      // Start audio streams
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
      if (this._snippetPipeline) console.log('  - Snippet pipeline active');
      if (this._sessionPipeline) console.log('  - Session pipeline active');
      if (this._sessionRecorder) console.log('  - Recording to disk');

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
   * Stop audio transcription and process final session transcript
   * Ensures sessionTranscript is always emitted even if cleanup fails
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    // Handle concurrent stop() calls - return existing promise
    if (this._isStopping) {
      console.warn('Stop already in progress, waiting for completion...');
      return this._stopPromise;
    }

    this._isStopping = true;
    this._stopPromise = new Promise<void>(resolve => {
      this._stopResolve = resolve;
    });
    const errors: Array<{ step: string; error: Error }> = [];

    try {
      console.log('Stopping AudioTranscriber...');
      this._isRunning = false;

      // Stop metrics collection (non-critical)
      try {
        if (this._metricsInterval) {
          clearInterval(this._metricsInterval);
          this._metricsInterval = undefined;
        }
        if (this._recordingProgressInterval) {
          clearInterval(this._recordingProgressInterval);
          this._recordingProgressInterval = undefined;
        }
      } catch (error) {
        errors.push({ step: 'stop metrics intervals', error: error as Error });
        console.warn('Non-critical error stopping metrics:', error);
      }

      // CRITICAL: Process session transcript FIRST before any cleanup
      // This ensures the transcript is emitted even if cleanup fails
      let recordingMetadata: RecordingMetadata | undefined;
      if (this._sessionRecorder && this._sessionPipeline) {
        try {
          console.log('Stopping recording and processing final session transcript...');
          recordingMetadata = await this._sessionRecorder.stop();
          this.emit('recordingStopped', recordingMetadata);

          // Process final session - this is critical for data integrity
          const source: AudioSource = this._options.enableMicrophone ? 'microphone' : 'system-audio';
          try {
            await this._sessionPipeline.processFinalSession(recordingMetadata, source);
            console.log('✅ Session transcript processed and emitted successfully');
          } catch (error) {
            errors.push({ step: 'process session transcript', error: error as Error });
            console.error('Failed to process final session transcript:', error);
            this.emit('error', new TranscriptionError(
              TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
              'Failed to process session transcript',
              error as Error
            ));
          }
        } catch (error) {
          errors.push({ step: 'stop recording', error: error as Error });
          console.error('Failed to stop recording:', error);
          this.emit('error', new TranscriptionError(
            TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
            'Failed to stop recording',
            error as Error
          ));
        }
      }

      // Stop audio streams (cleanup - errors are non-critical)
      try {
        const stopPromises: Promise<void>[] = [];

        if (this._microphoneStream) {
          stopPromises.push(
            this._microphoneStream.stop().catch(err => {
              errors.push({ step: 'stop microphone stream', error: err });
              console.warn('Error stopping microphone stream:', err);
            })
          );
          this._microphoneStream = undefined;
        }

        if (this._systemAudioStream) {
          stopPromises.push(
            this._systemAudioStream.stop().catch(err => {
              errors.push({ step: 'stop system audio stream', error: err });
              console.warn('Error stopping system audio stream:', err);
            })
          );
          this._systemAudioStream = undefined;
        }

        stopPromises.push(
          this._audioCapture.stopAllStreams().catch(err => {
            errors.push({ step: 'stop all audio streams', error: err });
            console.warn('Error stopping all audio streams:', err);
          })
        );

        await Promise.all(stopPromises);
      } catch (error) {
        errors.push({ step: 'stop audio streams', error: error as Error });
        console.warn('Error stopping audio streams:', error);
      }

      // Stop snippet pipeline (cleanup - errors are non-critical)
      if (this._snippetPipeline) {
        try {
          await this._snippetPipeline.stop();
        } catch (error) {
          errors.push({ step: 'stop snippet pipeline', error: error as Error });
          console.warn('Error stopping snippet pipeline:', error);
        }
      }

      // Stop session pipeline (cleanup - errors are non-critical)
      if (this._sessionPipeline) {
        try {
          await this._sessionPipeline.stop();
        } catch (error) {
          errors.push({ step: 'stop session pipeline', error: error as Error });
          console.warn('Error stopping session pipeline:', error);
        }
      }

      // Auto-cleanup recording file (cleanup - errors are non-critical)
      if (this._sessionRecorder && recordingMetadata && this._options.recording?.autoCleanup) {
        try {
          console.log('Auto-cleanup enabled, deleting recording...');
          await this._sessionRecorder.deleteRecording();
        } catch (error) {
          errors.push({ step: 'delete recording file', error: error as Error });
          console.warn('Error deleting recording file:', error);
        }
      }

      // Always emit stopped event
      this.emit('stopped');
      console.log('AudioTranscriber stopped successfully');

      // If there were non-critical errors, log summary but don't throw
      if (errors.length > 0) {
        console.warn(`Stop completed with ${errors.length} non-critical error(s):`);
        errors.forEach(({ step, error }) => {
          console.warn(`  - ${step}: ${error.message}`);
        });
      }

    } catch (error) {
      // Critical error during stop - this should be rare
      const transcriptionError = new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        `Critical error stopping AudioTranscriber: ${(error as Error).message}`,
        error as Error
      );
      this._metrics.errorCount++;
      this.emit('error', transcriptionError);
      throw transcriptionError;
    } finally {
      // Always clear the stopping flag and resolve the promise
      this._isStopping = false;
      this._stopResolve?.();
      this._stopPromise = undefined;
      this._stopResolve = undefined;
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
   * Get current session ID (if recording active)
   */
  getSessionId(): string | undefined {
    return this._sessionRecorder?.getSessionId() || undefined;
  }

  /**
   * Get path to current recording file (if recording active)
   */
  getRecordingPath(): string | undefined {
    if (!this._sessionRecorder?.isRecording()) {
      return undefined;
    }
    try {
      return this._sessionRecorder.getMetadata().audioFilePath;
    } catch {
      return undefined;
    }
  }

  /**
   * Rotate the current recording without stopping transcription
   * - Finalises current WAV file
   * - Emits sessionTranscript for completed segment
   * - Starts new recording with new session ID
   * - Snippet pipeline continues uninterrupted
   *
   * @param newOutputDir Optional new output directory for the new recording
   * @returns Rotation result with previous and new session info
   */
  async rotateRecording(newOutputDir?: string): Promise<RecordingRotationResult> {
    if (!this._isRunning) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'AudioTranscriber is not running'
      );
    }

    if (!this._sessionRecorder?.isRecording()) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Recording is not active'
      );
    }

    // Stop progress reporting during rotation
    if (this._recordingProgressInterval) {
      clearInterval(this._recordingProgressInterval);
      this._recordingProgressInterval = undefined;
    }

    try {
      console.log('Rotating recording...');

      // 1. Stop current recording and get metadata
      const previousMetadata = await this._sessionRecorder.stop();
      this.emit('recordingStopped', previousMetadata);

      // 2. Process session transcript for completed segment (if session pipeline is active)
      if (this._sessionPipeline?.isRunning()) {
        const source: AudioSource = this._options.enableMicrophone ? 'microphone' : 'system-audio';
        try {
          await this._sessionPipeline.processFinalSession(previousMetadata, source);
          console.log('Session transcript processed for rotated segment');
        } catch (error) {
          console.error('Error processing session transcript during rotation:', error);
          this.emit('error', new TranscriptionError(
            TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
            'Failed to process session transcript during rotation',
            error as Error
          ));
        }
      }

      // 3. Create new session recorder with new/same output directory
      const recordingConfig = newOutputDir
        ? { ...this._options.recording!, outputDir: newOutputDir }
        : this._options.recording!;

      this._sessionRecorder = new SessionRecorder(
        recordingConfig,
        this._options.audioConfig!
      );

      // 4. Start new recording
      const newMetadata = await this._sessionRecorder.start();
      this.emit('recordingStarted', newMetadata);

      // 5. Restart progress reporting
      this._recordingProgressInterval = setInterval(() => {
        if (this._sessionRecorder?.isRecording()) {
          this.emit('recordingProgress', this._sessionRecorder.getProgress());
        }
      }, 5000);

      // 6. Create and return rotation result
      const result: RecordingRotationResult = {
        previousSessionId: previousMetadata.sessionId,
        newSessionId: newMetadata.sessionId,
        completedFilePath: previousMetadata.audioFilePath,
        timestamp: Date.now()
      };

      this.emit('recordingRotated', result);
      console.log(`Recording rotated: ${previousMetadata.sessionId} -> ${newMetadata.sessionId}`);

      return result;

    } catch (error) {
      // Re-enable progress reporting even on error
      this._recordingProgressInterval = setInterval(() => {
        if (this._sessionRecorder?.isRecording()) {
          this.emit('recordingProgress', this._sessionRecorder.getProgress());
        }
      }, 5000);

      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        'Failed to rotate recording',
        error as Error
      );
    }
  }

  /**
   * Type-safe event emitter methods
   */
  public on<K extends keyof AudioTranscriberEvents>(
    event: K,
    listener: (...args: any[]) => void
  ): this {
    return super.on(event, listener);
  }

  public emit<K extends keyof AudioTranscriberEvents>(
    event: K,
    ...args: any[]
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Emit snippet event (callback for SnippetPipeline)
   */
  private emitSnippet(event: SnippetTranscriptionEvent): void {
    this.emit('snippet', event);

    // Update metrics
    this._metrics.snippetCount++;
    const avgConf = this._metrics.snippetAverageConfidence;
    const count = this._metrics.snippetCount;
    this._metrics.snippetAverageConfidence = ((avgConf * (count - 1)) + event.confidence) / count;
  }

  /**
   * Emit session transcript event (callback for SessionPipeline)
   */
  private emitSessionTranscript(event: SessionTranscriptionEvent): void {
    console.log('🎯 AUDIOTRANSCRIBER: emitSessionTranscript called');
    console.log('Event:', {
      sessionId: event.sessionId,
      text: event.text.substring(0, 100) + '...',
      confidence: event.confidence,
      wordCount: event.metadata.wordCount
    });

    this.emit('sessionTranscript', event);
    console.log('✅ AUDIOTRANSCRIBER: sessionTranscript event emitted');

    // Update metrics
    this._metrics.sessionTranscriptCount++;
    const avgTime = this._metrics.sessionAverageProcessingTime;
    const avgConf = this._metrics.sessionAverageConfidence;
    const count = this._metrics.sessionTranscriptCount;
    this._metrics.sessionAverageProcessingTime =
      ((avgTime * (count - 1)) + event.metadata.processingTime) / count;
    this._metrics.sessionAverageConfidence =
      ((avgConf * (count - 1)) + event.confidence) / count;
  }

  /**
   * Start microphone capture
   */
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

  /**
   * Start system audio capture
   */
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

  /**
   * Setup audio stream handlers - broadcasts to all active components
   */
  private setupStreamHandlers(stream: AudioStream, source: AudioSource): void {
    let chunkCount = 0;
    let totalBytes = 0;
    let lastChunkTime = Date.now();

    stream.onData((audioData: Buffer, timestamp: number) => {
      if (!this._isRunning) return;

      chunkCount++;
      totalBytes += audioData.length;
      const now = Date.now();
      const timeSinceLastChunk = now - lastChunkTime;
      lastChunkTime = now;

      // Log EVERY chunk to understand the flow
      const first16 = audioData.slice(0, 16);
      const hex = first16.toString('hex').match(/.{1,2}/g)?.join(' ') || '';
      console.log(`[AUDIO-STREAM] Chunk ${chunkCount}: ${audioData.length} bytes (total: ${totalBytes} bytes, ${timeSinceLastChunk}ms since last), first 16: ${hex}`);

      try {
        // Broadcast audio to all active components

        // 1. Recording
        if (this._sessionRecorder?.isRecording()) {
          this._sessionRecorder.writeChunk(audioData);
        }

        // 2. Snippet pipeline (non-blocking - fire and forget)
        if (this._snippetPipeline?.isRunning()) {
          // Process asynchronously without blocking the stream read
          this._snippetPipeline.processAudio(audioData, source, timestamp).catch(error => {
            console.error('Snippet pipeline processing error:', error);
            this._metrics.errorCount++;
          });
        }

        // 3. Session pipeline does NOT process during recording (post-session only)

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

    stream.onEnd((endContext?: StreamEndContext) => {
      console.log(`${source} stream ended - received ${chunkCount} chunks, ${totalBytes} total bytes`);

      // Don't attempt reconnection if we're stopping
      if (!this._isRunning || this._isStopping) {
        return;
      }

      const reason = endContext?.reason || 'unknown';
      const reconnectManager = source === 'microphone'
        ? this._microphoneReconnectManager
        : this._systemAudioReconnectManager;

      // Emit device disconnected event with full context
      const disconnectEvent: DeviceDisconnectedEvent = {
        source,
        reason,
        error: endContext?.error,
        timestamp: Date.now(),
        willAttemptReconnect: reconnectManager.canRetry(),
        sessionId: this._sessionRecorder?.getSessionId() ?? undefined,
        durationAtDisconnect: this._sessionRecorder?.getProgress().duration
      };
      this.emit('deviceDisconnected', disconnectEvent);

      // Attempt reconnection if configured and not exhausted
      if (reconnectManager.canRetry()) {
        this.attemptReconnection(source, reconnectManager, endContext?.error);
      } else {
        this.emitReconnectionFailed(source, reconnectManager, endContext?.error);
      }
    });
  }

  /**
   * Attempt to reconnect a disconnected audio source with exponential backoff
   */
  private async attemptReconnection(
    source: AudioSource,
    manager: ReconnectionManager,
    lastError?: Error
  ): Promise<void> {
    const { attemptNumber, delay } = manager.startAttempt();

    // Emit reconnection attempt event
    const attemptEvent: ReconnectionAttemptEvent = {
      source,
      attemptNumber,
      maxAttempts: manager.getConfig().maxAttempts,
      delayMs: delay,
      timestamp: Date.now()
    };
    this.emit('reconnectionAttempt', attemptEvent);

    console.log(`Reconnection attempt ${attemptNumber}/${manager.getConfig().maxAttempts} for ${source} in ${delay}ms`);

    // Wait for exponential backoff delay
    await new Promise(resolve => setTimeout(resolve, delay));

    // Check if we should still be running
    if (!this._isRunning || this._isStopping) {
      manager.reset();
      return;
    }

    try {
      if (source === 'microphone') {
        await this.startMicrophoneCapture();
      } else {
        await this.startSystemAudioCapture();
      }

      // Success!
      const successResult = manager.onSuccess();
      const successEvent: ReconnectionSuccessEvent = {
        source,
        attemptsRequired: successResult.attemptsRequired,
        reconnectionTimeMs: successResult.reconnectionTimeMs,
        timestamp: Date.now()
      };
      this.emit('reconnectionSuccess', successEvent);
      console.log(`Successfully reconnected ${source} after ${successResult.attemptsRequired} attempt(s)`);

    } catch (error) {
      console.error(`Reconnection attempt ${attemptNumber} failed for ${source}:`, error);

      if (manager.canRetry()) {
        // Schedule next attempt
        this.attemptReconnection(source, manager, error as Error);
      } else {
        this.emitReconnectionFailed(source, manager, error as Error);
      }
    }
  }

  /**
   * Emit reconnection failed event when all attempts are exhausted
   */
  private emitReconnectionFailed(
    source: AudioSource,
    manager: ReconnectionManager,
    lastError?: Error
  ): void {
    const { totalAttempts, elapsedMs } = manager.onFinalFailure();

    // Determine recommendation based on error type
    let recommendation: 'manual_restart' | 'check_device' | 'check_permissions' = 'manual_restart';
    if (lastError?.message?.toLowerCase().includes('permission')) {
      recommendation = 'check_permissions';
    } else if (lastError?.message?.toLowerCase().includes('not found')) {
      recommendation = 'check_device';
    }

    const failedEvent: ReconnectionFailedEvent = {
      source,
      totalAttempts,
      elapsedMs,
      lastError,
      timestamp: Date.now(),
      recommendation
    };
    this.emit('reconnectionFailed', failedEvent);
    console.error(`Reconnection failed for ${source} after ${totalAttempts} attempts (${elapsedMs}ms). Recommendation: ${recommendation}`);

    // Reset manager for potential future reconnection attempts
    manager.reset();
  }

  /**
   * Validate configuration options
   */
  private validateOptions(): void {
    // At least one pipeline must be enabled
    const snippetsEnabled = this._options.snippets?.enabled;
    const sessionEnabled = this._options.sessionTranscript?.enabled;

    if (!snippetsEnabled && !sessionEnabled) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'At least one pipeline must be enabled (snippets or sessionTranscript)'
      );
    }

    // Session pipeline requires recording
    if (sessionEnabled && !this._options.recording?.enabled) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Session transcript pipeline requires recording to be enabled'
      );
    }

    // Recording requires output directory
    if (this._options.recording?.enabled && !this._options.recording.outputDir) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Recording requires outputDir to be specified'
      );
    }
  }

  /**
   * Setup error handling
   */
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

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this._metricsInterval = setInterval(() => {
      this.updateSystemMetrics();
      this.emit('metrics', this.getMetrics());
    }, 5000); // Update every 5 seconds
  }

  /**
   * Update system metrics
   */
  private updateSystemMetrics(): void {
    // Basic system metrics
    const memUsage = process.memoryUsage();
    this._metrics.memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024);

    // Estimate CPU usage based on processing activity
    const snippetLoad = this._snippetPipeline?.isRunning() ? 10 : 0;
    this._metrics.cpuUsage = Math.min(snippetLoad + (this._metrics.snippetCount * 0.01), 100);

    this._metrics.lastUpdated = Date.now();
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    try {
      if (this._metricsInterval) {
        clearInterval(this._metricsInterval);
        this._metricsInterval = undefined;
      }

      if (this._recordingProgressInterval) {
        clearInterval(this._recordingProgressInterval);
        this._recordingProgressInterval = undefined;
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

      if (this._snippetPipeline?.isRunning()) {
        cleanupPromises.push(this._snippetPipeline.stop());
      }

      if (this._sessionPipeline?.isRunning()) {
        cleanupPromises.push(this._sessionPipeline.stop());
      }

      if (this._sessionRecorder?.isRecording()) {
        cleanupPromises.push(this._sessionRecorder.stop());
      }

      await Promise.all(cleanupPromises);

    } catch (error) {
      console.warn('Error during cleanup:', error);
    }
  }
}
