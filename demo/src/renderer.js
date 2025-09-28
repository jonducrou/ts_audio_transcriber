const { ipcRenderer } = require('electron');

let isTranscribing = false;
let transcriptionCount = 0;

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const transcriptionLog = document.getElementById('transcriptionLog');
const messagesDiv = document.getElementById('messages');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    console.log('Demo app initialized');
    getDevices();
});

// Permission handling
async function requestPermissions() {
    try {
        showMessage('Requesting permissions...', 'info');
        console.log('Requesting permissions from renderer...');

        const result = await ipcRenderer.invoke('request-permissions');
        console.log('Permission result received:', result);

        updatePermissionStatus(result);

        // Also show detailed status in console
        console.log('Microphone status:', result.microphoneStatus);
        console.log('Screen status:', result.screenStatus);

    } catch (error) {
        console.error('Error requesting permissions:', error);
        showMessage('Failed to request permissions: ' + error.message, 'error');
    }
}

// Also add a direct test for microphone access
async function testDirectMicrophoneAccess() {
    try {
        showMessage('Testing direct microphone access...', 'info');
        console.log('Testing direct microphone access...');

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('Direct microphone access granted!');
        showMessage('Microphone access granted via direct test!', 'info');

        // Stop the stream
        stream.getTracks().forEach(track => track.stop());

        // Refresh permission status
        const result = await ipcRenderer.invoke('request-permissions');
        updatePermissionStatus(result);

    } catch (error) {
        console.error('Direct microphone test failed:', error);
        showMessage('Direct microphone test failed: ' + error.message, 'error');
    }
}

function updatePermissionStatus(permissions) {
    const micElement = document.getElementById('mic-permission');
    const screenElement = document.getElementById('screen-permission');

    micElement.textContent = permissions.microphone ? 'Granted' : 'Denied';
    micElement.className = `permission-status ${permissions.microphone ? 'permission-granted' : 'permission-denied'}`;

    screenElement.textContent = permissions.screen ? 'Granted' : 'Manual Setup Required';
    screenElement.className = `permission-status ${permissions.screen ? 'permission-granted' : 'permission-denied'}`;

    // Show specific help messages
    if (!permissions.microphone) {
        showMessage('Microphone permission denied. Click "Request Permissions" to try again.', 'error');
    }

    if (!permissions.screen) {
        showMessage('Screen recording must be enabled manually: System Preferences > Security & Privacy > Screen Recording > Add this app', 'info');
    }

    if (permissions.microphone && permissions.screen) {
        showMessage('All permissions granted! You can now use both microphone and system audio capture.', 'info');
    }
}

// Device management
async function getDevices() {
    try {
        const result = await ipcRenderer.invoke('get-devices');
        if (result.success) {
            console.log('Available devices:', result.devices);
            showMessage(`Found ${result.devices.length} audio devices`, 'info');
        } else {
            showMessage('Failed to get devices: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error getting devices:', error);
        showMessage('Error getting devices: ' + error.message, 'error');
    }
}

// Transcription controls
async function startTranscription() {
    if (isTranscribing) return;

    const options = {
        enableMicrophone: document.getElementById('enableMicrophone').checked,
        enableSystemAudio: document.getElementById('enableSystemAudio').checked,
        enablePartialResults: document.getElementById('enablePartialResults').checked,
        confidenceThreshold: parseFloat(document.getElementById('confidenceThreshold').value),
        language: document.getElementById('language').value,
        modelPath: document.getElementById('modelPath').value.trim()
    };

    if (!options.enableMicrophone && !options.enableSystemAudio) {
        showMessage('Please enable at least one audio source', 'error');
        return;
    }

    try {
        startBtn.disabled = true;
        showMessage('Starting transcription...', 'info');

        const result = await ipcRenderer.invoke('start-transcription', options);

        if (result.success) {
            isTranscribing = true;
            updateControlsState();
            showMessage('Transcription started successfully', 'info');
        } else {
            showMessage('Failed to start transcription: ' + result.error, 'error');
            startBtn.disabled = false;
        }
    } catch (error) {
        console.error('Error starting transcription:', error);
        showMessage('Error starting transcription: ' + error.message, 'error');
        startBtn.disabled = false;
    }
}

async function stopTranscription() {
    if (!isTranscribing) return;

    try {
        stopBtn.disabled = true;
        showMessage('Stopping transcription...', 'info');

        const result = await ipcRenderer.invoke('stop-transcription');

        if (result.success) {
            isTranscribing = false;
            updateControlsState();
            showMessage('Transcription stopped', 'info');
        } else {
            showMessage('Failed to stop transcription: ' + result.error, 'error');
            stopBtn.disabled = false;
        }
    } catch (error) {
        console.error('Error stopping transcription:', error);
        showMessage('Error stopping transcription: ' + error.message, 'error');
        stopBtn.disabled = false;
    }
}

function updateControlsState() {
    const statusIndicator = startBtn.querySelector('.status-indicator');

    if (isTranscribing) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusIndicator.className = 'status-indicator status-running';
        startBtn.innerHTML = '<span class="status-indicator status-running"></span>Transcribing...';
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        statusIndicator.className = 'status-indicator status-stopped';
        startBtn.innerHTML = '<span class="status-indicator status-stopped"></span>Start Transcription';
    }
}

