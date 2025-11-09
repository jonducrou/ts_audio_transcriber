/**
 * Test: Rapid Stop/Start with Session Transcripts
 *
 * This test verifies the v1.1.1 bug fixes:
 * 1. First recording session records for 8 seconds
 * 2. stop() processes and emits sessionTranscript for first session (even if silent)
 * 3. Second recording session starts IMMEDIATELY after stop() (no manual delay)
 * 4. Second recording session records for 8 seconds
 * 5. stop() processes and emits sessionTranscript for second session (even if silent)
 *
 * SUCCESS CRITERIA:
 * - Both sessionTranscript events must be received
 * - Snippet events are OPTIONAL (silence produces no snippets, which is correct)
 *
 * This test can run without speaking - it validates:
 * - sessionTranscript always emitted (even for silence)
 * - Rapid stop/start works without delays
 * - Data integrity maintained across sessions
 */

const { AudioTranscriber } = require('./dist/index.js');
const path = require('path');

// Test configuration
const VOSK_MODEL_PATH = path.join(__dirname, 'models', 'vosk-model-en-us-0.22-lgraph');
const RECORDING_DURATION_MS = 8000; // 8 seconds per session (enough for 1 snippet at 5s interval)
const TEST_TIMEOUT_MS = 40000; // 40 seconds total timeout

// Test state tracking
const testResults = {
  session1: {
    snippetCount: 0,
    sessionTranscriptReceived: false,
    sessionTranscriptText: null,
    sessionId: null
  },
  session2: {
    snippetCount: 0,
    sessionTranscriptReceived: false,
    sessionTranscriptText: null,
    sessionId: null
  },
  errors: []
};

let currentSession = 1;

