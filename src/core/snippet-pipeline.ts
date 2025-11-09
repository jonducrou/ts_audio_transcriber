import {
  SnippetPipelineConfig,
  SnippetTranscriptionEvent,
  AudioSource,
  TranscriptionEngine,
  TranscriptionError,
  TranscriptionErrorType,
  EngineConfig
} from '../types';
import { VoskTranscriptionEngine } from '../engines/vosk/vosk-engine';

/**
 * SnippetPipeline handles real-time 15-second chunk processing
 * Optimised for low latency with Vosk engine
 */
export class SnippetPipeline {
  private _config: SnippetPipelineConfig;
  private _engine: TranscriptionEngine | null = null;
  private _audioBuffer: Buffer = Buffer.alloc(0);
  private _bufferStartTime: number = 0;
  private _snippetIndex: number = 0;
  private _isRunning: boolean = false;
  private _processingQueue: Array<{ data: Buffer; source: AudioSource; timestamp: number }> = [];
  private _isProcessing: boolean = false;
  private _maxQueueSize: number = 3;
  private _emitCallback: (event: SnippetTranscriptionEvent) => void;

  constructor(
    config: SnippetPipelineConfig,
    emitCallback: (event: SnippetTranscriptionEvent) => void
  ) {
    this._config = {
      intervalSeconds: 15,
      confidenceThreshold: 0.4,
      ...config
    };
    this._emitCallback = emitCallback;
  }

  /**
   * Initialize and start the snippet pipeline
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Snippet pipeline is already running'
      );
    }

    // Create and initialize engine
    this._engine = this.createEngine(this._config.engine);

    const engineConfig: EngineConfig = {
      engine: this._config.engine,
      ...this._config.engineOptions
    };

    await this._engine.initialize(engineConfig);

    // Reset state
    this._audioBuffer = Buffer.alloc(0);
    this._bufferStartTime = 0;
    this._snippetIndex = 0;
    this._processingQueue = [];
    this._isProcessing = false;
    this._isRunning = true;

    console.log(`SnippetPipeline: Started with ${this._config.engine} engine`);
    console.log(`SnippetPipeline: Interval ${this._config.intervalSeconds}s, threshold ${this._config.confidenceThreshold}`);
  }

  /**
   * Stop the snippet pipeline
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    this._isRunning = false;

    // Wait for queue to finish
    await this.flushQueue();

    // Cleanup engine
    if (this._engine) {
      await this._engine.destroy();
      this._engine = null;
    }

    console.log(`SnippetPipeline: Stopped (processed ${this._snippetIndex} snippets)`);
  }

  /**
   * Process incoming audio data
   */
  async processAudio(audioData: Buffer, source: AudioSource, timestamp: number): Promise<void> {
    if (!this._isRunning || !this._engine) {
      return;
    }

    // Accumulate audio
    this._audioBuffer = Buffer.concat([this._audioBuffer, audioData]);

    if (this._bufferStartTime === 0) {
      this._bufferStartTime = timestamp;
    }

    // Calculate buffer duration (16-bit PCM @ 16kHz)
    const bufferDurationSeconds = (this._audioBuffer.length / 2 / 16000);
    const intervalSeconds = this._config.intervalSeconds!;

    // Process when we reach the interval
    if (bufferDurationSeconds >= intervalSeconds) {
      const chunk = Buffer.from(this._audioBuffer);
      const chunkTimestamp = this._bufferStartTime;

      // Reset buffer for next snippet
      this._audioBuffer = Buffer.alloc(0);
      this._bufferStartTime = timestamp;

      // Add to processing queue with overflow protection
      if (this._processingQueue.length >= this._maxQueueSize) {
        console.warn(`SnippetPipeline: Queue overloaded (${this._processingQueue.length}), dropping oldest chunk`);
        this._processingQueue.shift(); // Drop oldest
      }

      this._processingQueue.push({
        data: chunk,
        source,
        timestamp: chunkTimestamp
      });

      // Start processing if not already processing
      if (!this._isProcessing) {
        this.processQueue().catch(err => {
          console.error('SnippetPipeline: Queue processing error:', err);
        });
      }
    }
  }

  /**
   * Check if pipeline is running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get current snippet index
   */
  getSnippetIndex(): number {
    return this._snippetIndex;
  }

  /**
   * Process queued audio chunks
   */
  private async processQueue(): Promise<void> {
    if (this._isProcessing) {
      return;
    }

    this._isProcessing = true;

    try {
      while (this._processingQueue.length > 0 && this._isRunning) {
        const item = this._processingQueue.shift();
        if (!item) break;

        const startTime = Date.now();

        try {
          await this.processChunk(item.data, item.source, item.timestamp);
        } catch (error) {
          console.error('SnippetPipeline: Error processing chunk:', error);
        }

        const processingTime = Date.now() - startTime;
        console.log(`SnippetPipeline: Processed chunk in ${processingTime}ms`);

        // Prevent blocking event loop
        if (this._processingQueue.length > 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Process a single audio chunk
   */
  private async processChunk(
    audioData: Buffer,
    source: AudioSource,
    timestamp: number
  ): Promise<void> {
    if (!this._engine) {
      return;
    }

    console.log(`SnippetPipeline: Processing snippet ${this._snippetIndex} (${audioData.length} bytes)`);

    const result = await this._engine.processAudio(audioData, source, timestamp);

    if (result && result.text.trim()) {
      // Check confidence threshold
      if (result.confidence >= this._config.confidenceThreshold!) {
        const snippetEvent: SnippetTranscriptionEvent = {
          text: result.text,
          source: result.source,
          confidence: result.confidence,
          timestamp: result.timestamp,
          snippetIndex: this._snippetIndex,
          engine: result.engine,
          type: 'snippet'
        };

        console.log(`SnippetPipeline: Emitting snippet ${this._snippetIndex}: "${result.text}" (confidence: ${result.confidence})`);

        this._emitCallback(snippetEvent);
        this._snippetIndex++;
      } else {
        console.log(`SnippetPipeline: Snippet below confidence threshold: ${result.confidence} < ${this._config.confidenceThreshold}`);
      }
    } else {
      console.log('SnippetPipeline: No transcription result or empty text');
    }

    // Reset Vosk recognizer after each snippet to prevent text accumulation
    if (this._config.engine === 'vosk' && this._engine && typeof (this._engine as any).resetRecognizer === 'function') {
      (this._engine as any).resetRecognizer();
    }
  }

  /**
   * Flush remaining queue items
   */
  private async flushQueue(): Promise<void> {
    const maxWaitTime = 5000; // 5 seconds max
    const startTime = Date.now();

    while (this._processingQueue.length > 0 && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this._processingQueue.length > 0) {
      console.warn(`SnippetPipeline: Discarded ${this._processingQueue.length} items from queue`);
      this._processingQueue = [];
    }
  }

  /**
   * Create transcription engine instance
   */
  private createEngine(engineType: 'vosk'): TranscriptionEngine {
    if (engineType === 'vosk') {
      return new VoskTranscriptionEngine();
    }
    throw new TranscriptionError(
      TranscriptionErrorType.INVALID_CONFIGURATION,
      `Unsupported engine type for snippets: ${engineType}`
    );
  }
}
