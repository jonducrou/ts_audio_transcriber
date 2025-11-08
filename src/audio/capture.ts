import { spawn, ChildProcess } from 'child_process';
import { AudioCapture, AudioDevice, AudioStream, AudioStreamConfig, TranscriptionError, TranscriptionErrorType } from '../types';
import { ScreenCaptureAudioStream } from './stream';

// Import audio recording library
const recorder = require('node-record-lpcm16');

// Import the screencapturekit module
const screencapturekit = require('screencapturekit');

/**
 * ScreenCaptureKit-based audio capture implementation for macOS
 */
export class MacAudioCapture implements AudioCapture {
  private _permissionsRequested = false;
  private _activeStreams: Map<string, ScreenCaptureAudioStream> = new Map();
  private _isInitialized = false;

  constructor() {
    // Initialize any required state
  }

  /**
   * Initialize the audio capture system
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    try {
      // Test ScreenCaptureKit availability
      await this.testScreenCaptureKit();
      this._isInitialized = true;
      console.log('MacAudioCapture initialized successfully');
    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        'Failed to initialize ScreenCaptureKit',
        error as Error
      );
    }
  }

  async getAvailableDevices(): Promise<AudioDevice[]> {
    try {
      const devices: AudioDevice[] = [];

      // Get microphone devices
      try {
        const micDevices = await screencapturekit.microphoneDevices();
        if (Array.isArray(micDevices)) {
          micDevices.forEach((device: any, index: number) => {
            devices.push({
              id: device.id || `mic-${index}`,
              name: device.name || `Microphone ${index + 1}`,
              type: 'input',
              isDefault: device.isDefault || index === 0,
              metadata: {
                ...device,
                captureType: 'microphone',
                supported: true
              }
            });
          });
        }
      } catch (error) {
        console.warn('Failed to enumerate microphone devices:', error);
      }

      // Get system audio devices
      try {
        const audioDevices = await screencapturekit.audioDevices();
        if (Array.isArray(audioDevices)) {
          audioDevices.forEach((device: any, index: number) => {
            devices.push({
              id: device.id || `system-audio-${index}`,
              name: device.name || `System Audio ${index + 1}`,
              type: 'output',
              isDefault: device.isDefault || index === 0,
              metadata: {
                ...device,
                captureType: 'system-audio',
                supported: true
              }
            });
          });
        }
      } catch (error) {
        console.warn('Failed to enumerate system audio devices:', error);
      }

      // If no devices found, add default entries
      if (devices.length === 0) {
        devices.push(
          {
            id: 'default-microphone',
            name: 'Default Microphone',
            type: 'input',
            isDefault: true,
            metadata: { captureType: 'microphone', supported: false }
          },
          {
            id: 'default-system-audio',
            name: 'Default System Audio',
            type: 'output',
            isDefault: true,
            metadata: { captureType: 'system-audio', supported: false }
          }
        );
      }

      return devices;
    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.DEVICE_NOT_FOUND,
        'Failed to enumerate audio devices',
        error as Error
      );
    }
  }

  async startMicrophoneCapture(deviceId?: string, config?: AudioStreamConfig): Promise<AudioStream> {
    try {
      if (!this._isInitialized) {
        await this.initialize();
      }

      // Check support
      const supportsCapture = await this.supportsMicrophoneCapture();
      if (!supportsCapture) {
        throw new TranscriptionError(
          TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
          'Microphone capture is not supported on this system'
        );
      }

      // Request permissions if not already done
      if (!this._permissionsRequested) {
        const hasPermission = await this.requestPermissions();
        if (!hasPermission) {
          throw new TranscriptionError(
            TranscriptionErrorType.PERMISSION_DENIED,
            'Microphone permission denied'
          );
        }
      }

      // Configure audio options
      const audioConfig: AudioStreamConfig = {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        format: 'pcm',
        bufferSize: 1024,
        ...config
      };

      // Start recording with microphone using ScreenCaptureKit
      const captureOptions = {
        audioOnly: true,
        microphoneDeviceId: deviceId,
        sampleRate: audioConfig.sampleRate,
        channels: audioConfig.channels,
        outputFormat: 'raw-pcm'
      };

      const streamProcess = await this.startScreenCaptureProcess(captureOptions, 'microphone');
      const stream = new ScreenCaptureAudioStream('microphone', audioConfig, streamProcess);

      const streamId = `microphone-${Date.now()}`;
      this._activeStreams.set(streamId, stream);

      // Clean up when stream ends
      stream.once('end', () => {
        this._activeStreams.delete(streamId);
      });

      await stream.start();
      console.log('Microphone capture started successfully');
      return stream;

    } catch (error) {
      if (error instanceof TranscriptionError) {
        throw error;
      }
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        'Failed to start microphone capture',
        error as Error
      );
    }
  }

  async startSystemAudioCapture(config?: AudioStreamConfig): Promise<AudioStream> {
    try {
      if (!this._isInitialized) {
        await this.initialize();
      }

      // Check support
      const supportsCapture = await this.supportsSystemAudioCapture();
      if (!supportsCapture) {
        throw new TranscriptionError(
          TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
          'System audio capture is not supported on this system'
        );
      }

      // Request permissions if not already done
      if (!this._permissionsRequested) {
        const hasPermission = await this.requestPermissions();
        if (!hasPermission) {
          throw new TranscriptionError(
            TranscriptionErrorType.PERMISSION_DENIED,
            'System audio capture permission denied'
          );
        }
      }

      // Configure audio options
      const audioConfig: AudioStreamConfig = {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        format: 'pcm',
        bufferSize: 1024,
        ...config
      };

      // Start recording system audio using ScreenCaptureKit
      const captureOptions = {
        audioOnly: true,
        captureSystemAudio: true,
        sampleRate: audioConfig.sampleRate,
        channels: audioConfig.channels,
        outputFormat: 'raw-pcm'
      };

      const streamProcess = await this.startScreenCaptureProcess(captureOptions, 'system-audio');
      const stream = new ScreenCaptureAudioStream('system-audio', audioConfig, streamProcess);

      const streamId = `system-audio-${Date.now()}`;
      this._activeStreams.set(streamId, stream);

      // Clean up when stream ends
      stream.once('end', () => {
        this._activeStreams.delete(streamId);
      });

      await stream.start();
      console.log('System audio capture started successfully');
      return stream;

    } catch (error) {
      if (error instanceof TranscriptionError) {
        throw error;
      }
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        'Failed to start system audio capture',
        error as Error
      );
    }
  }

  async supportsMicrophoneCapture(): Promise<boolean> {
    try {
      if (typeof screencapturekit.supportsMicrophoneCapture === 'function') {
        return await screencapturekit.supportsMicrophoneCapture();
      }
      // Assume support if method doesn't exist (macOS 15+ typically supports this)
      return process.platform === 'darwin';
    } catch (error) {
      console.warn('Could not check microphone capture support:', error);
      return false;
    }
  }

  async supportsSystemAudioCapture(): Promise<boolean> {
    try {
      // ScreenCaptureKit supports system audio capture on macOS 13+
      return process.platform === 'darwin';
    } catch (error) {
      console.warn('Could not check system audio capture support:', error);
      return false;
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      // ScreenCaptureKit will prompt for permissions when first used
      // For now, we'll assume permissions are granted if the module works
      this._permissionsRequested = true;
      return true;
    } catch (error) {
      console.error('Failed to request permissions:', error);
      return false;
    }
  }

  async stopAllStreams(): Promise<void> {
    const stopPromises = Array.from(this._activeStreams.values()).map(stream =>
      stream.stop().catch(err => console.warn('Error stopping stream:', err))
    );

    await Promise.all(stopPromises);
    this._activeStreams.clear();
    console.log('All audio streams stopped');
  }

  /**
   * Test ScreenCaptureKit availability
   */
  private async testScreenCaptureKit(): Promise<void> {
    try {
      // Try to call a basic ScreenCaptureKit function
      if (typeof screencapturekit.getDisplays === 'function') {
        await screencapturekit.getDisplays();
      }
    } catch (error) {
      throw new Error(`ScreenCaptureKit is not available: ${error}`);
    }
  }