// UI helpers
function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `${type}-message`;
    messageDiv.textContent = message;

    messagesDiv.appendChild(messageDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 5000);

    // Keep only last 3 messages
    while (messagesDiv.children.length > 3) {
        messagesDiv.removeChild(messagesDiv.firstChild);
    }
}

function clearTranscriptions() {
    transcriptionLog.innerHTML = '<div class="info-message">Transcription log cleared. Ready for new transcriptions.</div>';
    transcriptionCount = 0;
}

function addTranscription(event) {
    // Remove initial message if present
    const initialMessage = transcriptionLog.querySelector('.info-message');
    if (initialMessage && transcriptionCount === 0) {
        transcriptionLog.removeChild(initialMessage);
    }

    const entry = document.createElement('div');
    entry.className = `transcription-entry ${event.source}${event.isPartial ? ' partial' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'transcription-meta';
    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    const confidencePercent = (event.confidence * 100).toFixed(1);
    const status = event.isPartial ? 'partial' : 'final';
    meta.textContent = `[${timestamp}] ${event.source} | ${confidencePercent}% confidence | ${status}`;

    const text = document.createElement('div');
    text.className = 'transcription-text';
    text.textContent = event.text;

    entry.appendChild(meta);
    entry.appendChild(text);
    transcriptionLog.appendChild(entry);

    // Auto-scroll to bottom
    transcriptionLog.scrollTop = transcriptionLog.scrollHeight;

    transcriptionCount++;

    // Keep only last 100 entries for performance
    while (transcriptionLog.children.length > 100) {
        transcriptionLog.removeChild(transcriptionLog.firstChild);
    }
}

function updateMetrics(metrics) {
    document.getElementById('latency').textContent = `${Math.round(metrics.averageLatency)}ms`;
    document.getElementById('transcriptions').textContent = metrics.transcriptionCount.toString();
    document.getElementById('confidence').textContent = `${Math.round(metrics.averageConfidence * 100)}%`;
    document.getElementById('memory').textContent = `${metrics.memoryUsage}MB`;
}

// IPC event listeners
ipcRenderer.on('permissions-status', (event, permissions) => {
    updatePermissionStatus(permissions);
});

ipcRenderer.on('transcription', (event, transcriptionEvent) => {
    addTranscription(transcriptionEvent);
});

ipcRenderer.on('transcription-error', (event, error) => {
    showMessage(`Transcription error: ${error.message}`, 'error');
    console.error('Transcription error:', error);
});

ipcRenderer.on('transcription-started', () => {
    isTranscribing = true;
    updateControlsState();
    showMessage('Transcription engine started', 'info');
});

ipcRenderer.on('transcription-stopped', () => {
    isTranscribing = false;
    updateControlsState();
    showMessage('Transcription engine stopped', 'info');
});

ipcRenderer.on('metrics-update', (event, metrics) => {
    updateMetrics(metrics);
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) {
        switch (event.key) {
            case 's':
                event.preventDefault();
                if (isTranscribing) {
                    stopTranscription();
                } else {
                    startTranscription();
                }
                break;
            case 'k':
                event.preventDefault();
                clearTranscriptions();
                break;
        }
    }
});

// Initialize metrics display
updateMetrics({
    averageLatency: 0,
    transcriptionCount: 0,
    averageConfidence: 0,
    memoryUsage: 0
});