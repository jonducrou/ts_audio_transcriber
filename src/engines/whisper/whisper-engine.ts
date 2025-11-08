import * as fs from 'fs';
import * as path from 'path';
import { BaseTranscriptionEngine } from '../base/base-engine';
import {
  EngineConfig,
  TranscriptionEvent,
  AudioSource,
  TranscriptionEngineType,
  AudioStreamConfig,
  TranscriptionError,
  TranscriptionErrorType
} from '../../types';

// Import whisper-node with error handling
let whisper: any;
try {
  const whisperModule = require('whisper-node');
  // whisper-node exports as { default: function, whisper: object }
  // We need to use the .default export
  if (typeof whisperModule === 'object' && typeof whisperModule.default === 'function') {
    whisper = whisperModule.default;
    console.log('[WHISPER] whisper-node loaded successfully (using .default export)');
  } else if (typeof whisperModule === 'function') {
    whisper = whisperModule;
    console.log('[WHISPER] whisper-node loaded successfully (direct function)');
  } else {
    console.error('[WHISPER] whisper-node module structure unexpected:', Object.keys(whisperModule || {}));
    whisper = null;
  }
} catch (error) {
  console.error('[WHISPER] Failed to load whisper-node:', error);
  whisper = null;
}

/**
 * Whisper speech recognition engine implementation (offline)
 */
export class WhisperTranscriptionEngine extends BaseTranscriptionEngine {
  private whisperInstance?: any;
  private modelPath?: string;
  private audioBuffer = Buffer.alloc(0); // Single buffer for clean 5-second chunks
  private bufferStartTime = 0;
  private sampleRate = 16000; // 16kHz sample rate

  getEngineType(): TranscriptionEngineType {
    return 'whisper';
  }

  getSupportedLanguages(): string[] {
    // Whisper supports 99 languages
    return [
      'en', // English
      'zh', // Chinese
      'de', // German
      'es', // Spanish
      'ru', // Russian
      'ko', // Korean
      'fr', // French
      'ja', // Japanese
      'pt', // Portuguese
      'tr', // Turkish
      'pl', // Polish
      'ca', // Catalan
      'nl', // Dutch
      'ar', // Arabic
      'sv', // Swedish
      'it', // Italian
      'id', // Indonesian
      'hi', // Hindi
      'fi', // Finnish
      'vi', // Vietnamese
      'he', // Hebrew
      'uk', // Ukrainian
      'el', // Greek
      'ms', // Malay
      'cs', // Czech
      'ro', // Romanian
      'da', // Danish
      'hu', // Hungarian
      'ta', // Tamil
      'no', // Norwegian
      'th', // Thai
      'ur', // Urdu
      'hr', // Croatian
      'bg', // Bulgarian
      'lt', // Lithuanian
      'la', // Latin
      'mi', // Maori
      'ml', // Malayalam
      'cy', // Welsh
      'sk', // Slovak
      'te', // Telugu
      'fa', // Persian
      'lv', // Latvian
      'bn', // Bengali
      'sr', // Serbian
      'az', // Azerbaijani
      'sl', // Slovenian
      'kn', // Kannada
      'et', // Estonian
      'mk', // Macedonian
      'br', // Breton
      'eu', // Basque
      'is', // Icelandic
      'hy', // Armenian
      'ne', // Nepali
      'mn', // Mongolian
      'bs', // Bosnian
      'kk', // Kazakh
      'sq', // Albanian
      'sw', // Swahili
      'gl', // Galician
      'mr', // Marathi
      'pa', // Punjabi
      'si', // Sinhala
      'km', // Khmer
      'sn', // Shona
      'yo', // Yoruba
      'so', // Somali
      'af', // Afrikaans
      'oc', // Occitan
      'ka', // Georgian
      'be', // Belarusian
      'tg', // Tajik
      'sd', // Sindhi
      'gu', // Gujarati
      'am', // Amharic
      'yi', // Yiddish
      'lo', // Lao
      'uz', // Uzbek
      'fo', // Faroese
      'ht', // Haitian creole
      'ps', // Pashto
      'tk', // Turkmen
      'nn', // Nynorsk
      'mt', // Maltese
      'sa', // Sanskrit
      'lb', // Luxembourgish
      'my', // Myanmar
      'bo', // Tibetan
      'tl', // Tagalog
      'mg', // Malagasy
      'as', // Assamese
      'tt', // Tatar
      'haw', // Hawaiian
      'ln', // Lingala
      'ha', // Hausa
      'ba', // Bashkir
      'jw', // Javanese
      'su', // Sundanese
      'yue' // Cantonese
    ];
  }

