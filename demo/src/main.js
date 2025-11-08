const { app, BrowserWindow, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const { AudioTranscriber } = require('../../dist/index');

let mainWindow;
let transcriber;
let transcriberEventListeners = [];

// Helper function to clean up transcriber listeners
function cleanupTranscriberListeners() {
  if (transcriber && transcriberEventListeners.length > 0) {
    transcriberEventListeners.forEach(({ event, listener }) => {
      transcriber.removeListener(event, listener);
    });
    transcriberEventListeners = [];
  }
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    titleBarStyle: 'hiddenInset',
    title: 'TypeScript Audio Transcriber Demo'
  });

  // Load the index.html of the app
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Setup file logging for analysis
  const fs = require('fs');
  const logFile = path.join(process.cwd(), 'transcriber-debug.log');

  // Clear previous log
  try { fs.unlinkSync(logFile); } catch (e) {}

  // Override console.log to also write to file
  const originalLog = console.log;
  console.log = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    originalLog(...args); // Still log to console
    try {
      fs.appendFileSync(logFile, logLine);
    } catch (e) {
      // Ignore file write errors
    }
  };

  console.log('=== DEMO APP STARTING ===');
  console.log(`Debug log file: ${logFile}`);

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    // Clean up transcriber when window is closed
    if (transcriber) {
      transcriber.stop().then(() => {
        cleanupTranscriberListeners();
        transcriber = null;
      }).catch(err => {
        console.error('Error stopping transcriber on window close:', err);
        cleanupTranscriberListeners();
        transcriber = null;
      });
    }
    mainWindow = null;
  });
}

// Request macOS permissions
async function requestPermissions() {
  try {
    console.log('Requesting permissions...');

    // Check current microphone permission status
    let microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log('Current microphone status:', microphoneStatus);

    // For microphone permission, we need to actually try to access it to trigger the dialog
    let microphoneGranted = false;

    if (microphoneStatus === 'not-determined') {
      console.log('Microphone permission not determined, requesting...');
      // This should trigger the system dialog
      microphoneGranted = await systemPreferences.askForMediaAccess('microphone');
      console.log('Microphone permission request result:', microphoneGranted);

      // Check status again
      microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
      console.log('Microphone status after request:', microphoneStatus);
    } else if (microphoneStatus === 'granted') {
      microphoneGranted = true;
      console.log('Microphone permission already granted');
    } else {
      console.log('Microphone permission was previously denied');
    }

    // For screen recording permission, we can only check the status
    // macOS doesn't allow apps to programmatically request screen recording permission
    let screenStatus = 'not-determined';
    try {
      screenStatus = systemPreferences.getMediaAccessStatus('screen');
      console.log('Screen recording status:', screenStatus);
    } catch (err) {
      console.log('Screen permission API not available:', err.message);
      screenStatus = 'unknown';
    }

    const result = {
      microphone: microphoneStatus === 'granted',
      screen: screenStatus === 'granted',
      microphoneStatus: microphoneStatus,
      screenStatus: screenStatus
    };

    console.log('Final permission result:', result);
    return result;
  } catch (error) {
    console.error('Error requesting permissions:', error);
    return {
      microphone: false,
      screen: false,
      microphoneStatus: 'error',
      screenStatus: 'error'
    };
  }
}

