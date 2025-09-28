import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { AudioStream, AudioSource, AudioStreamConfig } from '../types';

/**
 * Implementation of AudioStream for captured audio data from ScreenCaptureKit
 */
export class ScreenCaptureAudioStream extends EventEmitter implements AudioStream {
  private _isActive = false;
  private _source: AudioSource;
  private _config: AudioStreamConfig;
  private _captureProcess?: ChildProcess;
  private _dataCallback?: (data: Buffer, timestamp: number) => void;
  private _errorCallback?: (error: Error) => void;
  private _endCallback?: () => void;

  constructor(source: AudioSource, config: AudioStreamConfig, captureProcess?: ChildProcess) {
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
    this._captureProcess = captureProcess;

    if (this._captureProcess) {
      this.setupProcessHandlers();
    }
  }

  private setupProcessHandlers(): void {
    if (!this._captureProcess) return;

    // Handle stdout data (raw audio)
    this._captureProcess.stdout?.on('data', (data: Buffer) => {
      if (this._isActive) {
        const timestamp = Date.now();

        if (this._dataCallback) {
          this._dataCallback(data, timestamp);
        }
        this.emit('data', data, timestamp);
      }
    });

    // Handle stderr for errors and status messages
    this._captureProcess.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();

      // Filter out normal status messages from ScreenCaptureKit
      if (message.includes('ERROR') || message.includes('FATAL')) {
        const error = new Error(`Audio capture error: ${message}`);
        if (this._errorCallback) {
          this._errorCallback(error);
        }
        this.emit('error', error);
      } else {
        // Log other messages as debug info
        console.debug(`[${this._source}] ${message}`);
      }
    });

    // Handle process exit
    this._captureProcess.on('exit', (code: number | null, signal: string | null) => {
      this._isActive = false;

      if (code !== 0 && code !== null) {
        const error = new Error(`Audio capture process exited with code ${code}`);
        if (this._errorCallback) {
          this._errorCallback(error);
        }
        this.emit('error', error);
      } else if (signal) {
        console.log(`Audio capture process terminated with signal: ${signal}`);
      }

      if (this._endCallback) {
        this._endCallback();
      }
      this.emit('end');
    });

    this._captureProcess.on('error', (error: Error) => {
      this._isActive = false;

      if (this._errorCallback) {
        this._errorCallback(error);
      }
      this.emit('error', error);
    });
  }

  async start(): Promise<void> {
    if (this._isActive) {
      throw new Error(`${this._source} audio stream is already active`);
    }

    if (!this._captureProcess) {
      throw new Error('No capture process available for audio stream');
    }

    this._isActive = true;
    console.log(`Started ${this._source} audio stream`);
  }

  async stop(): Promise<void> {
    if (!this._isActive) {
      return;
    }

    this._isActive = false;

    if (this._captureProcess && !this._captureProcess.killed) {
      try {
        // Gracefully terminate the process
        this._captureProcess.kill('SIGTERM');

        // Wait a bit for graceful shutdown, then force kill if needed
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (this._captureProcess && !this._captureProcess.killed) {
              console.warn(`Force killing ${this._source} capture process`);
              this._captureProcess.kill('SIGKILL');
            }
            resolve();
          }, 3000);

          if (this._captureProcess) {
            this._captureProcess.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          }
        });
      } catch (error) {
        console.warn(`Error stopping ${this._source} capture process:`, error);
      }
    }

    this.removeAllListeners();
    console.log(`Stopped ${this._source} audio stream`);
  }

  isActive(): boolean {
    return this._isActive && !!this._captureProcess && !this._captureProcess.killed;
  }

  getSource(): AudioSource {
    return this._source;
  }

  getConfig(): AudioStreamConfig {
    return { ...this._config };
  }

  onData(callback: (data: Buffer, timestamp: number) => void): void {
    this._dataCallback = callback;
    this.on('data', callback);
  }

  onError(callback: (error: Error) => void): void {
    this._errorCallback = callback;
    this.on('error', callback);
  }

  onEnd(callback: () => void): void {
    this._endCallback = callback;
    this.on('end', callback);
  }

  removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event);
    this._dataCallback = undefined;
    this._errorCallback = undefined;
    this._endCallback = undefined;
    return this;
  }

  /**
   * Get statistics about the audio stream
   */
  getStatistics(): {
    isActive: boolean;
    source: AudioSource;
    config: AudioStreamConfig;
    processId?: number;
  } {
    return {
      isActive: this._isActive,
      source: this._source,
      config: this.getConfig(),
      processId: this._captureProcess?.pid ?? undefined
    };
  }

  /**
   * Set new capture process (useful for reconnection)
   */
  setCaptureProcess(process: ChildProcess): void {
    if (this._isActive) {
      throw new Error('Cannot change capture process while stream is active');
    }

    this._captureProcess = process;
    this.setupProcessHandlers();
  }
}