import { spawn, ChildProcess } from 'child_process';
import { EventEmitter, PassThrough } from 'stream';
import { AudioCapture, AudioDevice, AudioStream, AudioStreamConfig, TranscriptionError, TranscriptionErrorType } from '../types';
import { ScreenCaptureAudioStream } from './stream';

// Import audio recording library
const recorder = require('node-record-lpcm16');

// Lazy-load screencapturekit only when needed
// This allows microphone-only usage without requiring screencapturekit
let screencapturekitModule: any = null;

async function getScreenCaptureKit(): Promise<any> {
  if (!screencapturekitModule) {
    try {
      screencapturekitModule = require('screencapturekit');
      console.log('[AudioCapture] ScreenCaptureKit loaded successfully');
    } catch (error) {
      console.warn('[AudioCapture] Failed to load ScreenCaptureKit:', error);
      throw new Error('ScreenCaptureKit is not available. System audio capture requires screencapturekit package.');
    }
  }
  return screencapturekitModule;
}

// Lazy-load macos-system-audio-recorder only when needed
// This allows microphone-only usage without requiring system audio recorder
let systemAudioRecorderModule: any = null;

async function getSystemAudioRecorder(): Promise<any> {
  if (!systemAudioRecorderModule) {
    try {
      systemAudioRecorderModule = require('macos-system-audio-recorder');
      console.log('[AudioCapture] macos-system-audio-recorder loaded successfully');
    } catch (error) {
      console.warn('[AudioCapture] Failed to load macos-system-audio-recorder:', error);
      throw new Error('macos-system-audio-recorder is not available. System audio capture requires macos-system-audio-recorder package.');
    }
  }
  return systemAudioRecorderModule;
}

/**
 * ScreenCaptureKit-based audio capture implementation for macOS
 */
export class MacAudioCapture implements AudioCapture {
  private _permissionsRequested = false;
  private _activeStreams: Map<string, ScreenCaptureAudioStream> = new Map();
  private _isInitialized = false;
  private _screenCaptureKitLoaded = false;
  private _systemAudioRecorderLoaded = false;

  constructor() {
    // Initialize any required state
  }

