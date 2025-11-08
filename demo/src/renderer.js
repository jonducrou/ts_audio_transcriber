const { ipcRenderer } = require('electron');

let isRecording = false;
let snippetCount = 0;
let sessionCount = 0;
let currentSessionId = null;
let recordingStartTime = null;

// Start transcription with dual-mode configuration
async function startTranscription() {
    if (isRecording) return;

    // Get snippet pipeline config
    const snippetEngine = document.getElementById('snippetEngine').value;
    let snippetEngineOptions;
    if (snippetEngine === 'whisper') {
        snippetEngineOptions = {
            modelPath: './models/ggml-base.en.bin'
        };
    } else {
        snippetEngineOptions = {
            modelPath: './models/vosk-model-en-us-0.22-lgraph'
        };
    }

    const snippetConfig = {
        enabled: document.getElementById('enableSnippets').checked,
        intervalSeconds: parseInt(document.getElementById('snippetInterval').value) || 15,
        engine: snippetEngine,
        confidenceThreshold: parseFloat(document.getElementById('snippetThreshold').value) || 0.4,
        engineOptions: snippetEngineOptions
    };

    // Get session pipeline config
    const sessionEngine = document.getElementById('sessionEngine').value;
    let sessionEngineOptions;
    if (sessionEngine === 'whisper') {
        sessionEngineOptions = {
            modelPath: './models/ggml-base.en.bin'
        };
    } else {
        sessionEngineOptions = {
            modelPath: './models/vosk-model-en-us-0.22-lgraph'
        };
    }

    const sessionConfig = {
        enabled: document.getElementById('enableSession').checked,
        engine: sessionEngine,
        confidenceThreshold: parseFloat(document.getElementById('sessionThreshold').value) || 0.7,
        engineOptions: sessionEngineOptions
    };

    // Recording config
    const recordingConfig = {
        enabled: true,
        outputDir: './recordings',
        format: 'wav',
        autoCleanup: document.getElementById('autoCleanup').checked
    };

    const options = {
        enableMicrophone: true,
        enableSystemAudio: false,
        snippets: snippetConfig,
        sessionTranscript: sessionConfig,
        recording: recordingConfig
    };

    if (!snippetConfig.enabled && !sessionConfig.enabled) {
        alert('Please enable at least one pipeline (snippets or session)');
        return;
    }

    try {
        document.getElementById('startBtn').disabled = true;
        console.log('Starting dual-mode transcription...', options);

        const result = await ipcRenderer.invoke('start-transcription', options);

        if (result.success) {
            isRecording = true;
            updateControlsState();
            console.log('Transcription started successfully');
        } else {
            alert('Failed to start: ' + result.error);
            document.getElementById('startBtn').disabled = false;
        }
    } catch (error) {
        console.error('Error starting transcription:', error);
        alert('Error: ' + error.message);
        document.getElementById('startBtn').disabled = false;
    }
}

async function stopTranscription() {
    if (!isRecording) return;

    try {
        document.getElementById('stopBtn').disabled = true;
        console.log('Stopping transcription...');

        const result = await ipcRenderer.invoke('stop-transcription');

        if (result.success) {
            isRecording = false;
            updateControlsState();
            console.log('Transcription stopped');
        } else {
            alert('Failed to stop: ' + result.error);
            document.getElementById('stopBtn').disabled = false;
        }
    } catch (error) {
        console.error('Error stopping transcription:', error);
        alert('Error: ' + error.message);
        document.getElementById('stopBtn').disabled = false;
    }
}

function updateControlsState() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (isRecording) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        startBtn.innerHTML = '<span class="status-indicator status-running"></span>Recording...';
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        startBtn.innerHTML = '<span class="status-indicator status-stopped"></span>Start Recording';
    }
}

