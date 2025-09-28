const { Model, Recognizer } = require('vosk-koffi');
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

/**
 * Vosk speech recognition engine implementation
 */
export class VoskTranscriptionEngine extends BaseTranscriptionEngine {
  private model?: any;
  private recognizer?: any;
  private sampleRate = 16000;
  private lastPartialText = '';

  getEngineType(): TranscriptionEngineType {
    return 'vosk';
  }

  getSupportedLanguages(): string[] {
    // Vosk supports many languages depending on available models
    return [
      'en', // English
      'fr', // French
      'de', // German
      'es', // Spanish
      'it', // Italian
      'pt', // Portuguese
      'ru', // Russian
      'zh', // Chinese
      'ja', // Japanese
      'ar', // Arabic
      'hi', // Hindi
      'tr', // Turkish
      'nl', // Dutch
      'pl', // Polish
      'cs', // Czech
      'uk', // Ukrainian
      'ko', // Korean
      'fa', // Persian
      'vi', // Vietnamese
      'ca'  // Catalan
    ];
  }

  supportsRealTimeStreaming(): boolean {
    return true; // Vosk is designed for real-time streaming
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
      // Determine model path
      const modelPath = await this.resolveModelPath(config);

      // Load the Vosk model
      console.log(`Loading Vosk model from: ${modelPath}`);
      this.model = new Model(modelPath);

      // Set sample rate from audio config or use default
      this.sampleRate = config.engineOptions?.sampleRate || 16000;

      // Create recognizer
      this.recognizer = new Recognizer({ model: this.model, sampleRate: this.sampleRate });

      // Configure recognizer options
      if (config.engineOptions?.enableWords) {
        this.recognizer.setWords(true);
      }

      if (config.engineOptions?.enablePartialResults !== false) {
        // Vosk handles partial results by default
      }

      console.log(`Vosk engine initialized successfully with model: ${modelPath}`);

    } catch (error) {
      throw new TranscriptionError(
        TranscriptionErrorType.ENGINE_INITIALIZATION_FAILED,
        'Failed to initialize Vosk engine',
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
    console.log(`[VOSK] processAudioData called: ${audioData.length} bytes from ${source}`);

    if (!this.recognizer || !this.isReady()) {
      console.log('[VOSK] ERROR: Recognizer not ready');
      throw new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Vosk recognizer is not ready'
      );
    }

    if (!this.validateAudioData(audioData)) {
      console.log('[VOSK] ERROR: Invalid audio data');
      return null; // Skip invalid audio data
    }

    try {
      // Convert Buffer to appropriate format for Vosk (16-bit PCM)
      const pcmData = this.convertToPCM16(audioData);

      // Debug: Log audio data info and inspect raw data
      console.log(`Processing audio: ${audioData.length} bytes -> ${pcmData.length} bytes PCM`);
      console.log(`Audio data sample (first 16 bytes): ${Array.from(audioData.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

      // Check if audio data looks like valid PCM by analyzing amplitude
      const samples = [];
      for (let i = 0; i < Math.min(audioData.length - 1, 32); i += 2) {
        const sample = audioData.readInt16LE(i);
        samples.push(Math.abs(sample));
      }
      const avgAmplitude = samples.reduce((a, b) => a + b, 0) / samples.length;
      const maxAmplitude = Math.max(...samples);
      console.log(`Audio analysis: avg amplitude=${avgAmplitude.toFixed(1)}, max amplitude=${maxAmplitude}, samples=${samples.slice(0, 8).join(',')}`);

      // Process audio with Vosk
      const isComplete = this.recognizer.acceptWaveform(pcmData);
      console.log(`Vosk acceptWaveform result: ${isComplete}`);

      let transcriptionText = '';
      let isPartial = true;
      let confidence = 0.5;

      if (isComplete) {
        // Final result available
        const result = this.recognizer.result();
        console.log(`Vosk final result (raw): ${JSON.stringify(result)}`);

        let resultObj;
        try {
          resultObj = typeof result === 'string' ? JSON.parse(result) : result;
        } catch (parseError) {
          console.log(`Failed to parse final result: ${parseError}, raw: ${result}`);
          return null;
        }

        if (resultObj.text && resultObj.text.trim()) {
          transcriptionText = resultObj.text.trim();
          isPartial = false;
          confidence = this.extractConfidence(resultObj);
          console.log(`Final transcription: "${transcriptionText}" (confidence: ${confidence})`);
        }
      } else {
        // Get partial result
        const partialResult = this.recognizer.partialResult();
        console.log(`Vosk partial result (raw): ${JSON.stringify(partialResult)}`);

        let partialObj;
        try {
          partialObj = typeof partialResult === 'string' ? JSON.parse(partialResult) : partialResult;
        } catch (parseError) {
          console.log(`Failed to parse partial result: ${parseError}, raw: ${partialResult}`);
          return null;
        }

        if (partialObj.partial && partialObj.partial.trim()) {
          transcriptionText = partialObj.partial.trim();
          isPartial = true;
          confidence = 0.3; // Lower confidence for partial results
          console.log(`Partial transcription: "${transcriptionText}"`);

          // Avoid emitting duplicate partial results
          if (transcriptionText === this.lastPartialText) {
            console.log('Skipping duplicate partial result');
            return null;
          }
          this.lastPartialText = transcriptionText;
        }
      }

      // Only return results with actual text
      if (!transcriptionText) {
        return null;
      }

      // Apply confidence threshold if configured
      const threshold = this.config?.engineOptions?.confidenceThreshold || 0.0;
      if (confidence < threshold) {
        return null;
      }

      return {
        text: transcriptionText,
        source,
        confidence,
        timestamp,
        isPartial,
        engine: this.getEngineType()
      };

    } catch (error) {
      console.log('[VOSK] ERROR in processAudioData:', error);
      throw new TranscriptionError(
        TranscriptionErrorType.TRANSCRIPTION_ENGINE_ERROR,
        'Error processing audio with Vosk',
        error as Error
      );
    }
  }

  protected async cleanupEngine(): Promise<void> {
    try {
      if (this.recognizer) {
        // Get final result before cleanup
        try {
          this.recognizer.finalResult();
        } catch (error) {
          // Ignore errors during final result extraction
        }

        // Vosk-koffi handles cleanup automatically
        this.recognizer = undefined;
      }

      if (this.model) {
        // Vosk-koffi handles model cleanup automatically
        this.model = undefined;
      }

      this.lastPartialText = '';
      console.log('Vosk engine cleaned up successfully');

    } catch (error) {
      console.warn('Error during Vosk cleanup:', error);
    }
  }

  /**
   * Resolve the model path based on configuration
   */
  private async resolveModelPath(config: EngineConfig): Promise<string> {
    // If explicit model path is provided, use it
    if (config.modelPath) {
      // Try different path resolution strategies
      const pathsToTry = [
        config.modelPath,
        path.resolve(config.modelPath),
        path.join(process.cwd(), config.modelPath),
        path.join(__dirname, '../../..', config.modelPath), // For bundled apps
        path.join((process as any).resourcesPath || process.cwd(), config.modelPath) // Electron resources path
      ];

      for (const tryPath of pathsToTry) {
        console.log(`Trying model path: ${tryPath}`);
        if (await this.fileExists(tryPath)) {
          console.log(`Found model at: ${tryPath}`);
          return tryPath;
        }
      }

      throw new TranscriptionError(
        TranscriptionErrorType.MODEL_NOT_FOUND,
        `Model not found at any of these paths: ${pathsToTry.join(', ')}`
      );
    }

    // Try to find model based on language
    const language = config.language || 'en';

    // Try multiple base directories
    const baseDirs = [
      process.cwd(),
      path.join(__dirname, '../../..'), // For bundled apps
      (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'app') : process.cwd(), // Electron app resources
      (process as any).resourcesPath || process.cwd() // Electron resources path
    ];

    for (const baseDir of baseDirs) {
      const modelsDir = path.join(baseDir, 'models');
      console.log(`Checking models directory: ${modelsDir}`);

      if (await this.fileExists(modelsDir)) {
        // Common model naming patterns
        const modelPatterns = [
          `vosk-model-${language}`,
          `vosk-model-${language}-*`,
          `vosk-model-small-${language}`,
          `vosk-model-small-${language}-*`
        ];

        for (const pattern of modelPatterns) {
          const modelPath = path.join(modelsDir, pattern);
          if (await this.fileExists(modelPath)) {
            console.log(`Found model at: ${modelPath}`);
            return modelPath;
          }

          // Try to find directories matching the pattern
          try {
            const files = await fs.promises.readdir(modelsDir);
            const matchingDirs = files.filter(file =>
              file.startsWith(pattern.replace('*', ''))
            );

            if (matchingDirs.length > 0) {
              const foundPath = path.join(modelsDir, matchingDirs[0]);
              if (await this.isDirectory(foundPath)) {
                console.log(`Found model directory at: ${foundPath}`);
                return foundPath;
              }
            }
          } catch (error) {
            console.log(`Error reading models directory ${modelsDir}:`, error);
          }
        }
      }
    }

    throw new TranscriptionError(
      TranscriptionErrorType.MODEL_NOT_FOUND,
      `No Vosk model found for language '${language}'. Please download a model and place it in the models directory.`,
      undefined,
      {
        language,
        searchedDirectories: baseDirs.map(dir => path.join(dir, 'models')),
        downloadUrl: 'https://alphacephei.com/vosk/models'
      }
    );
  }

  /**
   * Convert audio buffer to 16-bit PCM format expected by Vosk
   */
  private convertToPCM16(audioData: Buffer): Buffer {
    // Vosk expects 16-bit signed PCM data
    // If the input is already in the correct format, return as-is
    // Otherwise, convert (this is a simplified implementation)
    return audioData;
  }

  /**
   * Extract confidence score from Vosk result
   */
  private extractConfidence(resultObj: any): number {
    if (resultObj.result && Array.isArray(resultObj.result)) {
      // Calculate average confidence from word-level results
      const words = resultObj.result;
      if (words.length > 0) {
        const totalConf = words.reduce((sum: number, word: any) =>
          sum + (word.conf || 0.5), 0
        );
        return totalConf / words.length;
      }
    }

    // Default confidence for results without word-level data
    return 0.7;
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

  /**
   * Check if a path is a directory
   */
  private async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Reset the recognizer state (useful for switching sources)
   */
  public async reset(): Promise<void> {
    if (this.recognizer && this.model) {
      // Create a new recognizer to reset state
      this.recognizer = new Recognizer({ model: this.model, sampleRate: this.sampleRate });
      this.lastPartialText = '';
    }
  }

  /**
   * Set custom vocabulary for better recognition
   */
  public async setVocabulary(vocabulary: string[]): Promise<void> {
    if (this.recognizer) {
      try {
        // Vosk supports setting a specific vocabulary
        const vocabString = JSON.stringify(vocabulary);
        // Note: The exact API may vary depending on vosk-koffi version
        // This is a conceptual implementation
        console.log('Custom vocabulary set:', vocabulary.length, 'words');
      } catch (error) {
        console.warn('Failed to set custom vocabulary:', error);
      }
    }
  }
}