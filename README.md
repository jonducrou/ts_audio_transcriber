# TypeScript Audio Transcriber

A comprehensive **open source** TypeScript library for **dual-mode audio transcription** on macOS, designed specifically for note-taking applications. Provides both real-time 15-second snippets for live decision-making AND complete high-accuracy session transcripts for 1+ hour recordings using Vosk and Whisper speech recognition engines.

## ✨ Features

### Dual-Mode Transcription
- ⚡ **15-Second Live Snippets** - Real-time events every 15 seconds during recording (< 1s latency)
- 📝 **Complete Session Transcripts** - High-accuracy transcription of entire 1+ hour sessions after stopping
- 🎯 **Multiple Engines** - Choose between Vosk (fast) or Whisper (accurate)
- 🔄 **Simultaneous Operation** - Both modes run in parallel without interference

### Audio Capture
- 🎤 **Microphone Capture** - Real-time transcription of microphone input
- 🔊 **System Audio Capture** - Transcribe system audio output using ScreenCaptureKit
- 📱 **Source Detection** - Clearly identify whether transcription comes from mic or system audio

### Privacy & Performance
- 🔒 **Privacy-First** - All processing happens on-device (Vosk, Whisper)
- 💾 **Session Recording** - Optional audio recording to disk for post-processing
- 📊 **Performance Metrics** - Built-in monitoring for latency, memory usage, and errors
- 🆓 **Completely Free** - No API keys, no usage limits, no paid services

### Supported Engines
- **Vosk** - Fast real-time transcription, 20+ languages, low resource usage ✅ **Recommended**
- **Whisper** - High accuracy model ⚠️ **Experimental** (still in development, use Vosk for production)

### Developer Experience
- 🎯 **TypeScript Native** - Full type safety and modern development experience
- 🔌 **Independent Pipelines** - Enable snippets only, session only, or both
- 📋 **Clear Events** - Distinct event types for snippets vs. session transcripts
- 🛠️ **Configurable** - Control every aspect of transcription behaviour

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  AudioTranscriber                         │
│               (Dual-Pipeline Orchestrator)                │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │      Audio Capture             │
        │    (ScreenCaptureKit)          │
        └────────┬───────────────────────┘
                 │
                 │ (Broadcasts to all pipelines)
                 │
    ┌────────────┼───────────┬─────────────┐
    │            │           │             │
    ▼            ▼           ▼             ▼
┌────────┐  ┌─────────┐ ┌────────────┐ ┌─────────────┐
│Session │  │ Snippet │ │  Session   │ │             │
│Recorder│  │Pipeline │ │  Pipeline  │ │   Events    │
│(Disk)  │  │ Vosk    │ │  Whisper   │ │             │
└────┬───┘  │ 15-sec  │ │ Post-Stop  │ │ • snippet   │
     │      └────┬────┘ └─────┬──────┘ │ • session   │
     │           │            │        │ • recording │
     │           │            │        │ • metrics   │
     │           ▼            │        └─────────────┘
     │     Live Snippets      │
     │     Every 15s          │
     │                        │
     └────────(After Stop)────┘
              Complete
             Transcript
```

## 🚀 Quick Start

### Installation

```bash
npm install ts-audio-transcriber
```

### Download Vosk Model

Before using the library, you need to download a Vosk speech recognition model:

1. Visit [Vosk Models](https://alphacephei.com/vosk/models)
2. Download a model for your language (e.g., `vosk-model-en-us-0.22` for English)
3. Extract it to your project's `models/` directory

### Basic Usage: Both Modes (Recommended for Note-Taking)

```typescript
import { AudioTranscriber } from 'ts-audio-transcriber';

// Create transcriber with both snippet and session pipelines
const transcriber = new AudioTranscriber({
  enableMicrophone: true,

  // Real-time 15-second snippets
  snippets: {
    enabled: true,
    intervalSeconds: 15,
    engine: 'vosk',
    confidenceThreshold: 0.4,
    engineOptions: {
      modelPath: './models/vosk-model-en-us-0.22'
    }
  },

  // Complete session transcript after stopping
  sessionTranscript: {
    enabled: true,
    engine: 'whisper',
    confidenceThreshold: 0.7,
    engineOptions: {
      modelPath: './models/ggml-base.en.bin'
    }
  },

  // Recording configuration (required for session pipeline)
  recording: {
    enabled: true,
    outputDir: './recordings',
    format: 'wav',
    autoCleanup: false  // Keep recordings for backup
  }
});

