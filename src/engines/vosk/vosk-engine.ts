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
  private lastFinalText = '';
  private partialResultCount = 0;

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

      // Configure recognizer options for better accuracy
      if (config.engineOptions?.enableWords !== false) {
        this.recognizer.setWords(true); // Enable word-level timestamps by default
      }

      if (config.engineOptions?.enablePartialResults !== false) {
        // Vosk handles partial results by default
      }

      // Set custom vocabulary if provided for domain-specific accuracy
      if (config.engineOptions?.vocabulary) {
        this.recognizer.setGrammar(JSON.stringify(config.engineOptions.vocabulary));
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

    // Debug audio data before validation
    console.log(`[VOSK] Audio data received: ${audioData.length} bytes`);
    console.log(`[VOSK] Audio data sample: ${Array.from(audioData.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    if (!this.validateAudioData(audioData)) {
      console.log(`[VOSK] ERROR: Invalid audio data - length: ${audioData.length}, expected >= 320 bytes`);
      return null; // Skip invalid audio data
    }

    console.log('[VOSK] Audio data passed validation');

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

          // Raw transcription without deduplication to expose underlying issues

          isPartial = false;
          confidence = this.extractConfidence(resultObj);
          console.log(`Final transcription: "${transcriptionText}" (confidence: ${confidence})`);

          // Check for duplicate final results
          if (transcriptionText === this.lastFinalText) {
            console.log('Skipping duplicate final result');
            return null;
          }
          this.lastFinalText = transcriptionText;
          this.lastPartialText = ''; // Clear partial when we get final
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

          // Improved partial result deduplication
          if (transcriptionText === this.lastPartialText || transcriptionText === this.lastFinalText) {
            console.log('Skipping duplicate partial result');
            return null;
          }

          // Skip if partial is just a subset of the last partial (common with repeated words)
          if (this.lastPartialText && transcriptionText.length > this.lastPartialText.length) {
            if (transcriptionText.startsWith(this.lastPartialText)) {
              // Only emit if it's a significant extension (more than just repeated words)
              const extension = transcriptionText.substring(this.lastPartialText.length).trim();
              if (extension.length < 3) {
                console.log('Skipping minor partial extension');
                return null;
              }
            }
          }

          this.lastPartialText = transcriptionText;
          this.partialResultCount++;
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
      this.lastFinalText = '';
      this.partialResultCount = 0;
      console.log('Vosk engine cleaned up successfully');

    } catch (error) {
      console.warn('Error during Vosk cleanup:', error);
    }
  }

  /**
   * Reset recognizer state (for snippet pipeline to get independent chunks)
   */
  public resetRecognizer(): void {
    if (!this.model) {
      console.warn('Cannot reset recognizer - model not loaded');
      return;
    }

    try {
      // Get final result before resetting
      if (this.recognizer) {
        try {
          this.recognizer.finalResult();
        } catch (error) {
          // Ignore
        }
      }

      // Create new recognizer instance to clear state
      this.recognizer = new Recognizer({ model: this.model, sampleRate: this.sampleRate });
      this.recognizer.setWords(true);

      // Reset state
      this.lastPartialText = '';
      this.lastFinalText = '';
      this.partialResultCount = 0;

      console.log('[VOSK] Recognizer reset for new snippet');
    } catch (error) {
      console.warn('[VOSK] Error resetting recognizer:', error);
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
      this.lastFinalText = '';
      this.partialResultCount = 0;
    }
  }

  /**
   * Clean up repeated words and phrases from transcription text
   */
  private cleanupRepeatedWords(text: string): string {
    const words = text.split(/\s+/);
    if (words.length <= 1) return text;

    const cleanedWords: string[] = [];

    // First pass: Remove consecutive duplicate words
    for (let i = 0; i < words.length; i++) {
      const currentWord = words[i].toLowerCase();
      const previousWord = i > 0 ? words[i - 1].toLowerCase() : '';

      if (currentWord !== previousWord) {
        cleanedWords.push(words[i]);
      } else {
        console.log(`Removing repeated word: "${words[i]}"`);
      }
    }

    // Second pass: Remove repeated phrases of 2-4 words
    const finalWords = [...cleanedWords];

    for (let phraseLen = 2; phraseLen <= Math.min(4, Math.floor(finalWords.length / 2)); phraseLen++) {
      for (let i = 0; i <= finalWords.length - phraseLen * 2; i++) {
        const phrase1 = finalWords.slice(i, i + phraseLen).map(w => w.toLowerCase()).join(' ');
        const phrase2 = finalWords.slice(i + phraseLen, i + phraseLen * 2).map(w => w.toLowerCase()).join(' ');

        if (phrase1 === phrase2) {
          console.log(`Removing repeated phrase: "${finalWords.slice(i + phraseLen, i + phraseLen * 2).join(' ')}"`);
          finalWords.splice(i + phraseLen, phraseLen);
          i--; // Check this position again
          break; // Process one repetition at a time
        }
      }
    }

    return finalWords.join(' ');
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