// Test microphone access to trigger permission dialog
async function testMicrophoneAccess() {
  return new Promise((resolve) => {
    // Send a message to the renderer to test microphone access
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        (async () => {
          try {
            console.log('Testing microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Microphone access granted');
            // Stop the stream immediately
            stream.getTracks().forEach(track => track.stop());
            return { success: true, granted: true };
          } catch (error) {
            console.log('Microphone access error:', error);
            return { success: false, error: error.message, granted: false };
          }
        })()
      `).then(result => {
        console.log('Microphone test result:', result);
        resolve(result);
      }).catch(error => {
        console.log('Error testing microphone:', error);
        resolve({ success: false, error: error.message, granted: false });
      });
    } else {
      resolve({ success: false, error: 'No window available', granted: false });
    }
  });
}

// IPC handlers
ipcMain.handle('request-permissions', async () => {
  // First try the system preferences method
  const systemResult = await requestPermissions();

  // If microphone status is still not-determined, try the web API approach
  if (systemResult.microphoneStatus === 'not-determined') {
    console.log('Trying web API approach for microphone permission...');
    const webResult = await testMicrophoneAccess();

    if (webResult.granted) {
      // Check system status again after web API test
      const newStatus = systemPreferences.getMediaAccessStatus('microphone');
      systemResult.microphone = newStatus === 'granted';
      systemResult.microphoneStatus = newStatus;
    }
  }

  return systemResult;
});

ipcMain.handle('start-transcription', async (event, options) => {
  try {
    console.log('=== STARTING TRANSCRIPTION (DUAL-MODE) ===');
    console.log('Options:', JSON.stringify(options, null, 2));

    if (transcriber) {
      console.log('Stopping existing transcriber...');
      await transcriber.stop();
    }

    console.log('Creating new AudioTranscriber instance with dual pipelines...');
    transcriber = new AudioTranscriber({
      enableMicrophone: options.enableMicrophone || false,
      enableSystemAudio: options.enableSystemAudio || false,

      // Snippet pipeline configuration
      snippets: options.snippets || {
        enabled: true,
        intervalSeconds: 15,
        engine: 'vosk',
        confidenceThreshold: 0.4,
        engineOptions: {
          modelPath: './models/vosk-model-en-us-0.22-lgraph'
        }
      },

      // Session transcript configuration
      sessionTranscript: options.sessionTranscript || {
        enabled: true,
        engine: 'whisper',
        confidenceThreshold: 0.7,
        engineOptions: {
          modelPath: './models/ggml-base.en.bin'
        }
      },

      // Recording configuration
      recording: options.recording || {
        enabled: true,
        outputDir: './recordings',
        format: 'wav',
        autoCleanup: false
      }
    });

    console.log('AudioTranscriber created successfully');

    // Set up event listeners with comprehensive safety checks
    console.log('Setting up transcriber event listeners...');

    const snippetListener = (event) => {
      try {
        console.log('=== SNIPPET EVENT ===');
        console.log('Index:', event.snippetIndex);
        console.log('Text:', event.text);
        console.log('Source:', event.source);
        console.log('Confidence:', event.confidence);
        console.log('Engine:', event.engine);

        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('snippet', event);
        }
      } catch (err) {
        console.log('Snippet listener error (safe ignore):', err.message);
      }
    };

    const sessionTranscriptListener = (event) => {
      try {
        console.log('=== SESSION TRANSCRIPT EVENT ===');
        console.log('SessionId:', event.sessionId);
        console.log('Text:', event.text);
        console.log('Source:', event.source);
        console.log('Confidence:', event.confidence);
        console.log('Engine:', event.engine);
        console.log('Metadata:', event.metadata);

        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('sessionTranscript', event);
        }
      } catch (err) {
        console.log('Session transcript listener error (safe ignore):', err.message);
      }
    };

    const recordingStartedListener = (metadata) => {
      try {
        console.log('=== RECORDING STARTED ===');
        console.log('SessionId:', metadata.sessionId);
        console.log('FilePath:', metadata.audioFilePath);

        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('recordingStarted', metadata);
        }
      } catch (err) {
        console.log('Recording started listener error (safe ignore):', err.message);
      }
    };

    const recordingStoppedListener = (metadata) => {
      try {
        console.log('=== RECORDING STOPPED ===');
        console.log('SessionId:', metadata.sessionId);
        console.log('FilePath:', metadata.audioFilePath);
        console.log('Duration:', metadata.duration, 'ms');
        console.log('FileSize:', metadata.fileSize, 'bytes');

        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('recordingStopped', metadata);
        }
      } catch (err) {
        console.log('Recording stopped listener error (safe ignore):', err.message);
      }
    };

    const recordingProgressListener = (progress) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('recordingProgress', progress);
        }
      } catch (err) {
        console.log('Recording progress listener error (safe ignore):', err.message);
      }
    };

    const errorListener = (error) => {
      try {
        console.error('Transcription error:', error);
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('transcription-error', {
            message: error.message,
            type: error.type || 'unknown'
          });
        }
      } catch (err) {
        console.log('Error listener error (safe ignore):', err.message);
      }
    };

    const startedListener = () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('transcription-started');
        }
      } catch (err) {
        console.log('Started listener error (safe ignore):', err.message);
      }
    };

    const stoppedListener = () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('transcription-stopped');
        }
      } catch (err) {
        console.log('Stopped listener error (safe ignore):', err.message);
      }
    };

    const metricsListener = (metrics) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('metrics-update', metrics);
        }
      } catch (err) {
        console.log('Metrics listener error (safe ignore):', err.message);
      }
    };

    // Set up all event listeners
    transcriber.on('snippet', snippetListener);
    transcriber.on('sessionTranscript', sessionTranscriptListener);
    transcriber.on('recordingStarted', recordingStartedListener);
    transcriber.on('recordingStopped', recordingStoppedListener);
    transcriber.on('recordingProgress', recordingProgressListener);
    transcriber.on('error', errorListener);
    transcriber.on('started', startedListener);
    transcriber.on('stopped', stoppedListener);
    transcriber.on('metrics', metricsListener);

    // Store listeners for cleanup
    transcriberEventListeners = [
      { event: 'snippet', listener: snippetListener },
      { event: 'sessionTranscript', listener: sessionTranscriptListener },
      { event: 'recordingStarted', listener: recordingStartedListener },
      { event: 'recordingStopped', listener: recordingStoppedListener },
      { event: 'recordingProgress', listener: recordingProgressListener },
      { event: 'error', listener: errorListener },
      { event: 'started', listener: startedListener },
      { event: 'stopped', listener: stoppedListener },
      { event: 'metrics', listener: metricsListener }
    ];

    console.log('Starting transcriber...');
    await transcriber.start();
    console.log('Transcriber started successfully!');
    return { success: true };
  } catch (error) {
    console.error('Failed to start transcription:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('stop-transcription', async () => {
  try {
    if (transcriber) {
      // Stop transcriber first (this will emit sessionTranscript event)
      await transcriber.stop();
      // Then remove listeners after all events have been emitted
      cleanupTranscriberListeners();
      transcriber = null;
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to stop transcription:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-devices', async () => {
  try {
    if (!transcriber) {
      transcriber = new AudioTranscriber();
    }
    const devices = await transcriber.getAvailableDevices();
    return { success: true, devices };
  } catch (error) {
    console.error('Failed to get devices:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-metrics', async () => {
  try {
    if (transcriber) {
      const metrics = transcriber.getMetrics();
      return { success: true, metrics };
    }
    return { success: false, error: 'No active transcriber' };
  } catch (error) {
    console.error('Failed to get metrics:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// App event handlers
app.whenReady().then(async () => {
  await createWindow();

  // Request permissions on startup
  const permissions = await requestPermissions();
  if (mainWindow) {
    mainWindow.webContents.send('permissions-status', permissions);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Clean up transcriber
  if (transcriber) {
    try {
      // Stop transcriber first to emit all final events
      await transcriber.stop();
      // Then remove listeners
      cleanupTranscriberListeners();
      transcriber = null;
    } catch (error) {
      console.error('Error stopping transcriber on app quit:', error);
    }
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (transcriber) {
    event.preventDefault();
    try {
      // Stop transcriber first to emit all final events
      await transcriber.stop();
      // Then remove listeners
      cleanupTranscriberListeners();
      transcriber = null;
      app.quit();
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      app.quit();
    }
  }
});