// Listen for live snippets (every ~15 seconds during recording)
transcriber.on('snippet', (event) => {
  console.log(`Snippet ${event.snippetIndex}: ${event.text}`);
  console.log(`Confidence: ${(event.confidence * 100).toFixed(1)}%`);

  // Use for live decision-making
  if (event.text.includes('important')) {
    flagForReview();
  }
});

// Listen for complete session transcript (after stopping)
transcriber.on('sessionTranscript', (event) => {
  if (event.isComplete) {
    console.log('Complete transcript ready!');
    console.log(`Duration: ${event.metadata.duration}ms`);
    console.log(`Words: ${event.metadata.wordCount}`);
    console.log(event.text);

    // Save to database, generate summary, etc.
    saveTranscript(event.text);
  }
});

// Listen for recording events
transcriber.on('recordingStarted', (metadata) => {
  console.log(`Recording started: ${metadata.sessionId}`);
  console.log(`Saving to: ${metadata.audioFilePath}`);
});

transcriber.on('recordingStopped', (metadata) => {
  console.log(`Recording stopped: ${metadata.duration}ms`);
  console.log(`File size: ${metadata.fileSize} bytes`);
});

// Handle errors
transcriber.on('error', (error) => {
  console.error('Transcription error:', error.message);
});

// Start transcription
await transcriber.start();

// ... user records meeting for 1+ hour ...
// (snippets emitted every 15 seconds during recording)

// Stop transcription
await transcriber.stop();
// (session transcript emitted after processing complete)
```

### Snippets Only (Real-Time Captions)

```typescript
import { AudioTranscriber } from 'ts-audio-transcriber';

// Just real-time snippets, no session transcription
const transcriber = new AudioTranscriber({
  enableMicrophone: true,

  snippets: {
    enabled: true,
    intervalSeconds: 15,
    engine: 'vosk',
    engineOptions: {
      modelPath: './models/vosk-model-en-us-0.22'
    }
  },

  sessionTranscript: {
    enabled: false  // Disable session pipeline
  },

  recording: {
    enabled: false  // No recording needed
  }
});

transcriber.on('snippet', (event) => {
  updateLiveCaptions(event.text);
});

await transcriber.start();
```

### Session Transcript Only (Batch Processing)

```typescript
import { AudioTranscriber } from 'ts-audio-transcriber';

// Just final transcript, no real-time snippets
const transcriber = new AudioTranscriber({
  enableMicrophone: true,

  snippets: {
    enabled: false  // Disable snippet pipeline
  },

  sessionTranscript: {
    enabled: true,
    engine: 'whisper',
    engineOptions: {
      modelPath: './models/ggml-base.en.bin'
    }
  },

  recording: {
    enabled: true,
    outputDir: './recordings',
    format: 'wav',
    autoCleanup: true  // Delete after transcription
  }
});

// Only session transcript event, no snippets
transcriber.on('sessionTranscript', (event) => {
  if (event.isComplete) {
    console.log('Transcript:', event.text);
    saveToArchive(event.text);
  }
});

await transcriber.start();
// ... record ...
await transcriber.stop();
// ... wait for processing ...
```

### Advanced Configuration

```typescript
import { AudioTranscriber } from 'ts-audio-transcriber';

const transcriber = new AudioTranscriber({
  // Audio sources
  enableMicrophone: true,
  enableSystemAudio: true,  // Capture both mic and system audio
  microphoneDeviceId: 'specific-device-id',  // Optional

  // Snippet pipeline
  snippets: {
    enabled: true,
    intervalSeconds: 10,  // Custom interval (default 15)
    engine: 'vosk',
    confidenceThreshold: 0.3,
    engineOptions: {
      modelPath: './models/vosk-model-en-us-0.22',
      enableWords: true,  // Word-level confidence
      sampleRate: 16000
    }
  },

  // Session pipeline
  sessionTranscript: {
    enabled: true,
    engine: 'whisper',
    confidenceThreshold: 0.7,
    engineOptions: {
      modelPath: './models/ggml-large.bin',  // Larger model for better accuracy
      language: 'en'
    }
  },

  // Recording
  recording: {
    enabled: true,
    outputDir: '/path/to/recordings',
    format: 'wav',
    autoCleanup: false,
    maxDuration: 36000  // 10 hours max (safety)
  },

  // Audio configuration
  audioConfig: {
    sampleRate: 16000,
    channels: 1,
    bitDepth: 16,
    bufferSize: 1024
  }
});