  /**
   * Initialize the audio capture system
   * For microphone-only mode, this will succeed without ScreenCaptureKit
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    try {
      // ScreenCaptureKit is optional for microphone-only mode
      // It will be lazy-loaded only when system audio capture is requested
      this._isInitialized = true;
      console.log('MacAudioCapture initialized successfully');
    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        'Failed to initialize audio capture',
        error as Error
      );
    }
  }

  async getAvailableDevices(): Promise<AudioDevice[]> {
    try {
      const devices: AudioDevice[] = [];

      // Try to get devices using ScreenCaptureKit if available
      try {
        const sck = await getScreenCaptureKit();

        // Get microphone devices
        try {
          const micDevices = await sck.microphoneDevices();
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
          const audioDevices = await sck.audioDevices();
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
      } catch (error) {
        console.warn('ScreenCaptureKit not available for device enumeration:', error);
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

      // Lazy-load macos-system-audio-recorder for system audio (required)
      if (!this._systemAudioRecorderLoaded) {
        try {
          await getSystemAudioRecorder();
          this._systemAudioRecorderLoaded = true;
        } catch (error) {
          throw new TranscriptionError(
            TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
            'System audio capture requires macos-system-audio-recorder which is not available',
            error as Error
          );
        }
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

      // Start recording system audio using macos-system-audio-recorder
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
      // For microphone-only mode (using sox), we don't need ScreenCaptureKit
      // Sox works on any macOS system
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
          // System audio capture using macos-system-audio-recorder
          console.log(`Starting real system audio capture for ${source}`);

          getSystemAudioRecorder().then((SystemAudioRecorderModule) => {
            try {
              const { SystemAudioRecorder } = SystemAudioRecorderModule;
              const sysAudioRecorder = new SystemAudioRecorder();

              console.log('Initializing system audio recorder...');
              try {
                sysAudioRecorder.start();
              } catch (startError: any) {
                // Handle permission errors with clear messages
                const errorMessage = startError?.message || String(startError);

                if (errorMessage.includes('permission') || errorMessage.includes('denied') || errorMessage.includes('authorized')) {
                  const permissionError = new Error(
                    'Screen Recording permission is required for system audio capture.\n' +
                    'Please grant permission:\n' +
                    '1. Open System Settings > Privacy & Security > Screen Recording\n' +
                    '2. Enable permission for Terminal (or your app)\n' +
                    '3. Restart your application and try again'
                  );
                  reject(permissionError);
                  return;
                } else if (errorMessage.includes('audio') || errorMessage.includes('device')) {
                  const deviceError = new Error(
                    `System audio device error: ${errorMessage}\n` +
                    'Please ensure:\n' +
                    '- Audio output is enabled on your system\n' +
                    '- No other application is exclusively using the audio device'
                  );
                  reject(deviceError);
                  return;
                } else {
                  reject(new Error(`Failed to start system audio recorder: ${errorMessage}`));
                  return;
                }
              }

              // Get audio format details
              sysAudioRecorder.getAudioDetails().then((audioDetails: any) => {
                console.log('System audio format:', audioDetails);
                console.log(`  Sample rate: ${audioDetails.sampleRate} Hz`);
                console.log(`  Channels: ${audioDetails.channels}`);
                console.log(`  Bits per channel: ${audioDetails.bitsPerChannel}`);
              }).catch((err: Error) => {
                console.warn('Could not retrieve audio details:', err.message);
              });

              // Get the PCM audio stream
              const audioStream = sysAudioRecorder.getStream();

              // Create a ChildProcess-compatible wrapper
              // This allows seamless integration with existing ScreenCaptureAudioStream
              const pseudoProcess = new EventEmitter() as any;
              pseudoProcess.stdout = audioStream;
              pseudoProcess.stderr = new PassThrough();
              pseudoProcess.stdin = new PassThrough();
              pseudoProcess.pid = Date.now();
              pseudoProcess.killed = false;
              pseudoProcess.exitCode = null;

              // Implement kill method
              pseudoProcess.kill = (signal?: string) => {
                if (!pseudoProcess.killed) {
                  console.log(`Stopping system audio recorder (signal: ${signal || 'SIGTERM'})`);
                  try {
                    sysAudioRecorder.stop();
                    pseudoProcess.killed = true;
                    pseudoProcess.exitCode = 0;
                    pseudoProcess.emit('exit', 0, signal || 'SIGTERM');
                  } catch (error) {
                    console.error('Error stopping system audio recorder:', error);
                  }
                }
                return true;
              };

              // Handle stream errors
              audioStream.on('error', (error: Error) => {
                console.error('System audio stream error:', error);
                pseudoProcess.emit('error', error);
              });

              audioStream.on('end', () => {
                console.log('System audio stream ended');
                if (!pseudoProcess.killed) {
                  pseudoProcess.killed = true;
                  pseudoProcess.exitCode = 0;
                  pseudoProcess.emit('exit', 0, null);
                }
              });

              // Wait a moment for the recorder to initialize
              setTimeout(() => {
                if (!pseudoProcess.killed) {
                  console.log(`System audio capture started for ${source} (PID: ${pseudoProcess.pid})`);
                  resolve(pseudoProcess as ChildProcess);
                } else {
                  reject(new Error('System audio recorder failed to start'));
                }
              }, 100);

            } catch (error) {
              console.error('Error initializing system audio recorder:', error);
              reject(error);
            }
          }).catch((error: Error) => {
            console.error('Failed to load system audio recorder module:', error);
            reject(new Error(`System audio capture requires macos-system-audio-recorder package: ${error.message}`));
          });
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