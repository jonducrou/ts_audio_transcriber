/**
 * Basic usage example for the TypeScript Audio Transcriber library
 */

import { AudioTranscriber, createTranscriber, TranscriptionEvent } from '../src';

async function basicTranscriptionExample() {
  console.log('🎤 Starting Audio Transcriber Demo');

  // Create transcriber with basic configuration
  const transcriber = createTranscriber({
    enableMicrophone: true,
    enableSystemAudio: false, // Start with microphone only
    engine: {
      engine: 'vosk',
      language: 'en',
      // Note: You'll need to download a Vosk model and place it in ./models/
      // Download from: https://alphacephei.com/vosk/models
    },
    enablePartialResults: true,
    confidenceThreshold: 0.3
  });

  // Set up event listeners
  transcriber.on('transcription', (event: TranscriptionEvent) => {
    const status = event.isPartial ? '...' : '✓';
    const confidence = (event.confidence * 100).toFixed(1);

    console.log(`[${event.source}] ${status} ${event.text} (${confidence}%)`);
  });

  transcriber.on('error', (error) => {
    console.error('❌ Transcription error:', error.message);
  });

  transcriber.on('started', () => {
    console.log('✅ Transcription started - speak into your microphone!');
  });

  transcriber.on('stopped', () => {
    console.log('🛑 Transcription stopped');
  });

  transcriber.on('metrics', (metrics) => {
    console.log(`📊 Metrics: ${metrics.transcriptionCount} transcriptions, ${metrics.averageLatency}ms avg latency`);
  });

  try {
    // Get available devices
    const devices = await transcriber.getAvailableDevices();
    console.log('🎧 Available devices:', devices.map(d => `${d.name} (${d.type})`).join(', '));

    // Start transcription
    await transcriber.start();

    // Let it run for 30 seconds
    console.log('⏱️  Recording for 30 seconds...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Stop transcription
    await transcriber.stop();

    // Show final metrics
    const finalMetrics = transcriber.getMetrics();
    console.log('📈 Final metrics:', finalMetrics);

  } catch (error) {
    console.error('💥 Error:', error);
  }
}

// Run the example
if (require.main === module) {
  basicTranscriptionExample()
    .then(() => {
      console.log('🎉 Demo completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Demo failed:', error);
      process.exit(1);
    });
}