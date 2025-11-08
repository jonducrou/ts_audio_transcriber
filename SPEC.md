# TypeScript Audio Transcriber - Technical Specification

## Project Overview

A TypeScript library for dual-mode audio transcription on macOS designed specifically for note-taking applications. Provides both real-time 15-second snippets for live decision-making and complete high-accuracy session transcripts for 1+ hour recordings.

## Goals

### Primary Goals
1. **Dual-Mode Transcription** - Support two simultaneous transcription modes:
   - Real-time 15-second snippets for live feedback (<1s latency)
   - Complete session transcription for accurate final transcripts (1+ hours)
2. **Note-Taking Optimised** - Perfect for capturing entire meetings/sessions while providing live snippets
3. **Multi-Source Support** - Capture and transcribe both microphone input and system audio
4. **Privacy-First** - All processing happens on-device with no cloud dependencies
5. **Source Identification** - Clearly identify whether transcription originates from microphone or system audio
6. **Open Source Only** - No paid services, API keys, or usage limits

### Primary Use Cases

**Use Case 1: Note-Taking Application**
- User records 1+ hour meeting/lecture/session
- App displays 15-second live snippets for immediate context
- App uses snippets for real-time keyword detection, triggers, sentiment analysis
- After session ends, app provides complete, accurate transcript for archiving
- Transcript used for summary generation, search indexing, etc.

**Use Case 2: Live Transcription with Archive**
- Real-time captions/feedback every 15 seconds during recording
- Complete session saved and transcribed with highest accuracy
- Both modes run simultaneously without interference

### Non-Goals
- Cloud-based transcription services
- Real-time translation (only transcription)
- Speaker diarisation (identifying multiple speakers)
- Cross-platform support (macOS only for now)
- Single-mode operation (library now requires dual-mode thinking)

## Target Users

1. **Note-taking app developers** requiring live + archival transcription
2. **Meeting transcription applications** needing real-time feedback + final accuracy
3. **Accessibility tool creators** requiring real-time captioning + complete transcripts
4. **Content creators** needing both live monitoring and final transcripts

## Technical Requirements

### Platform Requirements
- **macOS 13.0+** (Ventura or later for ScreenCaptureKit)
- **macOS 15.0+** for microphone capture via ScreenCaptureKit
- **Node.js 16+**
- **Architecture**: x64 and ARM64 (Apple Silicon)

### System Permissions
- **Microphone Access** (NSMicrophoneUsageDescription)
- **Screen Recording** (for system audio capture via ScreenCaptureKit)

### Performance Requirements

**Snippet Pipeline:**
- **Latency**: <1 second after 15-second chunk completion
- **Accuracy**: >80% for clear audio (good enough for live decisions)
- **Memory**: <100MB for 10-hour session
- **CPU**: <10% on modern hardware (M1/M2/Intel i7+)

**Session Pipeline:**
- **Latency**: 5-15% of audio duration after stopping (e.g., 1 hour → 3-9 minutes)
- **Accuracy**: >95% with Whisper for clear audio
- **Memory**: <200MB (disk-based processing)
- **CPU**: Up to 80% during post-processing (acceptable)

### Audio Requirements
- **Sample Rate**: 16kHz (default, configurable)
- **Channels**: 1 (mono)
- **Bit Depth**: 16-bit PCM
- **Format**: WAV for recording, PCM for processing

### Storage Requirements
- **Audio Recording**: ~1.92 MB/minute (16kHz, mono, 16-bit PCM)
- **1-hour session**: ~115 MB
- **10-hour day**: ~1.15 GB
- **Cleanup**: Configurable (user decides to keep or delete)

## Functional Specification

