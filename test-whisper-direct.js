#!/usr/bin/env node

/**
 * Direct test of whisper-node library
 * Tests Whisper with a real audio file to understand what it returns
 */

const fs = require('fs');
const path = require('path');
const whisperModule = require('whisper-node');

console.log('\n🔍 Testing whisper-node directly...\n');
console.log('whisper-node type:', typeof whisperModule);
console.log('whisper-node keys:', Object.keys(whisperModule || {}));

// Try to get the actual whisper function
let whisper = whisperModule;
if (typeof whisperModule === 'object') {
  if (typeof whisperModule.default === 'function') {
    whisper = whisperModule.default;
    console.log('✅ Using whisperModule.default');
  } else if (typeof whisperModule.whisper === 'function') {
    whisper = whisperModule.whisper;
    console.log('✅ Using whisperModule.whisper');
  }
}

console.log('whisper function type:', typeof whisper);
console.log('');

// Use one of the test recordings if it exists
const testRecordingsDir = path.resolve(__dirname, 'test-recordings');
let audioFile = null;

if (fs.existsSync(testRecordingsDir)) {
  const files = fs.readdirSync(testRecordingsDir).filter(f => f.endsWith('.wav'));
  if (files.length > 0) {
    audioFile = path.join(testRecordingsDir, files[files.length - 1]);
    console.log(`Found test recording: ${audioFile}`);
  }
}

if (!audioFile || !fs.existsSync(audioFile)) {
  console.error('❌ No test audio file found. Please run test-audio-capture.js first:');
  console.error('   node test-audio-capture.js 5');
  process.exit(1);
}

// Check file details
const stats = fs.statSync(audioFile);
console.log(`File size: ${stats.size} bytes (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
console.log('');

// Test whisper-node
async function testWhisper() {
  try {
    const modelPath = path.resolve(__dirname, 'models/ggml-base.en.bin');

    if (!fs.existsSync(modelPath)) {
      console.error(`❌ Model not found: ${modelPath}`);
      process.exit(1);
    }

    console.log(`✅ Model found: ${modelPath}`);
    console.log('');

    console.log('Calling whisper-node...');
    console.log('Configuration:');
    console.log('  - modelPath:', modelPath);
    console.log('  - audioFile:', audioFile);
    console.log('  - language: en');
    console.log('  - verbose: true');
    console.log('');

    const startTime = Date.now();

    const result = await whisper(audioFile, {
      modelPath: modelPath,
      language: 'en',
      verbose: true,
      removeWavFileAfterTranscription: false,
      withCuda: false,
      whisperOptions: {
        outputFormat: 'json',
        wordTimestamps: true,
        temperature: 0.0,
        speedUp: false,
        suppress_blank: false,
        suppress_non_speech_tokens: false
      }
    });

    const duration = Date.now() - startTime;

    console.log('');
    console.log('='.repeat(60));
    console.log('📊 RESULT:');
    console.log('='.repeat(60));
    console.log('');
    console.log('Type:', typeof result);
    console.log('Is Array:', Array.isArray(result));
    if (Array.isArray(result)) {
      console.log('Length:', result.length);
    }
    console.log('');
    console.log('Raw result:');
    console.log(JSON.stringify(result, null, 2));
    console.log('');
    console.log('Processing time:', duration, 'ms');
    console.log('');

    // Try to extract text using different methods
    console.log('Text extraction attempts:');

    // Method 1: Direct string
    if (typeof result === 'string') {
      console.log('  ✅ Direct string:', result);
    }

    // Method 2: result.text
    if (result && result.text) {
      console.log('  ✅ result.text:', result.text);
    }

    // Method 3: Array of segments
    if (Array.isArray(result) && result.length > 0) {
      const texts = result.map(segment => {
        return segment.speech || segment.text || segment.transcript || '';
      });
      console.log('  ✅ Array mapping:', texts.join(' '));

      // Show first segment structure
      console.log('');
      console.log('First segment structure:');
      console.log(JSON.stringify(result[0], null, 2));
    }

    if (Array.isArray(result) && result.length === 0) {
      console.log('  ❌ Empty array - no transcription produced');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Error during transcription:');
    console.error(error);
    console.error('');
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testWhisper();
