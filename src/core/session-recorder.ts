import * as fs from 'fs';
import * as path from 'path';
import {
  RecordingConfig,
  RecordingMetadata,
  RecordingProgress,
  AudioStreamConfig,
  TranscriptionError,
  TranscriptionErrorType
} from '../types';

/**
 * SessionRecorder handles streaming audio recording to disk in WAV format.
 * Records audio continuously with minimal memory footprint for 1+ hour sessions.
 */
export class SessionRecorder {
  private _sessionId: string | null = null;
  private _audioFilePath: string | null = null;
  private _writeStream: fs.WriteStream | null = null;
  private _config: RecordingConfig;
  private _audioConfig: AudioStreamConfig;
  private _startTime: number = 0;
  private _bytesWritten: number = 0;
  private _dataChunkOffset: number = 0;
  private _isRecording: boolean = false;

  constructor(config: RecordingConfig, audioConfig: AudioStreamConfig) {
    this._config = config;
    this._audioConfig = {
      sampleRate: audioConfig.sampleRate || 16000,
      channels: audioConfig.channels || 1,
      bitDepth: audioConfig.bitDepth || 16,
      bufferSize: audioConfig.bufferSize || 1024,
      format: 'pcm'
    };
  }

  /**
   * Start a new recording session
   */
  async start(): Promise<RecordingMetadata> {
    if (this._isRecording) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Recording is already active'
      );
    }

    // Generate session ID
    this._sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this._startTime = Date.now();
    this._bytesWritten = 0;

    // IMPORTANT: Use absolute path for output directory
    // whisper-node changes CWD, so relative paths will fail
    const absoluteOutputDir = path.resolve(this._config.outputDir);

    // Ensure output directory exists
    await this.ensureDirectoryExists(absoluteOutputDir);

    // Create file path (use .partial.wav during recording for crash recovery)
    const filename = `${this._sessionId}.partial.wav`;
    this._audioFilePath = path.join(absoluteOutputDir, filename);

    // Create write stream
    this._writeStream = fs.createWriteStream(this._audioFilePath, {
      flags: 'w',
      highWaterMark: 16384 // 16KB buffer for efficient disk writes
    });

    // Write WAV header (will be updated on stop with correct sizes)
    await this.writeWavHeader();

    this._isRecording = true;

    console.log(`SessionRecorder: Started recording session ${this._sessionId}`);
    console.log(`SessionRecorder: Writing to ${this._audioFilePath}`);

    return this.getMetadata();
  }

  /**
   * Write audio chunk to the recording
   */
  writeChunk(audioData: Buffer): void {
    if (!this._isRecording || !this._writeStream) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Recording is not active'
      );
    }

    // Check duration limit
    if (this._config.maxDuration) {
      const durationSeconds = (Date.now() - this._startTime) / 1000;
      if (durationSeconds > this._config.maxDuration) {
        console.warn(`SessionRecorder: Maximum duration ${this._config.maxDuration}s exceeded, stopping recording`);
        this.stop().catch(err => console.error('Error stopping recording:', err));
        return;
      }
    }

    // Write PCM data
    this._writeStream.write(audioData);
    this._bytesWritten += audioData.length;
  }

  /**
   * Stop recording and finalize WAV file
   */
  async stop(): Promise<RecordingMetadata> {
    if (!this._isRecording) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Recording is not active'
      );
    }

    return new Promise((resolve, reject) => {
      if (!this._writeStream || !this._audioFilePath || !this._sessionId) {
        reject(new TranscriptionError(
          TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
          'Recording stream not initialized'
        ));
        return;
      }

      const tempPath = this._audioFilePath;
      const finalPath = tempPath.replace('.partial.wav', '.wav');

      // Close write stream
      this._writeStream.end(async () => {
        try {
          // Update WAV header with correct file size
          await this.updateWavHeader(tempPath);

          // Rename from .partial.wav to .wav (indicates successful completion)
          await fs.promises.rename(tempPath, finalPath);

          this._audioFilePath = finalPath;
          this._isRecording = false;

          const metadata = this.getMetadata();
          console.log(`SessionRecorder: Stopped recording session ${this._sessionId}`);
          console.log(`SessionRecorder: Final file: ${finalPath} (${this._bytesWritten} bytes)`);

          resolve(metadata);
        } catch (error) {
          reject(new TranscriptionError(
            TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
            'Failed to finalize recording',
            error as Error
          ));
        }
      });
    });
  }

  /**
   * Get current recording metadata
   */
  getMetadata(): RecordingMetadata {
    if (!this._sessionId || !this._audioFilePath) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'No active recording session'
      );
    }

    const duration = Date.now() - this._startTime;

    return {
      sessionId: this._sessionId,
      audioFilePath: this._audioFilePath,
      duration,
      fileSize: this._bytesWritten + 44, // PCM data + WAV header
      sampleRate: this._audioConfig.sampleRate!,
      channels: this._audioConfig.channels!,
      startTime: this._startTime,
      endTime: this._isRecording ? undefined : Date.now()
    };
  }

  /**
   * Get current recording progress
   */
  getProgress(): RecordingProgress {
    if (!this._sessionId) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'No active recording session'
      );
    }

    return {
      sessionId: this._sessionId,
      duration: Date.now() - this._startTime,
      fileSize: this._bytesWritten + 44
    };
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Check if recording is active
   */
  isRecording(): boolean {
    return this._isRecording;
  }

  /**
   * Delete recording file (for cleanup)
   */
  async deleteRecording(): Promise<void> {
    if (this._isRecording) {
      throw new TranscriptionError(
        TranscriptionErrorType.INVALID_CONFIGURATION,
        'Cannot delete active recording'
      );
    }

    if (!this._audioFilePath) {
      return; // Nothing to delete
    }

    try {
      if (fs.existsSync(this._audioFilePath)) {
        await fs.promises.unlink(this._audioFilePath);
        console.log(`SessionRecorder: Deleted recording ${this._audioFilePath}`);
      }
    } catch (error) {
      console.warn(`SessionRecorder: Failed to delete recording ${this._audioFilePath}:`, error);
    }
  }

  /**
   * Scan for partial recordings (crash recovery)
   */
  static async scanForPartialRecordings(outputDir: string): Promise<string[]> {
    try {
      if (!fs.existsSync(outputDir)) {
        return [];
      }

      const files = await fs.promises.readdir(outputDir);
      const partialFiles = files.filter(f => f.endsWith('.partial.wav'));

      return partialFiles.map(f => path.join(outputDir, f));
    } catch (error) {
      console.warn('SessionRecorder: Failed to scan for partial recordings:', error);
      return [];
    }
  }

  /**
   * Write WAV header to file
   */
  private async writeWavHeader(): Promise<void> {
    if (!this._writeStream) {
      throw new Error('Write stream not initialized');
    }

    const sampleRate = this._audioConfig.sampleRate!;
    const channels = this._audioConfig.channels!;
    const bitDepth = this._audioConfig.bitDepth!;
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);

    // WAV header (44 bytes)
    const header = Buffer.alloc(44);

    // RIFF chunk descriptor
    header.write('RIFF', 0);
    header.writeUInt32LE(0, 4); // File size - 8 (will update on stop)
    header.write('WAVE', 8);

    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    header.writeUInt16LE(channels, 22); // NumChannels
    header.writeUInt32LE(sampleRate, 24); // SampleRate
    header.writeUInt32LE(byteRate, 28); // ByteRate
    header.writeUInt16LE(blockAlign, 32); // BlockAlign
    header.writeUInt16LE(bitDepth, 34); // BitsPerSample

    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(0, 40); // Subchunk2Size (will update on stop)

    this._writeStream.write(header);
    this._dataChunkOffset = 40; // Offset to data size field
  }

  /**
   * Update WAV header with correct file sizes
   */
  private async updateWavHeader(filePath: string): Promise<void> {
    const fd = await fs.promises.open(filePath, 'r+');

    try {
      // Update file size (at offset 4)
      const fileSize = this._bytesWritten + 36; // data + header - 8
      const fileSizeBuffer = Buffer.alloc(4);
      fileSizeBuffer.writeUInt32LE(fileSize, 0);
      await fd.write(fileSizeBuffer, 0, 4, 4);

      // Update data chunk size (at offset 40)
      const dataSizeBuffer = Buffer.alloc(4);
      dataSizeBuffer.writeUInt32LE(this._bytesWritten, 0);
      await fd.write(dataSizeBuffer, 0, 4, 40);
    } finally {
      await fd.close();
    }
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectoryExists(dir: string): Promise<void> {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.AUDIO_CAPTURE_FAILED,
        `Failed to create recording directory: ${dir}`,
        error as Error
      );
    }
  }
}