### Dual-Mode Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AudioTranscriber                             │
│                   (Main Orchestrator)                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │    MacAudioCapture            │
         │  (Single Audio Source)        │
         └───────┬───────────────────────┘
                 │
                 │ (Broadcasts audio to all active components)
                 │
        ┌────────┼────────┬──────────────┐
        │        │        │              │
        ▼        ▼        ▼              ▼
  ┌─────────┐ ┌────────────────┐ ┌──────────────────┐
  │ Session │ │     Snippet    │ │    Session       │
  │Recorder │ │    Pipeline    │ │    Pipeline      │
  │ (Disk)  │ │   (Real-time)  │ │ (Post-Process)   │
  └─────────┘ └────────────────┘ └──────────────────┘
       │               │                   │
       │               ▼                   │
       │      ┌──────────────┐            │
       │      │ Vosk Engine  │            │
       │      │ 15-sec chunks│            │
       │      └──────────────┘            │
       │               │                   │
       │               ▼                   │
       │       'snippet' events            │
       │                                   │
       │ (After session stops)             │
       └───────────────────────────────────┤
                                           ▼
                                  ┌─────────────────┐
                                  │ Whisper Engine  │
                                  │ Full session    │
                                  └─────────────────┘
                                           │
                                           ▼
                                'sessionTranscript' events
```

### Core Features

#### 1. Snippet Pipeline (Real-Time)
- Buffer audio into 15-second chunks
- Process with Vosk for low latency
- Emit 'snippet' events immediately
- Optimised for speed over accuracy
- Independent enable/disable
- Configurable chunk duration

#### 2. Session Pipeline (High Accuracy)
- Record all audio to disk (WAV format)
- Process complete session after stopping
- Use Whisper for highest accuracy
- Emit 'sessionTranscript' event when complete
- Independent enable/disable
- Configurable cleanup policy

#### 3. Audio Recording
- Streaming writes to disk (no memory accumulation)
- WAV format with proper headers
- Session ID for tracking
- Configurable output directory
- Optional auto-cleanup after processing
- Crash recovery (partial recordings detected)

#### 4. Audio Capture
- Capture microphone input using ScreenCaptureKit or node-record-lpcm16
- Capture system audio output using ScreenCaptureKit
- Support simultaneous capture from multiple sources
- Handle audio device enumeration and selection
- Automatic device reconnection on failure
- Hot-plug device support

#### 5. Event System
- EventEmitter-based architecture
- Distinct event types: 'snippet', 'sessionTranscript', 'recordingStarted', etc.
- Type-safe event handlers
- Performance metrics emission
- No backward compatibility with old 'transcription' event

#### 6. Configuration
- Independent control of snippet and session pipelines
- Configurable audio parameters (sample rate, channels, buffer size)
- Engine selection per pipeline
- Confidence threshold per pipeline
- Recording configuration (output dir, format, cleanup)
- Snippet chunk duration (default 15 seconds)

### API Specification

#### Main Class: `AudioTranscriber`

```typescript
class AudioTranscriber extends EventEmitter {
  constructor(options?: TranscriberOptions)
  async start(): Promise<void>
  async stop(): Promise<void>
  async getAvailableDevices(): Promise<AudioDevice[]>
  getMetrics(): PerformanceMetrics
  isRunning(): boolean
  updateOptions(options: Partial<TranscriberOptions>): void
  getOptions(): TranscriberOptions
  getSessionId(): string | undefined
  getRecordingPath(): string | undefined

  // Type-safe event listeners
  on(event: 'snippet', listener: (event: SnippetTranscriptionEvent) => void): this
  on(event: 'sessionTranscript', listener: (event: SessionTranscriptionEvent) => void): this
  on(event: 'recordingStarted', listener: (metadata: RecordingMetadata) => void): this
  on(event: 'recordingStopped', listener: (metadata: RecordingMetadata) => void): this
  on(event: 'recordingProgress', listener: (progress: RecordingProgress) => void): this
  on(event: 'error', listener: (error: TranscriptionError) => void): this
  on(event: 'started', listener: () => void): this
  on(event: 'stopped', listener: () => void): this
  on(event: 'metrics', listener: (metrics: PerformanceMetrics) => void): this
}
```

#### Configuration Interface

```typescript
interface TranscriberOptions {
  // Audio source configuration
  enableMicrophone?: boolean;              // Default: true
  enableSystemAudio?: boolean;             // Default: false
  microphoneDeviceId?: string;             // Optional specific device
  audioConfig?: AudioStreamConfig;