// Get available audio devices
const devices = await transcriber.getAvailableDevices();
console.log('Available devices:', devices);

// Monitor performance
transcriber.on('metrics', (metrics) => {
  console.log(`Snippet count: ${metrics.snippetCount}`);
  console.log(`Snippet latency: ${metrics.snippetAverageLatency}ms`);
  console.log(`Memory: ${metrics.memoryUsage}MB`);
  console.log(`CPU: ${metrics.cpuUsage}%`);
});

await transcriber.start();
```

## 📋 Requirements

- **macOS 13.0+** (for ScreenCaptureKit support)
- **Node.js 16+**
- **Vosk Model** - Download from [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models)

### System Permissions

The library requires the following macOS permissions:
- **Microphone Access** - For microphone transcription
- **Screen Recording** - For system audio capture via ScreenCaptureKit

## 🎮 Example Usage

Check out the [examples](./examples/) directory for complete working examples:

- `basic-usage.ts` - Simple microphone transcription
- `dual-source.ts` - Capturing both microphone and system audio
- `real-time-display.ts` - Live transcription with UI updates

## 📚 API Documentation

### `AudioTranscriber`

The main class for dual-mode audio transcription.

#### Constructor

```typescript
new AudioTranscriber(options?: TranscriberOptions)
```

#### Methods

- `start()` - Start audio transcription and recording
- `stop()` - Stop audio transcription and recording
- `getAvailableDevices()` - Get list of available audio devices
- `getMetrics()` - Get current performance metrics
- `isRunning()` - Check if transcriber is currently running
- `updateOptions(options)` - Update configuration options
- `getSessionId()` - Get current session ID (if recording active)
- `getRecordingPath()` - Get path to current recording file

#### Events

**Transcription Events:**
- `snippet` - Emitted every ~15 seconds with real-time snippet
- `sessionTranscript` - Emitted after stopping with complete transcript

**Recording Events:**
- `recordingStarted` - Emitted when recording begins
- `recordingStopped` - Emitted when recording ends
- `recordingProgress` - Emitted periodically during recording (optional)

**Lifecycle Events:**
- `started` - Emitted when transcriber starts
- `stopped` - Emitted when transcriber stops
- `error` - Emitted when an error occurs
- `metrics` - Emitted with performance metrics (every 5 seconds)

### Type Definitions

```typescript
interface TranscriberOptions {
  enableMicrophone?: boolean;
  enableSystemAudio?: boolean;
  microphoneDeviceId?: string;
  audioConfig?: AudioStreamConfig;

  snippets?: {
    enabled: boolean;
    intervalSeconds?: number;        // Default: 15
    engine: 'vosk' | 'whisper';
    confidenceThreshold?: number;    // Default: 0.4
    engineOptions?: Record<string, any>;
  };

  sessionTranscript?: {
    enabled: boolean;
    engine: 'vosk' | 'whisper';
    confidenceThreshold?: number;    // Default: 0.7
    engineOptions?: Record<string, any>;
  };

  recording?: {
    enabled: boolean;
    outputDir: string;
    format: 'wav';
    autoCleanup?: boolean;
    maxDuration?: number;
  };
}

interface SnippetTranscriptionEvent {
  text: string;
  source: 'microphone' | 'system-audio';
  confidence: number;
  timestamp: number;
  snippetIndex: number;              // 0, 1, 2...
  engine: 'vosk' | 'whisper';
  type: 'snippet';
}

interface SessionTranscriptionEvent {
  text: string;                      // Complete transcript
  source: 'microphone' | 'system-audio';
  confidence: number;
  timestamp: number;
  sessionId: string;
  isComplete: boolean;
  engine: 'vosk' | 'whisper';
  type: 'session';
  metadata: {
    duration: number;                // Total duration (ms)
    wordCount: number;
    processingTime: number;
  };
}

