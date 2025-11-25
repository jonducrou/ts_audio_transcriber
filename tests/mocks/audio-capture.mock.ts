/**
 * Mock implementation of AudioCapture for testing
 */

import { AudioCapture, AudioDevice, AudioStream, AudioStreamConfig } from '../../src/types';
import { MockAudioStream } from './audio-stream.mock';

export class MockAudioCapture implements AudioCapture {
  private _isInitialized = false;
  private _permissionsGranted = true;
  private _activeStreams: Map<string, MockAudioStream> = new Map();
  private _supportsMicrophone = true;
  private _supportsSystemAudio = true;

  // Test control properties
  public shouldFailInitialize = false;
  public shouldFailMicrophoneCapture = false;
  public shouldFailSystemAudioCapture = false;
  public shouldDenyPermissions = false;
  public initializeDelay = 0;
  public captureStartDelay = 0;

  constructor() {}

  async initialize(): Promise<void> {
    if (this.initializeDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.initializeDelay));
    }

    if (this.shouldFailInitialize) {
      throw new Error('Mock: Failed to initialize audio capture');
    }

    this._isInitialized = true;
  }

  async getAvailableDevices(): Promise<AudioDevice[]> {
    return [
      {
        id: 'mock-microphone-1',
        name: 'Mock Microphone',
        type: 'input',
        isDefault: true,
        metadata: { captureType: 'microphone', supported: true }
      },
      {
        id: 'mock-system-audio-1',
        name: 'Mock System Audio',
        type: 'output',
        isDefault: true,
        metadata: { captureType: 'system-audio', supported: true }
      }
    ];
  }

  async startMicrophoneCapture(deviceId?: string, config?: AudioStreamConfig): Promise<AudioStream> {
    if (this.captureStartDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.captureStartDelay));
    }

    if (!this._isInitialized) {
      await this.initialize();
    }

    if (this.shouldFailMicrophoneCapture) {
      throw new Error('Mock: Failed to start microphone capture');
    }

    if (this.shouldDenyPermissions) {
      throw new Error('Mock: Microphone permission denied');
    }

    const stream = new MockAudioStream('microphone', config);
    const streamId = `microphone-${Date.now()}`;
    this._activeStreams.set(streamId, stream);

    stream.once('end', () => {
      this._activeStreams.delete(streamId);
    });

    await stream.start();
    return stream;
  }

  async startSystemAudioCapture(config?: AudioStreamConfig): Promise<AudioStream> {
    if (this.captureStartDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.captureStartDelay));
    }

    if (!this._isInitialized) {
      await this.initialize();
    }

    if (this.shouldFailSystemAudioCapture) {
      throw new Error('Mock: Failed to start system audio capture');
    }

    if (this.shouldDenyPermissions) {
      throw new Error('Mock: System audio permission denied');
    }

    const stream = new MockAudioStream('system-audio', config);
    const streamId = `system-audio-${Date.now()}`;
    this._activeStreams.set(streamId, stream);

    stream.once('end', () => {
      this._activeStreams.delete(streamId);
    });

    await stream.start();
    return stream;
  }

  async supportsMicrophoneCapture(): Promise<boolean> {
    return this._supportsMicrophone;
  }

  async supportsSystemAudioCapture(): Promise<boolean> {
    return this._supportsSystemAudio;
  }

  async requestPermissions(): Promise<boolean> {
    if (this.shouldDenyPermissions) {
      this._permissionsGranted = false;
      return false;
    }
    this._permissionsGranted = true;
    return true;
  }

  async stopAllStreams(): Promise<void> {
    const stopPromises = Array.from(this._activeStreams.values()).map(stream =>
      stream.stop().catch(() => {})
    );
    await Promise.all(stopPromises);
    this._activeStreams.clear();
  }

  // Test helper methods

  /**
   * Get a specific active stream by source type
   */
  getStream(source: 'microphone' | 'system-audio'): MockAudioStream | undefined {
    for (const stream of this._activeStreams.values()) {
      if (stream.getSource() === source) {
        return stream;
      }
    }
    return undefined;
  }

  /**
   * Get all active streams
   */
  getAllStreams(): MockAudioStream[] {
    return Array.from(this._activeStreams.values());
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Set microphone support
   */
  setMicrophoneSupport(supported: boolean): void {
    this._supportsMicrophone = supported;
  }

  /**
   * Set system audio support
   */
  setSystemAudioSupport(supported: boolean): void {
    this._supportsSystemAudio = supported;
  }

  /**
   * Simulate device disconnection for a specific stream
   */
  simulateDeviceDisconnect(source: 'microphone' | 'system-audio'): void {
    const stream = this.getStream(source);
    if (stream) {
      stream.simulateDeviceDisconnect();
    }
  }

  /**
   * Simulate permission revocation for a specific stream
   */
  simulatePermissionRevoked(source: 'microphone' | 'system-audio'): void {
    const stream = this.getStream(source);
    if (stream) {
      stream.simulatePermissionRevoked();
    }
  }

  /**
   * Simulate a crash for a specific stream
   */
  simulateCrash(source: 'microphone' | 'system-audio', code: number = 1): void {
    const stream = this.getStream(source);
    if (stream) {
      stream.simulateCrash(code);
    }
  }

  /**
   * Send mock audio data to a specific stream
   */
  sendAudioData(source: 'microphone' | 'system-audio', data: Buffer, timestamp?: number): void {
    const stream = this.getStream(source);
    if (stream) {
      stream.simulateData(data, timestamp);
    }
  }

  /**
   * Reset the mock to initial state
   */
  reset(): void {
    this._isInitialized = false;
    this._permissionsGranted = true;
    this._activeStreams.clear();
    this._supportsMicrophone = true;
    this._supportsSystemAudio = true;
    this.shouldFailInitialize = false;
    this.shouldFailMicrophoneCapture = false;
    this.shouldFailSystemAudioCapture = false;
    this.shouldDenyPermissions = false;
    this.initializeDelay = 0;
    this.captureStartDelay = 0;
  }
}

/**
 * Factory function to create a mock audio capture
 */
export function createMockAudioCapture(): MockAudioCapture {
  return new MockAudioCapture();
}