  // Snippet pipeline configuration
  snippets?: {
    enabled: boolean;                      // Enable 15-second snippets
    intervalSeconds?: number;              // Default: 15
    engine: 'vosk' | 'whisper';           // Recommended: 'vosk'
    confidenceThreshold?: number;          // Default: 0.4
    engineOptions?: Record<string, any>;   // Engine-specific options
  };

  // Session pipeline configuration
  sessionTranscript?: {
    enabled: boolean;                      // Enable post-session transcription
    engine: 'vosk' | 'whisper';           // Recommended: 'whisper'
    confidenceThreshold?: number;          // Default: 0.7
    engineOptions?: Record<string, any>;   // Engine-specific options
  };

  // Recording configuration
  recording?: {
    enabled: boolean;                      // Enable audio recording
    outputDir: string;                     // Where to save recordings
    format: 'wav';                         // Audio file format (only WAV for now)
    autoCleanup?: boolean;                 // Delete after successful transcription
    maxDuration?: number;                  // Max session length (safety, seconds)
  };
}

interface AudioStreamConfig {
  sampleRate?: number;                     // Default: 16000
  channels?: number;                       // Default: 1
  bitDepth?: number;                       // Default: 16
  format?: 'pcm';                          // Default: 'pcm'
  bufferSize?: number;                     // Default: 1024
}
```

#### Event Interfaces

```typescript
// Real-time 15-second snippet
interface SnippetTranscriptionEvent {
  text: string;                            // Transcribed snippet text
  source: 'microphone' | 'system-audio';   // Audio source
  confidence: number;                      // 0.0-1.0
  timestamp: number;                       // Unix timestamp in ms
  snippetIndex: number;                    // Which snippet in session (0, 1, 2...)
  engine: 'vosk' | 'whisper';              // Engine that produced result
  type: 'snippet';                         // Discriminator
}

// Complete session transcript (after stopping)
interface SessionTranscriptionEvent {
  text: string;                            // Complete transcript text
  source: 'microphone' | 'system-audio';   // Audio source
  confidence: number;                      // Average confidence 0.0-1.0
  timestamp: number;                       // Session start timestamp
  sessionId: string;                       // Unique session identifier
  isComplete: boolean;                     // Always true in post-session mode
  engine: 'vosk' | 'whisper';              // Engine that produced result
  type: 'session';                         // Discriminator
  metadata: {
    duration: number;                      // Total audio duration (ms)
    wordCount: number;                     // Total words in transcript
    processingTime: number;                // Time taken to process (ms)
  };
}

// Recording lifecycle events
interface RecordingMetadata {
  sessionId: string;                       // Unique session identifier
  audioFilePath: string;                   // Path to recorded WAV file
  duration: number;                        // Duration in milliseconds
  fileSize: number;                        // File size in bytes
  sampleRate: number;                      // Sample rate (Hz)
  channels: number;                        // Number of channels
  startTime: number;                       // Session start timestamp
  endTime?: number;                        // Session end timestamp (when stopped)
}

interface RecordingProgress {
  sessionId: string;
  duration: number;                        // Current duration (ms)
  fileSize: number;                        // Current file size (bytes)
}

interface PerformanceMetrics {
  // Snippet pipeline metrics
  snippetCount: number;                    // Total snippets processed
  snippetAverageLatency: number;           // Average processing time (ms)
  snippetAverageConfidence: number;        // Average confidence score

  // Session pipeline metrics
  sessionTranscriptCount: number;          // Sessions processed
  sessionAverageProcessingTime: number;    // Average processing time (ms)
  sessionAverageConfidence: number;        // Average confidence score

