/**
 * Mock implementation of VoskTranscriptionEngine for testing
 */

import { EventEmitter } from 'events';
import {
  TranscriptionEngine,
  EngineConfig,
  TranscriptionEvent,
  AudioSource,
  TranscriptionEngineType,
  AudioStreamConfig
} from '../../src/types';

export class MockTranscriptionEngine extends EventEmitter implements TranscriptionEngine {
  private _isInitialized = false;
  private _engineReady = false;
  private _config?: EngineConfig;
  private _processedChunks = 0;
  private _lastPartialText = '';

  // Test control properties
  public shouldFailInitialize = false;
  public shouldFailProcessing = false;
  public initializeDelay = 0;
  public processingDelay = 0;
  public transcriptionResponses: TranscriptionEvent[] = [];
  public currentResponseIndex = 0;
  public emitPartials = true;

  async initialize(config: EngineConfig): Promise<void> {
    if (this.initializeDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.initializeDelay));
    }

    if (this.shouldFailInitialize) {
      throw new Error('Mock: Failed to initialize transcription engine');
    }

    this._config = config;
    this._isInitialized = true;
    this._engineReady = true;
    this.emit('ready');
  }

  async processAudio(
    audioData: Buffer,
    source: AudioSource,
    timestamp: number
  ): Promise<TranscriptionEvent | null> {
    if (!this._engineReady) {
      throw new Error('Mock: Engine is not ready for processing');
    }

    if (this.processingDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.processingDelay));
    }

    if (this.shouldFailProcessing) {
      throw new Error('Mock: Failed to process audio');
    }

    this._processedChunks++;

    // Return pre-configured responses if available
    if (this.transcriptionResponses.length > 0 && this.currentResponseIndex < this.transcriptionResponses.length) {
      const response = {
        ...this.transcriptionResponses[this.currentResponseIndex],
        source,
        timestamp,
        engine: this.getEngineType()
      };
      this.currentResponseIndex++;
      this.emit('transcription', response);
      return response;
    }

    // Return null by default (no transcription)
    return null;
  }

  async destroy(): Promise<void> {
    this._isInitialized = false;
    this._engineReady = false;
    this._processedChunks = 0;
    this.currentResponseIndex = 0;
    this.removeAllListeners();
  }

  isReady(): boolean {
    return this._engineReady && this._isInitialized;
  }

  getConfig(): EngineConfig {
    if (!this._config) {
      throw new Error('Mock: Engine is not initialized');
    }
    return { ...this._config };
  }

  getEngineType(): TranscriptionEngineType {
    return 'vosk';
  }

  getSupportedLanguages(): string[] {
    return ['en', 'fr', 'de', 'es'];
  }

  supportsRealTimeStreaming(): boolean {
    return true;
  }

  getRecommendedAudioConfig(): AudioStreamConfig {
    return {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      format: 'pcm',
      bufferSize: 1024
    };
  }

  // Test helper methods

  /**
   * Get the number of audio chunks processed
   */
  getProcessedChunkCount(): number {
    return this._processedChunks;
  }

  /**
   * Queue a transcription response to be returned on next processAudio call
   */
  queueTranscription(text: string, isPartial: boolean = false, confidence: number = 0.9): void {
    this.transcriptionResponses.push({
      text,
      source: 'microphone',
      confidence,
      timestamp: Date.now(),
      isPartial,
      engine: 'vosk'
    });
  }

  /**
   * Queue multiple transcriptions (simulating a sequence of partial + final results)
   */
  queueTranscriptionSequence(finalText: string, includePartials: boolean = true): void {
    if (includePartials) {
      const words = finalText.split(' ');
      for (let i = 1; i < words.length; i++) {
        this.queueTranscription(words.slice(0, i).join(' '), true, 0.5);
      }
    }
    this.queueTranscription(finalText, false, 0.9);
  }

  /**
   * Simulate a transcription event being emitted
   */
  simulateTranscription(event: TranscriptionEvent): void {
    this.emit('transcription', event);
  }

  /**
   * Simulate an error
   */
  simulateError(error: Error): void {
    this.emit('error', error);
  }

  /**
   * Reset the recognizer state (matches VoskTranscriptionEngine interface)
   */
  resetRecognizer(): void {
    this._lastPartialText = '';
    this.currentResponseIndex = 0;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this._isInitialized = false;
    this._engineReady = false;
    this._processedChunks = 0;
    this._lastPartialText = '';
    this.transcriptionResponses = [];
    this.currentResponseIndex = 0;
    this.shouldFailInitialize = false;
    this.shouldFailProcessing = false;
    this.initializeDelay = 0;
    this.processingDelay = 0;
    this.removeAllListeners();
  }
}

/**
 * Factory function to create a mock engine
 */
export function createMockTranscriptionEngine(): MockTranscriptionEngine {
  return new MockTranscriptionEngine();
}

/**
 * Create a mock engine with pre-configured responses
 */
export function createMockEngineWithResponses(responses: string[]): MockTranscriptionEngine {
  const engine = new MockTranscriptionEngine();
  responses.forEach(text => engine.queueTranscription(text, false, 0.9));
  return engine;
}