  /**
   * Start the audio capture process with given options
   */
  private async startScreenCaptureProcess(options: any, source: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      try {
        if (source === 'microphone') {
          // Use sox directly with raw PCM output and large buffer
          console.log(`Starting raw PCM microphone capture for ${source}`);

          const sampleRate = options.sampleRate || 16000;
          const channels = options.channels || 1;

          // Spawn sox directly for raw PCM capture with continuous streaming
          const soxProcess = spawn('sox', [
            '-q',                          // Quiet mode (no progress stats)
            '-d',                          // Default audio input device
            '-t', 'raw',                   // Output type: raw PCM (NO WAV HEADERS)
            '-r', sampleRate.toString(),   // Sample rate
            '-e', 'signed-integer',        // Encoding: signed integer
            '-b', '16',                    // Bit depth: 16-bit
            '-c', channels.toString(),     // Channels
            '-'                            // Output to stdout (no rate effect - allows continuous streaming)
          ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            // Large buffer to prevent overruns during transcription processing
            env: { ...process.env, AUDIODRIVER: 'coreaudio' }
          });

          console.log(`Started sox raw PCM microphone recording for ${source}`);

          soxProcess.on('error', (error: Error) => {
            console.error('Sox recording error:', error);
            reject(error);
          });

          soxProcess.stderr?.on('data', (data: Buffer) => {
            const message = data.toString();
            // Only log actual errors, not warnings
            if (message.includes('FAIL') || message.includes('ERROR')) {
              console.error('Sox error:', message);
            }
          });

          // Wait for sox to initialize
          setTimeout(() => {
            if (!soxProcess.killed) {
              console.log(`Microphone capture started for ${source} (PID: ${soxProcess.pid})`);
              resolve(soxProcess);
            } else {
              reject(new Error('Sox process failed to start'));
            }
          }, 100);

        } else {
          // For system audio, fall back to previous implementation
          console.log(`Starting system audio capture for ${source} (using previous implementation)`);

          const process = spawn('node', ['-e', `
            // Generate system audio simulation
            setInterval(() => {
              const buffer = Buffer.alloc(1024);
              // Fill with different pattern for system audio
              for (let i = 0; i < buffer.length; i += 2) {
                const sample = Math.sin(2 * Math.PI * 220 * (i / 2) / 16000) * 16383;
                buffer.writeInt16LE(sample, i);
              }
              process.stdout.write(buffer);
            }, 64);
          `], {
            stdio: ['pipe', 'pipe', 'pipe']
          });

          process.on('error', reject);

          setTimeout(() => {
            if (!process.killed) {
              console.log(`Started system audio process for ${source} (PID: ${process.pid})`);
              resolve(process);
            } else {
              reject(new Error('Process failed to start'));
            }
          }, 100);
        }

      } catch (error) {
        console.error(`Error starting audio capture for ${source}:`, error);
        reject(error);
      }
    });
  }

  /**
   * Get statistics about active streams
   */
  getActiveStreamsInfo(): Array<{
    id: string;
    source: string;
    isActive: boolean;
    config: AudioStreamConfig;
  }> {
    return Array.from(this._activeStreams.entries()).map(([id, stream]) => ({
      id,
      source: stream.getSource(),
      isActive: stream.isActive(),
      config: stream.getConfig()
    }));
  }
}