  // System metrics
  cpuUsage: number;                        // CPU utilisation percentage
  memoryUsage: number;                     // Memory usage (MB)
  errorCount: number;                      // Total errors
  lastUpdated: number;                     // Last update timestamp
}
```

## Architecture

### Component Responsibilities

**AudioTranscriber (Main Orchestrator)**
- Lifecycle management (start/stop)
- Audio capture initialisation
- Pipeline coordination
- Event aggregation and emission
- Configuration management

**MacAudioCapture (Audio Source)**
- ScreenCaptureKit integration
- Device enumeration and selection
- Audio stream management
- Broadcasting audio to consumers
- Permission handling

**SessionRecorder (Audio Persistence)**
- Streaming WAV file writes
- Session ID generation
- File management
- Crash recovery (partial recordings)
- Metadata tracking

**SnippetPipeline (Real-Time Processing)**
- 15-second audio buffering
- Vosk engine integration
- Immediate snippet emission
- Queue management (overflow protection)
- Low-latency optimisation

**SessionPipeline (High-Accuracy Processing)**
- Post-session processing
- Whisper engine integration
- Disk-based audio reading
- Complete transcript generation
- High-accuracy optimisation

### Data Flow

**During Active Recording:**

1. **Audio Capture**
   - ScreenCaptureKit captures raw audio streams
   - Audio data formatted (16-bit PCM, 16kHz, mono)

2. **Broadcasting**
   - Audio broadcast to 3 consumers:
     - SessionRecorder (writes to disk)
     - SnippetPipeline (buffers for processing)
     - *SessionPipeline does not process during recording in post-session mode*

3. **Snippet Processing**
   - SnippetPipeline accumulates audio
   - Every 15 seconds, processes chunk with Vosk
   - Emits 'snippet' event immediately
   - Continues accumulating next chunk

4. **Recording**
   - SessionRecorder streams audio to disk
   - No memory accumulation
   - Periodic 'recordingProgress' events

**After Stopping:**

1. **Finalise Recording**
   - SessionRecorder closes WAV file
   - Emits 'recordingStopped' with metadata

2. **Session Processing**
   - SessionPipeline reads complete WAV file from disk
   - Processes entire session with Whisper
   - Emits 'sessionTranscript' event with complete transcript

3. **Cleanup**
   - If autoCleanup enabled, delete WAV file after successful transcription
   - Otherwise, preserve for user

### Directory Structure

```
ts-audio-transcriber/
├── src/
│   ├── types/
│   │   └── index.ts                      # All TypeScript interfaces
│   ├── audio/
│   │   └── capture.ts                    # ScreenCaptureKit + recorder integration
│   ├── engines/
│   │   ├── base/
│   │   │   └── engine.ts                 # Base TranscriptionEngine interface
│   │   ├── vosk/
│   │   │   └── vosk-engine.ts            # Vosk implementation (snippets)
│   │   └── whisper/
│   │       └── whisper-engine.ts         # Whisper implementation (session)
│   ├── core/
│   │   ├── audio-transcriber.ts          # Main orchestrator
│   │   ├── session-recorder.ts           # Audio recording to disk
│   │   ├── snippet-pipeline.ts           # 15-second real-time processing
│   │   └── session-pipeline.ts           # Post-session complete processing
│   └── index.ts                          # Public API exports
├── demo/
│   └── src/                              # Electron demo app
│       ├── main.js                       # Electron main process
│       ├── renderer.js                   # Electron renderer
│       └── index.html                    # Demo UI
├── recordings/                           # Default recording output directory
├── models/                               # Vosk/Whisper models (user-managed)
├── dist/                                 # Compiled TypeScript output
├── SPEC.md                               # This technical specification
├── PLAN.md                               # Implementation plan
├── DECISIONS.md                          # Architecture decisions log
└── README.md                             # User documentation
```

## Technology Stack

### Core Dependencies

1. **screencapturekit** (v1.0.22)
   - Native macOS ScreenCaptureKit wrapper
   - System audio and microphone capture
   - Low-level audio stream access

2. **vosk-koffi** (v1.1.1)
   - Open source speech recognition
   - Lightweight, real-time optimised
   - Used for snippet pipeline
   - Multi-language support

3. **whisper-node** (v1.1.1)
   - OpenAI Whisper bindings for Node.js
   - High accuracy, offline processing
   - Used for session pipeline
   - Best-in-class accuracy

4. **node-record-lpcm16** (v1.0.1)
   - Fallback microphone recording
   - Simple PCM audio capture

### Development Dependencies

- **TypeScript** (v5.0+) - Type safety and modern JavaScript
- **Electron** (v38+) - Demo application and permissions handling
- **electron-builder** (v26+) - Demo app packaging

## Quality Attributes

### Reliability
- Graceful error handling and recovery
- Automatic stream reconnection on failure
- Process cleanup on shutdown
- Comprehensive error types
- Crash recovery for partial recordings

### Performance
- **Snippet Pipeline**: <100MB memory for 10-hour session
- **Session Pipeline**: Disk-based, bounded memory usage
- Non-blocking audio processing queue
- Efficient WAV streaming writes
- Real-time performance monitoring

### Maintainability
- Full TypeScript type safety
- Clear separation of concerns
- Documented interfaces
- Extensible pipeline architecture
- Independent component testing

### Security
- On-device processing (no data leaves machine)
- No external API calls or network dependencies
- Proper permission handling
- No data persistence beyond user control
- Configurable cleanup policies

## Constraints and Limitations

### Current Limitations
1. **macOS Only** - Platform-specific implementation using ScreenCaptureKit
2. **Post-Session Only** - No progressive session transcription (by design for simplicity)
3. **No Speaker Diarisation** - Cannot identify different speakers
4. **Single Language** - Must specify language upfront (no auto-detection yet)
5. **Model Download Required** - Users must manually download Vosk/Whisper models
6. **WAV Format Only** - No compression (FLAC support could be added later)

### Known Trade-offs
- **Snippet accuracy** (80-90%) vs **session accuracy** (95%+)
- **Snippet latency** (<1s) vs **session latency** (minutes after stopping)
- **Disk space** (~115MB/hour) vs **reliable transcription**
- **CPU usage** during session processing (acceptable, happens after recording)

## Success Criteria

### Snippet Pipeline
1. ✅ Emit transcription event every ~15 seconds during recording
2. ✅ Latency < 1 second after chunk completion
3. ✅ Memory usage < 100MB for 10-hour session
4. ✅ Accuracy > 80% for clear audio

### Session Pipeline
1. ✅ Complete transcript available after session ends
2. ✅ Accuracy > 95% with Whisper for clear audio
3. ✅ Processing time < 15% of audio duration
4. ✅ Handles 1+ hour sessions without issues

### Overall System
1. ✅ Both pipelines run simultaneously without interference
2. ✅ Audio recording completes without data loss for 1+ hour sessions
3. ✅ Clear event distinction between snippets and session transcripts
4. ✅ Graceful degradation if one pipeline fails (other continues)
5. ✅ Independent pipeline configuration (can run separately or together)

## Testing Strategy

### Unit Tests (Planned)
- SessionRecorder WAV file generation
- SnippetPipeline buffering logic
- SessionPipeline file reading
- Engine initialization
- Event emission

### Integration Tests (Planned)
- End-to-end dual-pipeline operation
- 1+ hour recording and transcription
- Memory usage monitoring
- Disk space management
- Crash recovery

### Manual Testing (Current)
- Electron demo app with dual-mode display
- Real-world audio scenarios
- Permission handling
- Device hot-plugging
- Long session recording

## Documentation

### Required Documentation
- ✅ README.md - User guide and quick start with dual-mode examples
- ✅ SPEC.md - This technical specification
- ✅ PLAN.md - Implementation plan and phased strategy
- ✅ DECISIONS.md - Architecture decisions and rationale for dual-mode
- ⚠️ API.md - Detailed API reference (can be extracted from README)
- ⚠️ CONTRIBUTING.md - Contribution guidelines (planned)

## License

MIT License - Open source and free to use