  supportsRealTimeStreaming(): boolean {
    return true; // Near real-time with buffering
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

  protected async initializeEngine(config: EngineConfig): Promise<void> {
    try {
      // Check if whisper-node module loaded properly
      if (!whisper || typeof whisper !== 'function') {
        throw new TranscriptionError(
          TranscriptionErrorType.ENGINE_INITIALIZATION_FAILED,
          'Whisper engine failed to load. The whisper-node module may not be properly installed.',
          undefined,
          {
            modelPath: config.modelPath,
            language: config.language,
            whisperType: typeof whisper,
            solution: 'Try running: npm install whisper-node && cd node_modules/whisper-node && npm run postinstall'
          }
        );
      }

      console.log('[WHISPER] Whisper function ready, type:', typeof whisper);

      // Determine model path
      this.modelPath = await this.resolveModelPath(config);

      // Initialize Whisper with the model
      console.log(`Initializing Whisper with model: ${this.modelPath}`);

      // Check if whisper-node is properly installed
      try {
        // Store the whisper function and config for later use
        // The whisper-node API requires calling the function with audio path each time
        this.whisperInstance = {
          transcribe: async (audioPath: string) => {
            return whisper(audioPath, {
              modelPath: this.modelPath,
              language: config.language || 'en',
              verbose: false,
              removeWavFileAfterTranscription: true,
              withCuda: false,
              whisperOptions: {
                outputFormat: 'json',
                wordTimestamps: true,
                temperature: 0.0,  // Lower temperature for more consistent output
                speedUp: false,    // Disable speedup for better accuracy
                suppress_blank: false,  // Don't suppress blank outputs
                suppress_non_speech_tokens: false  // Keep non-speech tokens
              }
            });
          }
        };

        console.log(`Whisper engine initialized successfully with model: ${this.modelPath}`);

      } catch (whisperError: any) {
        // Handle whisper-node initialization problems
        if (whisperError.message && whisperError.message.includes('whisper.cpp not initialized')) {
          throw new TranscriptionError(
            TranscriptionErrorType.ENGINE_INITIALIZATION_FAILED,
            'Whisper native library not compiled. Please run: cd node_modules/whisper-node && npm run postinstall',
            whisperError,
            {
              modelPath: config.modelPath,
              language: config.language,
              solution: 'Try running: cd node_modules/whisper-node && npm run postinstall'
            }
          );
        }
        throw whisperError;
      }

    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.ENGINE_INITIALIZATION_FAILED,
        'Failed to initialize Whisper engine',
        error as Error,
        { modelPath: config.modelPath, language: config.language }
      );
    }
  }

  protected async processAudioData(
    audioData: Buffer,
    source: AudioSource,
    timestamp: number
  ): Promise<TranscriptionEvent | null> {
    console.log(`[WHISPER] processAudioData called: ${audioData.length} bytes from ${source}`);

    if (!this.whisperInstance || !this.isReady()) {
      console.log('[WHISPER] ERROR: Whisper instance not ready');
      throw new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Whisper instance is not ready'
      );
    }

    if (!this.validateAudioData(audioData)) {
      console.log('[WHISPER] ERROR: Invalid audio data');
      return null;
    }

