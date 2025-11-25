/**
 * Mock implementation of AudioStream for testing
 */

import { EventEmitter } from 'events';
import { AudioStream, AudioSource, AudioStreamConfig, DeviceConnectionState } from '../../src/types';
import { StreamEndContext } from '../../src/audio/stream';

export class MockAudioStream extends EventEmitter implements AudioStream {
  private _isActive = false;
  private _source: AudioSource;
  private _config: AudioStreamConfig;
  private _connectionState: DeviceConnectionState = 'connected';

  constructor(source: AudioSource = 'microphone', config?: Partial<AudioStreamConfig>) {
    super();
    this._source = source;
    this._config = {
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      format: 'pcm',
      bufferSize: 1024,
      ...config
    };
  }

  async start(): Promise<void> {
    if (this._isActive) {
      throw new Error(`${this._source} audio stream is already active`);
    }
    this._isActive = true;
    this._connectionState = 'connected';
  }

  async stop(): Promise<void> {
    if (!this._isActive) {
      return;
    }
    this._isActive = false;
    this._connectionState = 'disconnected';
    this.emit('end', { reason: 'process_exit', code: 0, signal: null });
  }

  isActive(): boolean {
    return this._isActive;
  }

  getSource(): AudioSource {
    return this._source;
  }

  getConfig(): AudioStreamConfig {
    return { ...this._config };
  }

  onData(callback: (data: Buffer, timestamp: number) => void): void {
    this.on('data', callback);
  }

  onError(callback: (error: Error) => void): void {
    this.on('error', callback);
  }

  onEnd(callback: (context?: StreamEndContext) => void): void {
    this.on('end', callback);
  }

  getConnectionState(): DeviceConnectionState {
    return this._connectionState;
  }

  // Test helper methods

  /**
   * Simulate receiving audio data
   */
  simulateData(data: Buffer, timestamp?: number): void {
    if (this._isActive) {
      this.emit('data', data, timestamp ?? Date.now());
    }
  }

  /**
   * Simulate an error occurring
   */
  simulateError(error: Error): void {
    this._connectionState = 'disconnected';
    this.emit('error', error);
  }

  /**
   * Simulate the stream ending with a specific context
   */
  simulateEnd(context: StreamEndContext): void {
    this._isActive = false;
    this._connectionState = 'disconnected';
    this.emit('end', context);
  }

  /**
   * Simulate a device disconnection
   */
  simulateDeviceDisconnect(): void {
    this._isActive = false;
    this._connectionState = 'disconnected';
    const error = new Error('Device not found');
    this.emit('error', error);
    this.emit('end', {
      reason: 'device_removed',
      code: 1,
      signal: null,
      error
    });
  }

  /**
   * Simulate a permission revocation
   */
  simulatePermissionRevoked(): void {
    this._isActive = false;
    this._connectionState = 'disconnected';
    const error = new Error('Permission denied');
    this.emit('error', error);
    this.emit('end', {
      reason: 'permission_revoked',
      code: 1,
      signal: null,
      error
    });
  }

  /**
   * Simulate a process crash
   */
  simulateCrash(code: number = 1): void {
    this._isActive = false;
    this._connectionState = 'disconnected';
    const error = new Error(`Process exited with code ${code}`);
    this.emit('error', error);
    this.emit('end', {
      reason: 'error',
      code,
      signal: null,
      error
    });
  }

  /**
   * Generate mock audio data (silence or noise)
   */
  static generateMockAudioData(durationMs: number, sampleRate: number = 16000): Buffer {
    const samples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(samples * 2); // 16-bit samples
    // Fill with silence (zeros)
    return buffer;
  }

  /**
   * Generate mock audio data with noise
   */
  static generateMockNoiseData(durationMs: number, sampleRate: number = 16000): Buffer {
    const samples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      // Generate random noise between -1000 and 1000 (quiet noise)
      const value = Math.floor(Math.random() * 2000) - 1000;
      buffer.writeInt16LE(value, i * 2);
    }
    return buffer;
  }
}

/**
 * Factory function to create a mock stream
 */
export function createMockAudioStream(
  source: AudioSource = 'microphone',
  config?: Partial<AudioStreamConfig>
): MockAudioStream {
  return new MockAudioStream(source, config);
}