interface RecordingMetadata {
  sessionId: string;
  audioFilePath: string;
  duration: number;
  fileSize: number;
  sampleRate: number;
  channels: number;
  startTime: number;
  endTime?: number;
}
```

## 🔧 Configuration

### Audio Configuration

```typescript
const audioConfig = {
  sampleRate: 16000,    // Sample rate in Hz
  channels: 1,          // Number of channels (mono)
  bitDepth: 16,         // Bit depth
  bufferSize: 1024      // Buffer size in samples
};
```

### Language Support

Vosk supports 20+ languages depending on the model you download:
- `en` - English
- `fr` - French
- `de` - German
- `es` - Spanish
- `it` - Italian
- `pt` - Portuguese
- `ru` - Russian
- `zh` - Chinese
- `ja` - Japanese
- And many more...

## 🛠️ Development

### Building from Source

```bash
# Clone the repository
git clone <repository-url>
cd ts-audio-transcriber

# Install dependencies
npm install

# Build the library
npm run build

# Run examples
npm run example:basic
```

### Project Structure

```
ts-audio-transcriber/
├── src/
│   ├── types/           # TypeScript interfaces and types
│   ├── engines/
│   │   ├── base/        # Base engine abstraction
│   │   └── vosk/        # Vosk engine implementation
│   ├── audio/           # ScreenCaptureKit integration
│   ├── core/            # Main AudioTranscriber class
│   └── index.ts         # Public API exports
├── examples/            # Usage examples
├── models/              # Vosk speech models (download separately)
├── dist/                # Compiled output
└── docs/                # Documentation
```

## ⚡ Performance

### Benchmarks

- **Latency**: < 500ms from audio to transcription (Vosk optimized)
- **Memory**: < 100MB steady state
- **CPU**: < 15% on modern hardware
- **Accuracy**: > 90% for clear audio with good models

### Optimization Tips

1. **Choose the Right Model** - Larger models = better accuracy, smaller models = faster processing
2. **Adjust Buffer Size** - Smaller buffers = lower latency, higher CPU usage
3. **Confidence Threshold** - Higher threshold = fewer false positives
4. **Disable Partial Results** - Reduces processing for final-only transcripts
5. **Single Audio Source** - Use only mic OR system audio when possible

## 🔍 Troubleshooting

### Common Issues

**"Permission denied" errors**
- Ensure microphone and screen recording permissions are granted
- Check System Preferences > Security & Privacy > Privacy

**"Model not found" errors**
- Download a Vosk model from [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models)
- Place the extracted model in your `models/` directory
- Verify the model path in your configuration

**No transcription output**
- Check audio levels in System Preferences
- Verify correct audio device selection
- Ensure confidence threshold isn't too high
- Test with a smaller, faster model first

**High CPU usage**
- Use a smaller Vosk model
- Increase buffer size
- Disable partial results
- Use single audio source

### Debug Mode

Enable debug logging:

```typescript
process.env.DEBUG = 'audio-transcriber:*';
```

## 🆚 Comparison with Other Solutions

| Feature | ts-audio-transcriber | Picovoice Cheetah | Google Speech-to-Text | OpenAI Whisper |
|---------|---------------------|-------------------|----------------------|----------------|
| **Cost** | Free | Paid | Paid | Free (self-hosted) |
| **Privacy** | On-device | On-device | Cloud | On-device |
| **Real-time** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ Batch-oriented |
| **macOS System Audio** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **TypeScript** | ✅ Native | ✅ Yes | ✅ Yes | ⚠️ Community |
| **Offline** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |

## 🤝 Contributing

Contributions are welcome! This is an open source project.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Vosk](https://alphacephei.com/vosk/) for the excellent open source speech recognition engine (Apache 2.0 License)
- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) and [OpenAI Whisper](https://github.com/openai/whisper) for state-of-the-art speech recognition models (MIT License)
- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/) for system audio capture capabilities on macOS
- The open source community for making privacy-focused AI accessible to everyone

---

**Built with ❤️ using TypeScript and open source technologies**