    try {
      // Calculate audio duration (16-bit PCM @ 16kHz)
      const audioDurationMs = (audioData.length / 2 / this.sampleRate) * 1000;

      // For SessionPipeline (large complete buffers), process entire audio at once
      // For SnippetPipeline (streaming chunks), accumulate to 5-second chunks
      const isCompleteSession = audioDurationMs > 10000; // > 10 seconds indicates complete session

      if (isCompleteSession) {
        // SessionPipeline mode: Process entire buffer without chunking
        console.log(`[WHISPER] SessionPipeline mode: Processing complete ${audioDurationMs.toFixed(0)}ms audio (${audioData.length} bytes)`);
        const processingChunk = audioData;

        // Save audio to temporary file (Whisper requires file input)
        const tempAudioPath = await this.saveAudioToTempFile(processingChunk);

        try {
          // Transcribe with Whisper
          const result = await this.whisperInstance.transcribe(tempAudioPath);
          console.log(`[WHISPER] Raw result:`, JSON.stringify(result, null, 2));

          // Parse result
          const transcriptionText = this.extractText(result);
          const confidence = this.extractConfidence(result);

          if (!transcriptionText || transcriptionText.trim().length === 0) {
            console.log('[WHISPER] No transcription text found');
            return null;
          }

          console.log(`[WHISPER] Transcription: "${transcriptionText}" (confidence: ${confidence})`);

          return {
            text: transcriptionText.trim(),
            source,
            confidence,
            timestamp,
            isPartial: false, // Whisper provides complete results
            engine: this.getEngineType()
          };

        } finally {
          // Clean up temp file
          await this.cleanupTempFile(tempAudioPath);
        }
      } else {
        // SnippetPipeline mode: Accumulate into 5-second chunks
        // Initialize buffer start time if this is the first chunk
        if (this.bufferStartTime === 0) {
          this.bufferStartTime = timestamp;
        }

        // Accumulate audio into 5-second chunks
        this.audioBuffer = Buffer.concat([this.audioBuffer, audioData]);

        // Calculate buffer duration
        const bufferDurationMs = (this.audioBuffer.length / 2 / this.sampleRate) * 1000;
        const targetChunkMs = 5000; // 5 seconds

        // Process when we have 5 seconds of audio
        if (bufferDurationMs < targetChunkMs) {
          console.log(`[WHISPER] SnippetPipeline: Buffer ${this.audioBuffer.length} bytes (${bufferDurationMs.toFixed(0)}ms), waiting for ${targetChunkMs}ms`);
          return null; // Not ready to process yet
        }

        // Process 5-second chunk
        const processingChunk = Buffer.from(this.audioBuffer);
        console.log(`[WHISPER] SnippetPipeline: Processing 5-second chunk ${processingChunk.length} bytes (${bufferDurationMs.toFixed(0)}ms)`);

        // Reset buffer for next chunk
        this.audioBuffer = Buffer.alloc(0);
        this.bufferStartTime = timestamp;

        // Save audio to temporary file
        const tempAudioPath = await this.saveAudioToTempFile(processingChunk);

        try {
          // Transcribe with Whisper
          const result = await this.whisperInstance.transcribe(tempAudioPath);
          console.log(`[WHISPER] Raw result:`, JSON.stringify(result, null, 2));

          // Parse result
          const transcriptionText = this.extractText(result);
          const confidence = this.extractConfidence(result);

          if (!transcriptionText || transcriptionText.trim().length === 0) {
            console.log('[WHISPER] No transcription text found');
            return null;
          }

          console.log(`[WHISPER] Transcription: "${transcriptionText}" (confidence: ${confidence})`);

          return {
            text: transcriptionText.trim(),
            source,
            confidence,
            timestamp,
            isPartial: true, // Snippet mode produces partial results
            engine: this.getEngineType()
          };

        } finally {
          // Clean up temp file
          await this.cleanupTempFile(tempAudioPath);
        }
      }

    } catch (error) {
      console.log('[WHISPER] ERROR in processAudioData:', error);
      throw new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Error processing audio with Whisper',
        error as Error
      );
    }
  }

  protected async cleanupEngine(): Promise<void> {
    try {
      if (this.whisperInstance) {
        // Clean up any resources
        this.whisperInstance = undefined;
      }

      this.audioBuffer = Buffer.alloc(0);
      this.bufferStartTime = 0;

      console.log('Whisper engine cleaned up successfully');

    } catch (error) {
      console.warn('Error during Whisper cleanup:', error);
    }
  }

  /**
   * Resolve the model path based on configuration
   */
  private async resolveModelPath(config: EngineConfig): Promise<string> {
    // If explicit model path is provided, use it
    if (config.modelPath) {
      const pathsToTry = [
        config.modelPath,
        path.resolve(config.modelPath),
        path.join(process.cwd(), config.modelPath),
        path.join(__dirname, '../../..', config.modelPath),
        path.join((process as any).resourcesPath || process.cwd(), config.modelPath)
      ];

      for (const tryPath of pathsToTry) {
        console.log(`Trying Whisper model path: ${tryPath}`);
        if (await this.fileExists(tryPath)) {
          console.log(`Found Whisper model at: ${tryPath}`);
          return tryPath;
        }
      }

      throw new TranscriptionError(
        TranscriptionErrorType.MODEL_NOT_FOUND,
        `Whisper model not found at any of these paths: ${pathsToTry.join(', ')}`
      );
    }

    // Try to find model based on language or use default
    const language = config.language || 'en';

    const baseDirs = [
      process.cwd(),
      path.join(__dirname, '../../..'),
      (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'app') : process.cwd(),
      (process as any).resourcesPath || process.cwd()
    ];

    for (const baseDir of baseDirs) {
      const modelsDir = path.join(baseDir, 'models');
      console.log(`Checking Whisper models directory: ${modelsDir}`);

      if (await this.fileExists(modelsDir)) {
        // Common Whisper model naming patterns
        const modelPatterns = [
          'ggml-base.en.bin',
          'ggml-base.bin',
          'ggml-small.en.bin',
          'ggml-small.bin',
          'ggml-medium.en.bin',
          'ggml-medium.bin'
        ];

        for (const pattern of modelPatterns) {
          const modelPath = path.join(modelsDir, pattern);
          if (await this.fileExists(modelPath)) {
            console.log(`Found Whisper model at: ${modelPath}`);
            return modelPath;
          }
        }
      }
    }

    throw new TranscriptionError(
      TranscriptionErrorType.MODEL_NOT_FOUND,
      `No Whisper model found for language '${language}'. Please download a model and place it in the models directory.`,
      undefined,
      {
        language,
        searchedDirectories: baseDirs.map(dir => path.join(dir, 'models')),
        downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp'
      }
    );
  }

  /**
   * Save audio buffer to temporary file for Whisper processing
   */
  private async saveAudioToTempFile(audioBuffer: Buffer): Promise<string> {
    const tempDir = '/tmp/claude';
    const tempFileName = `whisper_audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`;
    const tempFilePath = path.join(tempDir, tempFileName);

    // Ensure temp directory exists
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Create a simple WAV file header
    const wavHeader = this.createWavHeader(audioBuffer.length);
    const wavFile = Buffer.concat([wavHeader, audioBuffer]);

    await fs.promises.writeFile(tempFilePath, wavFile);
    return tempFilePath;
  }

  /**
   * Create WAV file header for audio data
   */
  private createWavHeader(dataLength: number): Buffer {
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;

    const header = Buffer.alloc(44);
    let offset = 0;

    // RIFF header
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(36 + dataLength, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;

    // fmt chunk
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4; // chunk size
    header.writeUInt16LE(1, offset); offset += 2; // audio format (PCM)
    header.writeUInt16LE(channels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(byteRate, offset); offset += 4;
    header.writeUInt16LE(blockAlign, offset); offset += 2;
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data chunk
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataLength, offset);

    return header;
  }

  /**
   * Clean up temporary file
   */
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      console.warn(`Failed to clean up temp file ${filePath}:`, error);
    }
  }

  /**
   * Extract text from Whisper result
   */
  private extractText(result: any): string {
    if (typeof result === 'string') {
      return result;
    }

    if (result && result.text) {
      return result.text;
    }

    if (result && Array.isArray(result) && result.length > 0) {
      // whisper-node returns array of segments with 'speech' property
      return result.map(segment => segment.speech || segment.text || '').join(' ');
    }

    return '';
  }

  /**
   * Extract confidence from Whisper result
   */
  private extractConfidence(result: any): number {
    if (result && typeof result.confidence === 'number') {
      return Math.max(0.0, Math.min(1.0, result.confidence));
    }

    if (result && Array.isArray(result) && result.length > 0) {
      const avgConfidence = result.reduce((sum, segment) => {
        return sum + (segment.confidence || 0.8);
      }, 0) / result.length;
      return Math.max(0.0, Math.min(1.0, avgConfidence));
    }

    // Default confidence for Whisper (generally high quality)
    return 0.85;
  }


  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}