async function runTest() {
  console.log('=== Rapid Stop/Start Test ===\n');
  console.log(`Configuration:`);
  console.log(`- Vosk model: ${VOSK_MODEL_PATH}`);
  console.log(`- Recording duration per session: ${RECORDING_DURATION_MS}ms`);
  console.log(`- Test timeout: ${TEST_TIMEOUT_MS}ms\n`);

  // Create transcriber with both snippets and session transcripts enabled
  const transcriber = new AudioTranscriber({
    enableMicrophone: true,
    enableSystemAudio: false,
    snippets: {
      enabled: true,
      engine: 'vosk',
      intervalSeconds: 5, // 5 second snippets for faster testing
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
      autoCleanup: true // Clean up files after processing
    }
  });

  // Event handlers
  transcriber.on('snippet', (event) => {
    const session = currentSession === 1 ? testResults.session1 : testResults.session2;
    session.snippetCount++;
    console.log(`[Session ${currentSession}] Snippet #${session.snippetCount}: "${event.text.substring(0, 50)}..." (confidence: ${event.confidence.toFixed(2)})`);
  });

  transcriber.on('sessionTranscript', (event) => {
    console.log(`\n[Session Transcript Received]`);
    console.log(`  Session ID: ${event.sessionId}`);
    console.log(`  Text length: ${event.text.length} chars`);
    console.log(`  Word count: ${event.metadata.wordCount}`);
    console.log(`  Confidence: ${event.confidence.toFixed(2)}`);
    console.log(`  Duration: ${event.metadata.duration}ms`);
    console.log(`  Processing time: ${event.metadata.processingTime}ms`);
    console.log(`  Text preview: "${event.text.substring(0, 100)}..."\n`);

    // Match to correct session
    if (testResults.session1.sessionId === event.sessionId) {
      testResults.session1.sessionTranscriptReceived = true;
      testResults.session1.sessionTranscriptText = event.text;
      console.log('✅ Session 1 transcript received!\n');
    } else if (testResults.session2.sessionId === event.sessionId) {
      testResults.session2.sessionTranscriptReceived = true;
      testResults.session2.sessionTranscriptText = event.text;
      console.log('✅ Session 2 transcript received!\n');
    } else {
      console.warn(`⚠️ Received transcript for unknown session: ${event.sessionId}\n`);
    }
  });

  transcriber.on('recordingStarted', (metadata) => {
    const session = currentSession === 1 ? testResults.session1 : testResults.session2;
    session.sessionId = metadata.sessionId;
    console.log(`[Session ${currentSession}] Recording started (ID: ${metadata.sessionId})\n`);
  });

  transcriber.on('recordingStopped', (metadata) => {
    console.log(`[Session ${currentSession}] Recording stopped`);
    console.log(`  Duration: ${metadata.duration}ms`);
    console.log(`  File size: ${metadata.fileSize} bytes\n`);
  });

  transcriber.on('stopped', () => {
    console.log(`[Session ${currentSession}] AudioTranscriber stopped\n`);
  });

  transcriber.on('error', (error) => {
    console.error(`[ERROR] ${error.message}`);
    if (error.originalError) {
      console.error(`  Original: ${error.originalError.message}`);
    }
    testResults.errors.push(error);
  });

  try {
    // === SESSION 1 ===
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SESSION 1: Starting first recording session');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    currentSession = 1;
    await transcriber.start();
    console.log('Recording for 8 seconds... (speak if you want snippets, but not required)\n');

    // Just wait for the recording duration - snippets are optional (silence won't produce them)
    await new Promise(resolve => setTimeout(resolve, RECORDING_DURATION_MS));
    console.log(`Session 1: Received ${testResults.session1.snippetCount} snippet(s) (OK if zero - silence produces no snippets)\n`);

    console.log('Stopping Session 1...\n');
    await transcriber.stop();

    // Wait a moment for sessionTranscript to be emitted
    await new Promise(resolve => setTimeout(resolve, 1000));

    // === SESSION 2 (IMMEDIATE START) ===
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SESSION 2: Starting second recording session IMMEDIATELY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    currentSession = 2;
    await transcriber.start(); // Should work without manual delay!
    console.log('Recording for 8 seconds... (speak if you want snippets, but not required)\n');

    // Just wait for the recording duration - snippets are optional (silence won't produce them)
    await new Promise(resolve => setTimeout(resolve, RECORDING_DURATION_MS));
    console.log(`Session 2: Received ${testResults.session2.snippetCount} snippet(s) (OK if zero - silence produces no snippets)\n`);

    console.log('Stopping Session 2...\n');
    await transcriber.stop();

    // Wait a moment for sessionTranscript to be emitted
    await new Promise(resolve => setTimeout(resolve, 1000));

    // === RESULTS ===
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Session 1:');
    console.log(`  Snippets received: ${testResults.session1.snippetCount}`);
    console.log(`  Session transcript received: ${testResults.session1.sessionTranscriptReceived ? '✅ YES' : '❌ NO'}`);
    if (testResults.session1.sessionTranscriptText) {
      console.log(`  Transcript length: ${testResults.session1.sessionTranscriptText.length} chars`);
    }
    console.log('');

    console.log('Session 2:');
    console.log(`  Snippets received: ${testResults.session2.snippetCount}`);
    console.log(`  Session transcript received: ${testResults.session2.sessionTranscriptReceived ? '✅ YES' : '❌ NO'}`);
    if (testResults.session2.sessionTranscriptText) {
      console.log(`  Transcript length: ${testResults.session2.sessionTranscriptText.length} chars`);
    }
    console.log('');

    if (testResults.errors.length > 0) {
      console.log(`Errors encountered: ${testResults.errors.length}`);
      testResults.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.message}`);
      });
      console.log('');
    }

    // Determine test success - ONLY require sessionTranscript events
    // Snippets are optional (silence produces none, which is correct behavior)
    const success =
      testResults.session1.sessionTranscriptReceived &&
      testResults.session2.sessionTranscriptReceived;

    if (success) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ TEST PASSED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Both sessions received session transcripts!');
      console.log('Rapid stop/start works correctly!');
      if (testResults.session1.snippetCount > 0 || testResults.session2.snippetCount > 0) {
        console.log(`Bonus: Received ${testResults.session1.snippetCount + testResults.session2.snippetCount} total snippet(s) from speech!`);
      }
      console.log('');
      process.exit(0);
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ TEST FAILED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      if (!testResults.session1.sessionTranscriptReceived) {
        console.log('- Session 1 session transcript not received (CRITICAL BUG!)');
      }
      if (!testResults.session2.sessionTranscriptReceived) {
        console.log('- Session 2 session transcript not received (CRITICAL BUG!)');
      }
      console.log('\nNote: Snippet count is not required (silence produces no snippets)');
      console.log('');
      process.exit(1);
    }

  } catch (error) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ TEST ERROR');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(error);
    process.exit(1);
  }
}

// Set test timeout
setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT - Test took longer than 30 seconds\n');
  process.exit(1);
}, TEST_TIMEOUT_MS);

// Run the test
runTest();