function clearAll() {
    // Clear snippets
    const snippetsLog = document.getElementById('snippetsLog');
    snippetsLog.innerHTML = '<div class="empty-state">⏱️ Live snippets appear here<br>every ~15 seconds during recording</div>';
    snippetCount = 0;
    document.getElementById('snippetCount').textContent = '0';
    document.getElementById('snippetCountBadge').textContent = '0 snippets';

    // Clear session
    const sessionTranscript = document.getElementById('sessionTranscript');
    sessionTranscript.innerHTML = '<div class="empty-state">📝 Complete session transcript<br>appears here after stopping</div>';
    sessionCount = 0;
    document.getElementById('sessionCount').textContent = '0';
    document.getElementById('sessionStatus').innerHTML = '';

    // Clear recording info
    document.getElementById('recordingInfo').innerHTML = '';

    console.log('Cleared all displays');
}

function addSnippet(event) {
    const snippetsLog = document.getElementById('snippetsLog');

    // Remove empty state on first snippet
    const emptyState = snippetsLog.querySelector('.empty-state');
    if (emptyState) {
        snippetsLog.innerHTML = '';
    }

    const entry = document.createElement('div');
    entry.className = 'snippet-entry';

    const meta = document.createElement('div');
    meta.className = 'snippet-meta';

    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    const confidencePercent = (event.confidence * 100).toFixed(1);

    const leftMeta = document.createElement('span');
    leftMeta.innerHTML = `<span class="badge badge-${event.engine}">${event.engine}</span> #${event.snippetIndex} @ ${timestamp}`;

    const rightMeta = document.createElement('span');
    rightMeta.innerHTML = `<span class="badge badge-confidence-${getConfidenceBadge(event.confidence)}">${confidencePercent}%</span>`;

    meta.appendChild(leftMeta);
    meta.appendChild(rightMeta);

    const text = document.createElement('div');
    text.className = 'snippet-text';
    text.textContent = event.text;

    entry.appendChild(meta);
    entry.appendChild(text);
    snippetsLog.appendChild(entry);

    // Auto-scroll to bottom
    snippetsLog.scrollTop = snippetsLog.scrollHeight;

    snippetCount++;
    document.getElementById('snippetCount').textContent = snippetCount.toString();
    document.getElementById('snippetCountBadge').textContent = `${snippetCount} snippets`;

    // Keep only last 50 snippets for performance
    while (snippetsLog.children.length > 50) {
        snippetsLog.removeChild(snippetsLog.firstChild);
    }
}

