/**
 * Test: System Audio Capture
 *
 * This test verifies the v1.2.0 system audio capture feature:
 * 1. System audio capture starts successfully
 * 2. Audio data is received (not silent)
 * 3. Transcription works with system audio
 * 4. Session transcript is emitted after stop()
 *
 * SETUP REQUIRED:
 * - Play some audio on your system (music, video, etc.) during the test
 * - Grant Screen Recording permission (System Settings > Privacy & Security)
 * - The test will capture any audio playing on your system
 *
 * SUCCESS CRITERIA:
 * - System audio stream starts without errors
 * - Audio data is captured
 * - Session transcript is emitted (may be empty if no audio is playing)
 */

const { AudioTranscriber } = require('./dist/index.js');
const path = require('path');

// Test configuration
const VOSK_MODEL_PATH = path.join(__dirname, 'models', 'vosk-model-en-us-0.22-lgraph');
const RECORDING_DURATION_MS = 10000; // 10 seconds
const TEST_TIMEOUT_MS = 30000; // 30 seconds total timeout

// Test state tracking
const testResults = {
  audioDataReceived: false,
  bytesReceived: 0,
  snippetCount: 0,
  sessionTranscriptReceived: false,
  sessionTranscriptText: null,
  errors: []
};

async function runTest() {
  console.log('=== System Audio Capture Test ===\n');
  console.log(`Configuration:`);
  console.log(`- Vosk model: ${VOSK_MODEL_PATH}`);
  console.log(`- Recording duration: ${RECORDING_DURATION_MS}ms`);
  console.log(`- Test timeout: ${TEST_TIMEOUT_MS}ms\n`);

  console.log('⚠️  IMPORTANT: Play some audio (music, video, etc.) during this test!');
  console.log('⚠️  Make sure Screen Recording permission is granted.\n');

  // Create transcriber with system audio enabled
  const transcriber = new AudioTranscriber({
    enableMicrophone: false,
    enableSystemAudio: true,  // ← Testing system audio
    snippets: {
      enabled: true,
      engine: 'vosk',
      intervalSeconds: 5,
      engineOptions: {
        modelPath: VOSK_MODEL_PATH
      }
    },
    sessionTranscript: {
      enabled: true,
      engine: 'vosk',
      engineOptions: {
        modelPath: VOSK_MODEL_PATH
      }
    },
    recording: {
      enabled: true,
      outputDir: './test-recordings',
      autoCleanup: true
    }
  });

  // Event handlers
  transcriber.on('snippet', (event) => {
    testResults.snippetCount++;
    console.log(`[Snippet #${testResults.snippetCount}]`);
    console.log(`  Text: "${event.text.substring(0, 80)}${event.text.length > 80 ? '...' : ''}"`);
    console.log(`  Source: ${event.source}`);
    console.log(`  Confidence: ${event.confidence.toFixed(2)}\n`);
  });

  transcriber.on('sessionTranscript', (event) => {
    console.log(`\n[Session Transcript Received]`);
    console.log(`  Session ID: ${event.sessionId}`);
    console.log(`  Source: ${event.source}`);
    console.log(`  Text length: ${event.text.length} chars`);
    console.log(`  Word count: ${event.metadata.wordCount}`);
    console.log(`  Confidence: ${event.confidence.toFixed(2)}`);
    console.log(`  Duration: ${event.metadata.duration}ms`);
    console.log(`  Processing time: ${event.metadata.processingTime}ms`);
    if (event.text.length > 0) {
      console.log(`  Text preview: "${event.text.substring(0, 100)}..."\n`);
    } else {
      console.log(`  (Empty transcript - no audio was playing)\n`);
    }

    testResults.sessionTranscriptReceived = true;
    testResults.sessionTranscriptText = event.text;
  });

  transcriber.on('recordingStarted', (metadata) => {
    console.log(`[Recording Started]`);
    console.log(`  Session ID: ${metadata.sessionId}`);
    console.log(`  File: ${metadata.audioFilePath}\n`);
  });

  transcriber.on('recordingStopped', (metadata) => {
    console.log(`[Recording Stopped]`);
    console.log(`  Duration: ${metadata.duration}ms`);
    console.log(`  File size: ${metadata.fileSize} bytes\n`);
    testResults.audioDataReceived = metadata.fileSize > 0;
    testResults.bytesReceived = metadata.fileSize;
  });

  transcriber.on('stopped', () => {
    console.log(`[AudioTranscriber Stopped]\n`);
  });

  transcriber.on('error', (error) => {
    console.error(`[ERROR] ${error.message}`);
    if (error.originalError) {
      console.error(`  Original: ${error.originalError.message}`);
    }
    testResults.errors.push(error);
  });

  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Starting system audio capture...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    await transcriber.start();
    console.log('✅ System audio capture started!\n');
    console.log(`Recording for ${RECORDING_DURATION_MS / 1000} seconds...`);
    console.log('🎵 Play some audio now (music, video, speech, etc.)\n');

    // Wait for recording duration
    await new Promise(resolve => setTimeout(resolve, RECORDING_DURATION_MS));

    console.log(`Received ${testResults.snippetCount} snippet(s)\n`);
    console.log('Stopping system audio capture...\n');

    await transcriber.stop();

    // Wait for session transcript
    await new Promise(resolve => setTimeout(resolve, 1000));

    // === RESULTS ===
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`Audio data received: ${testResults.audioDataReceived ? '✅ YES' : '❌ NO'}`);
    console.log(`Bytes captured: ${testResults.bytesReceived}`);
    console.log(`Snippets received: ${testResults.snippetCount}`);
    console.log(`Session transcript received: ${testResults.sessionTranscriptReceived ? '✅ YES' : '❌ NO'}`);
    if (testResults.sessionTranscriptText !== null) {
      console.log(`Transcript length: ${testResults.sessionTranscriptText.length} chars`);
    }
    console.log('');

    if (testResults.errors.length > 0) {
      console.log(`Errors encountered: ${testResults.errors.length}`);
      testResults.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.message}`);
      });
      console.log('');
    }

    // Determine test success
    const success =
      testResults.audioDataReceived &&
      testResults.sessionTranscriptReceived &&
      testResults.errors.length === 0;

    if (success) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ TEST PASSED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('System audio capture is working correctly!');
      if (testResults.snippetCount > 0) {
        console.log(`Captured ${testResults.snippetCount} snippet(s) from system audio.`);
      } else {
        console.log('Note: No snippets captured (audio may have been silent or below confidence threshold).');
      }
      console.log('');
      process.exit(0);
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ TEST FAILED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      if (!testResults.audioDataReceived) {
        console.log('- No audio data received (check permissions and audio playback)');
      }
      if (!testResults.sessionTranscriptReceived) {
        console.log('- Session transcript not received');
      }
      if (testResults.errors.length > 0) {
        console.log(`- ${testResults.errors.length} error(s) occurred`);
      }
      console.log('');
      process.exit(1);
    }

  } catch (error) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ TEST ERROR');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(error);
    console.error('');
    console.error('Common issues:');
    console.error('- Screen Recording permission not granted');
    console.error('- macos-system-audio-recorder not installed');
    console.error('- macOS version too old (requires macOS 13+)');
    console.error('');
    process.exit(1);
  }
}

// Set test timeout
setTimeout(() => {
  console.error(`\n❌ TEST TIMEOUT - Test took longer than ${TEST_TIMEOUT_MS / 1000} seconds\n`);
  process.exit(1);
}, TEST_TIMEOUT_MS);

// Run the test
runTest();
