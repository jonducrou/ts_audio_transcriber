#!/usr/bin/env node

/**
 * Audio capture test using SAME pipeline as production code
 * Tests MacAudioCapture (sox-based) to verify WAV quality
 *
 * Usage: node test-audio-capture.js [duration_seconds]
 */

const fs = require('fs');
const path = require('path');

// Import the compiled TypeScript library
const { MacAudioCapture } = require('./dist/audio/capture');

// Parse command line args
const durationSeconds = parseInt(process.argv[2]) || 10;
console.log(`\n🎙️  Audio Capture Test (Using MacAudioCapture)`);
console.log(`Recording for ${durationSeconds} seconds...\n`);

// Generate output filename
const timestamp = Date.now();
const outputDir = './test-recordings';
const outputFile = path.join(outputDir, `test_${timestamp}.wav`);

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Audio configuration
const sampleRate = 16000;
const channels = 1;
const bitDepth = 16;

// Write WAV header
function writeWavHeader(stream, dataSize = 0) {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);

  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(dataSize + 36, 4); // File size - 8
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
  header.writeUInt32LE(dataSize, 40); // Subchunk2Size

  stream.write(header);
}

// Update WAV header with correct file size
function updateWavHeader(filePath, dataSize) {
  const fd = fs.openSync(filePath, 'r+');

  // Update file size (at offset 4)
  const fileSize = dataSize + 36;
  const fileSizeBuffer = Buffer.alloc(4);
  fileSizeBuffer.writeUInt32LE(fileSize, 0);
  fs.writeSync(fd, fileSizeBuffer, 0, 4, 4);

  // Update data chunk size (at offset 40)
  const dataSizeBuffer = Buffer.alloc(4);
  dataSizeBuffer.writeUInt32LE(dataSize, 0);
  fs.writeSync(fd, dataSizeBuffer, 0, 4, 40);

  fs.closeSync(fd);
}

// Create write stream
const writeStream = fs.createWriteStream(outputFile, { flags: 'w' });

// Write initial header (will update later)
writeWavHeader(writeStream, 0);

// Track statistics
let bytesWritten = 0;
let chunkCount = 0;
let minAmplitude = Infinity;
let maxAmplitude = 0;
let totalAmplitude = 0;

// Calculate amplitude for diagnostics
function calculateAmplitude(buffer) {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < buffer.length; i += 2) {
    const sample = Math.abs(buffer.readInt16LE(i));
    sum += sample;
    max = Math.max(max, sample);
  }
  const avg = sum / (buffer.length / 2);
  return { avg, max };
}

// Start audio capture
async function main() {
  try {
    // Create MacAudioCapture instance (same as production)
    const audioCapture = new MacAudioCapture();

    // Initialize
    await audioCapture.initialize();
    console.log('✅ MacAudioCapture initialized');
    console.log('');

    // Start microphone capture (same config as production)
    const audioStream = await audioCapture.startMicrophoneCapture(undefined, {
      sampleRate: sampleRate,
      channels: channels,
      bitDepth: bitDepth,
      format: 'pcm',
      bufferSize: 1024
    });

    console.log('🎤 Recording started with MacAudioCapture (sox-based)');
    console.log('');

    // Handle audio data
    const startTime = Date.now();

    audioStream.onData((data, timestamp) => {
      writeStream.write(data);
      bytesWritten += data.length;
      chunkCount++;

      // Calculate amplitude
      const amp = calculateAmplitude(data);
      minAmplitude = Math.min(minAmplitude, amp.avg);
      maxAmplitude = Math.max(maxAmplitude, amp.avg);
      totalAmplitude += amp.avg;

      // Log every chunk to understand flow
      if (chunkCount <= 5 || chunkCount % 50 === 0) {
        const first16 = data.slice(0, 16);
        const hex = first16.toString('hex').match(/.{1,2}/g)?.join(' ') || '';
        console.log(`Chunk ${chunkCount}: ${data.length} bytes, amp: ${amp.avg.toFixed(1)}, first 16: ${hex}`);
      } else if (chunkCount % 10 === 0) {
        process.stdout.write('.');
      }
    });

    audioStream.onError((error) => {
      console.error('\n❌ Recording error:', error);
      cleanup(audioCapture);
    });

    audioStream.onEnd(() => {
      console.log('\n⏹️  Stream ended');
      cleanup(audioCapture);
    });

    // Stop after duration
    setTimeout(async () => {
      console.log('\n\n⏹️  Stopping recording...');

      try {
        await audioCapture.stopAllStreams();

        // Close write stream
        writeStream.end(() => {
          // Update WAV header with correct sizes
          updateWavHeader(outputFile, bytesWritten);

          const duration = (Date.now() - startTime) / 1000;
          const fileSize = (bytesWritten + 44) / 1024 / 1024;
          const avgAmplitude = chunkCount > 0 ? totalAmplitude / chunkCount : 0;

          console.log('\n✅ Recording complete!\n');
          console.log('Statistics:');
          console.log(`  Duration: ${duration.toFixed(1)}s`);
          console.log(`  File: ${outputFile}`);
          console.log(`  Size: ${fileSize.toFixed(2)} MB`);
          console.log(`  Bytes: ${bytesWritten} bytes`);
          console.log(`  Chunks: ${chunkCount}`);
          console.log(`  Sample Rate: ${sampleRate} Hz`);
          console.log(`  Channels: ${channels}`);
          console.log('');
          console.log('Audio Quality:');
          console.log(`  Min Amplitude: ${minAmplitude.toFixed(1)}`);
          console.log(`  Max Amplitude: ${maxAmplitude.toFixed(1)}`);
          console.log(`  Avg Amplitude: ${avgAmplitude.toFixed(1)}`);
          console.log('');
          console.log('💡 You can play this file with:');
          console.log(`   play ${outputFile}`);
          console.log('   or');
          console.log(`   afplay ${outputFile}`);
          console.log('');

          process.exit(0);
        });
      } catch (error) {
        console.error('Error stopping audio capture:', error);
        process.exit(1);
      }
    }, durationSeconds * 1000);

  } catch (error) {
    console.error('❌ Failed to start audio capture:', error);
    process.exit(1);
  }
}

function cleanup(audioCapture) {
  audioCapture.stopAllStreams().catch(err => console.error('Cleanup error:', err));
  writeStream.end(() => {
    if (bytesWritten > 0) {
      updateWavHeader(outputFile, bytesWritten);
      console.log(`Partial recording saved to: ${outputFile}`);
    }
    process.exit(0);
  });
}

// Handle interrupt
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Interrupted by user');
  writeStream.end(() => {
    if (bytesWritten > 0) {
      updateWavHeader(outputFile, bytesWritten);
      console.log(`Partial recording saved to: ${outputFile}`);
    }
    process.exit(0);
  });
});

// Run
main();