function displaySessionTranscript(event) {
    const sessionTranscript = document.getElementById('sessionTranscript');
    sessionTranscript.innerHTML = '';

    // Add metadata header
    const metaDiv = document.createElement('div');
    metaDiv.className = 'session-meta';

    const duration = (event.metadata.duration / 1000).toFixed(1);
    const processingTime = (event.metadata.processingTime / 1000).toFixed(1);
    const confidencePercent = (event.confidence * 100).toFixed(1);

    metaDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <strong>Session: ${event.sessionId}</strong>
            <span class="badge badge-${event.engine}">${event.engine}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 11px;">
            <div><strong>Duration:</strong> ${duration}s</div>
            <div><strong>Words:</strong> ${event.metadata.wordCount}</div>
            <div><strong>Processing:</strong> ${processingTime}s</div>
            <div><strong>Confidence:</strong> <span class="badge badge-confidence-${getConfidenceBadge(event.confidence)}">${confidencePercent}%</span></div>
        </div>
    `;

    const textDiv = document.createElement('div');
    textDiv.className = 'session-text';
    textDiv.textContent = event.text;

    sessionTranscript.appendChild(metaDiv);
    sessionTranscript.appendChild(textDiv);

    sessionCount++;
    document.getElementById('sessionCount').textContent = sessionCount.toString();
}

function updateRecordingStatus(metadata) {
    const recordingInfo = document.getElementById('recordingInfo');
    const sessionStatus = document.getElementById('sessionStatus');

    if (metadata) {
        currentSessionId = metadata.sessionId;
        recordingStartTime = metadata.startTime;

        const infoHtml = `
            <div class="recording-info">
                ⏺️ Recording: ${metadata.sessionId}<br>
                File: ${metadata.audioFilePath}
            </div>
        `;
        recordingInfo.innerHTML = infoHtml;

        const statusHtml = `
            <div class="session-status">
                <div class="session-status-item">
                    <span>Status:</span>
                    <span><span class="status-indicator status-running"></span>Recording</span>
                </div>
                <div class="session-status-item">
                    <span>Session:</span>
                    <span>${metadata.sessionId}</span>
                </div>
            </div>
        `;
        sessionStatus.innerHTML = statusHtml;
    }
}

function clearRecordingStatus(metadata) {
    const recordingInfo = document.getElementById('recordingInfo');
    const sessionStatus = document.getElementById('sessionStatus');

    if (metadata) {
        const duration = (metadata.duration / 1000).toFixed(1);
        const fileSize = (metadata.fileSize / 1024 / 1024).toFixed(2);

        const infoHtml = `
            <div class="processing-info">
                ⏹️ Stopped. Processing session...<br>
                Duration: ${duration}s | Size: ${fileSize}MB
            </div>
        `;
        recordingInfo.innerHTML = infoHtml;

        const statusHtml = `
            <div class="session-status">
                <div class="session-status-item">
                    <span>Status:</span>
                    <span><span class="status-indicator status-stopped"></span>Processing</span>
                </div>
                <div class="session-status-item">
                    <span>Session:</span>
                    <span>${metadata.sessionId}</span>
                </div>
            </div>
        `;
        sessionStatus.innerHTML = statusHtml;
    }

    currentSessionId = null;
    recordingStartTime = null;
}

function updateRecordingProgress(progress) {
    // Update live duration and file size metrics
    const duration = (progress.duration / 1000).toFixed(0);
    const fileSize = (progress.fileSize / 1024 / 1024).toFixed(2);

    document.getElementById('memory').textContent = `${fileSize}MB`;

    // Could also update a duration display if we add one to the UI
}

function getConfidenceBadge(confidence) {
    if (confidence >= 0.7) return 'high';
    if (confidence >= 0.4) return 'med';
    return 'low';
}

function updateMetrics(metrics) {
    // Update CPU metric if available
    if (metrics.cpuUsage !== undefined) {
        document.getElementById('cpu').textContent = `${metrics.cpuUsage}%`;
    }
}

// IPC Event Listeners
ipcRenderer.on('snippet', (event, snippetEvent) => {
    console.log('🎯 RENDERER: Received snippet event:', snippetEvent);
    try {
        addSnippet(snippetEvent);
        console.log('✅ RENDERER: Snippet added to UI');
    } catch (err) {
        console.error('❌ RENDERER: Error adding snippet:', err);
    }
});

ipcRenderer.on('sessionTranscript', (event, sessionEvent) => {
    console.log('🎯 RENDERER: Received session transcript event:', sessionEvent);
    try {
        displaySessionTranscript(sessionEvent);
        console.log('✅ RENDERER: Session transcript displayed');

        // Clear processing indicator
        const recordingInfo = document.getElementById('recordingInfo');
        recordingInfo.innerHTML = '';
    } catch (err) {
        console.error('❌ RENDERER: Error displaying session transcript:', err);
    }
});

ipcRenderer.on('recordingStarted', (event, metadata) => {
    console.log('Recording started:', metadata);
    updateRecordingStatus(metadata);
});

ipcRenderer.on('recordingStopped', (event, metadata) => {
    console.log('Recording stopped:', metadata);
    clearRecordingStatus(metadata);
});

ipcRenderer.on('recordingProgress', (event, progress) => {
    updateRecordingProgress(progress);
});

ipcRenderer.on('transcription-error', (event, error) => {
    console.error('Transcription error:', error);
    alert(`Error: ${error.message}`);
});

ipcRenderer.on('transcription-started', () => {
    console.log('Transcription engine started');
});

ipcRenderer.on('transcription-stopped', () => {
    console.log('Transcription engine stopped');
});

ipcRenderer.on('metrics-update', (event, metrics) => {
    updateMetrics(metrics);
});

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Dual-mode demo app initialized');
    updateControlsState();
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) {
        switch (event.key) {
            case 's':
                event.preventDefault();
                if (isRecording) {
                    stopTranscription();
                } else {
                    startTranscription();
                }
                break;
            case 'k':
                event.preventDefault();
                clearAll();
                break;
        }
    }
});
