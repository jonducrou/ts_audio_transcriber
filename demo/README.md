# Electron Demo Application

This demo application showcases the TypeScript Audio Transcriber library with a user-friendly interface for testing real-time audio transcription on macOS.

## Features

- 🎤 **Microphone Capture Control** - Toggle microphone transcription on/off
- 🔊 **System Audio Capture** - Capture and transcribe system audio output
- ⚡ **Real-time Display** - Live transcription results with source identification
- 📊 **Performance Monitoring** - Real-time metrics display (latency, memory, confidence)
- 🔒 **Permission Management** - Handle macOS microphone and screen recording permissions
- 🎯 **Configurable Settings** - Adjust confidence threshold, language, and model path
- 🎨 **Modern UI** - Beautiful glassmorphism design with smooth animations

## Prerequisites

1. **macOS 13.0+** (required for ScreenCaptureKit)
2. **Vosk Model** - Download from [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models)

## Setup

1. **Download a Vosk model** (required before first run):
   ```bash
   # Example: Download English model
   cd models/
   wget https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip
   unzip vosk-model-en-us-0.22.zip
   ```

2. **Run the demo**:
   ```bash
   npm run demo
   ```

## First Time Setup

When you first run the demo:

1. **Grant Permissions**: Click "Request Permissions" to grant:
   - Microphone access (for microphone transcription)
   - Screen recording access (for system audio capture)

2. **Configure Settings**:
   - Enable your desired audio sources
   - Adjust confidence threshold (0.0-1.0)
   - Verify model path points to your downloaded Vosk model

3. **Start Transcription**: Click "Start Transcription" to begin

## Interface Overview

### Control Panel (Left Side)

**Permissions Section**
- Shows current permission status
- Button to request permissions

**Configuration Section**
- Audio source toggles (microphone/system audio)
- Confidence threshold slider
- Language selection
- Model path configuration

**Controls Section**
- Start/Stop transcription buttons
- Refresh devices
- Clear transcription log

**Performance Metrics**
- Average latency
- Total transcriptions processed
- Average confidence score
- Memory usage

### Transcription Area (Right Side)

**Live Transcription Log**
- Real-time transcription results
- Source identification (microphone vs system audio)
- Confidence scores and timestamps
- Partial vs final results indication
- Auto-scrolling with history retention

## Keyboard Shortcuts

- `Cmd/Ctrl + S` - Start/Stop transcription
- `Cmd/Ctrl + K` - Clear transcription log

## Troubleshooting

### "Permission denied" errors
- Ensure you've granted microphone and screen recording permissions
- Check System Preferences > Security & Privacy > Privacy
- Restart the app after granting permissions

### "Model not found" errors
- Download a Vosk model to the `models/` directory
- Verify the model path in configuration matches your downloaded model
- Ensure the model directory structure is correct

### No transcription output
- Check audio levels in System Preferences
- Verify correct audio device selection
- Try lowering the confidence threshold
- Test with a smaller, faster model first

### High CPU/Memory usage
- Use a smaller Vosk model
- Disable partial results if not needed
- Use single audio source when possible

## Model Recommendations

**For Testing**: `vosk-model-small-en-us-0.15` (~40MB)
- Fast and lightweight
- Good for development and testing

**For Production**: `vosk-model-en-us-0.22` (~50MB)
- Balanced accuracy and performance
- Recommended for most use cases

**For High Accuracy**: `vosk-model-en-us-0.22-lgraph` (~130MB)
- Best accuracy
- Higher resource usage

## Technical Details

The demo application demonstrates:
- Electron main process IPC communication
- macOS permission handling via Electron
- Real-time audio processing and transcription
- Performance monitoring and metrics collection
- Error handling and recovery
- Modern web UI with real-time updates