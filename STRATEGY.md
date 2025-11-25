# TypeScript Audio Transcriber - Strategy & Decisions

## Strategic Decisions

### 1. On-Device vs Cloud Processing
**Decision**: Use Vosk for on-device processing (updated from Picovoice Cheetah)

**Rationale**:
- **Privacy**: No audio data leaves the device
- **Latency**: Guaranteed real-time performance without network delays
- **Reliability**: No dependency on internet connectivity
- **Cost**: Completely free and open source (no API keys or limits)
- **Compliance**: Easier to meet data protection requirements
- **Dual-mode**: Supports both real-time snippets and full session transcription

**Trade-offs**:
- Higher resource usage on client device
- Requires local model downloads (~100MB-1.8GB depending on accuracy needs)
- Accuracy varies by model size (80-95% for clear audio)

### 2. macOS-Only Focus
**Decision**: Target macOS exclusively for initial release

**Rationale**:
- ScreenCaptureKit is macOS-specific and provides best system audio capture
- Cleaner implementation without cross-platform complexity
- Faster development and testing cycles
- Can expand to other platforms later

**Future Expansion**:
- Windows: Consider Windows.Graphics.Capture API
- Linux: PulseAudio/ALSA integration options

### 3. TypeScript-First Development
**Decision**: Build with TypeScript from the ground up

**Rationale**:
- Better developer experience with type safety
- Easier maintenance and refactoring
- Industry standard for modern Node.js libraries
- Better IDE support and documentation generation

### 4. EventEmitter Pattern for Real-Time Data
**Decision**: Use Node.js EventEmitter for streaming transcription

**Rationale**:
- Natural fit for real-time streaming data
- Familiar pattern for Node.js developers
- Allows multiple listeners for transcription events
- Easy to extend with additional event types

## Technical Strategy

### Audio Capture Architecture
**Approach**: Wrapper around ScreenCaptureKit with abstraction layer

```typescript
// Clean abstraction over native audio capture
interface AudioCapture {
  startMicrophoneCapture(): Promise<AudioStream>
  startSystemAudioCapture(): Promise<AudioStream>
  getAvailableDevices(): Promise<AudioDevice[]>
}
```

**Benefits**:
- Easier testing with mock implementations
- Future platform expansion possible
- Clear separation of concerns

### Transcription Pipeline Design
**Approach**: Dual-mode stream processing with snippets and session transcripts

```typescript
// Dual Pipeline Architecture:
// 1. Snippet Pipeline: Audio -> 15-sec chunks -> Vosk -> 'snippet' events (real-time)
// 2. Session Pipeline: Audio -> Disk -> Vosk -> 'sessionTranscript' event (post-session)
```

**Key Features**:
1. **Snippet Pipeline**: 15-second chunks processed in real-time (<1s latency)
2. **Session Pipeline**: Complete session transcription after recording stops
3. **Parallel Operation**: Both pipelines run simultaneously without interference
4. **Source Tracking**: Maintain source context (microphone vs system-audio) throughout

### Error Handling Strategy
**Approach**: Graceful degradation with comprehensive error types

```typescript
enum TranscriptionErrorType {
  PERMISSION_DENIED = 'permission_denied',
  DEVICE_NOT_FOUND = 'device_not_found',
  AUDIO_CAPTURE_FAILED = 'audio_capture_failed',
  TRANSCRIPTION_ENGINE_ERROR = 'transcription_engine_error',
  INVALID_CONFIGURATION = 'invalid_configuration'
}
```

**Recovery Mechanisms**:
- Automatic retry for temporary failures
- Fallback to single source if dual capture fails
- Clear error reporting to application layer

## Research Findings

### ScreenCaptureKit Capabilities (2025)
- **System Audio**: Full system audio capture with ScreenCaptureKit
- **Microphone**: Microphone capture requires macOS 15+
- **Quality**: High-quality audio streams with configurable formats
- **Permissions**: Requires explicit user consent via system dialogs

### Vosk Engine Analysis
- **Accuracy**: 80-95% depending on model size (comparable to cloud for clear audio)
- **Languages**: Supports 20+ languages including English, French, German, Spanish, etc.
- **Performance**: Real-time streaming with <1s latency per 15-second chunk
- **Licensing**: Completely free and open source (Apache 2.0)
- **Models**: User downloads from alphacephei.com/vosk/models

### Alternative Libraries Evaluated

#### Rejected: Cloud Services
- **Google Speech-to-Text**: Excellent accuracy, but requires network
- **AWS Transcribe**: Good features, but latency and privacy concerns
- **AssemblyAI**: Modern API, but external dependency

#### Rejected: Other On-Device Solutions
- **Web Speech API**: Browser-only, limited functionality
- **OpenAI Whisper**: Integration issues in Node.js, batch-oriented
- **Mozilla DeepSpeech**: Discontinued, outdated models
- **Coqui STT**: No Apple Silicon support (darwin-arm64)
- **Picovoice Cheetah**: Requires paid licensing for commercial use

### macOS Audio Landscape
- **Core Audio**: Low-level, complex to use directly
- **AVAudioEngine**: Higher-level, but limited system audio access
- **ScreenCaptureKit**: Modern, comprehensive solution for audio/video capture
- **Virtual Audio Drivers**: Soundflower-style solutions are workarounds, not recommended

## Implementation Learnings

### Dependency Management
- **vosk-koffi**: Native Vosk bindings for Node.js, real-time streaming support
- **node-record-lpcm16**: Sox-based microphone capture with proper gain handling
- **macos-system-audio-recorder**: Raw PCM streaming for system audio capture
- **TypeScript**: Version 5.0+ for latest language features

### Performance Considerations
- **Audio Buffer Size**: 15-second chunks balance latency and transcription quality
- **Memory Management**: Streaming WAV writes to disk, bounded snippet buffer (~500KB)
- **CPU Usage**: ~10% during recording, up to 80% during post-session processing

### Development Approach
- **Test-Driven**: Start with interfaces and mocks for easier testing
- **Incremental**: Build and test each component independently
- **Documentation**: Generate docs from TypeScript interfaces

## Future Strategy

### Short-Term (v1.0)
- Complete core functionality
- Electron demo application
- Basic documentation and examples
- npm package publication

### Medium-Term (v2.0)
- Additional language support
- Advanced audio preprocessing
- Plugin architecture for custom transcription engines
- Performance optimizations

### Long-Term (v3.0+)
- Cross-platform support (Windows, Linux)
- Integration with popular frameworks (React, Vue, etc.)
- Cloud transcription fallback options
- Advanced features (speaker diarization, keyword detection)

## Risk Assessment

### High-Impact Risks
1. **macOS API Changes**: ScreenCaptureKit evolution could break compatibility
2. **Vosk Model Quality**: Model accuracy varies; users may need guidance on model selection
3. **Performance Issues**: Real-time processing on lower-end hardware

### Mitigation Strategies
1. **Version Pinning**: Lock to specific API versions, test updates thoroughly
2. **Engine Abstraction**: Design to allow swapping transcription engines
3. **Performance Monitoring**: Built-in performance metrics and warnings
4. **Durability Features**: Graceful error handling, reconnection logic, recording rotation

### Low-Impact Risks
1. **Dependency Updates**: Breaking changes in npm packages
2. **Node.js Compatibility**: New Node.js versions breaking native modules
3. **User Adoption**: Limited audience due to macOS-only constraint

## Success Metrics

### Technical Metrics
- **Latency**: <100ms from audio to transcription event
- **Accuracy**: >95% word accuracy for clear audio
- **Reliability**: <1% crash rate during normal operation
- **Performance**: <10% CPU usage on modern hardware

### Developer Experience Metrics
- **API Simplicity**: <10 lines of code for basic usage
- **Documentation Quality**: Complete examples for all major use cases
- **Type Safety**: 100% TypeScript coverage with no `any` types
- **Installation**: Single `npm install` with no additional setup required

---

## Durability Strategy

### Overview
The library must be resilient to real-world conditions: device changes, rapid lifecycle operations, and runtime configuration changes. This section documents the approach to durability.

### 1. Device Resilience

**Goal**: Gracefully handle device disconnection, preserve transcription data, and provide consuming software with enough context to decide next steps.

**Approach**:
- On device disconnect: stop recording cleanly, emit `deviceDisconnected` event with full context
- Attempt smart reconnection with exponential backoff (1s → 2s → 4s → 8s → 16s, max 5 attempts)
- Emit `reconnectionAttempt`, `reconnectionSuccess`, or `reconnectionFailed` events
- `reconnectionFailed` includes recommendation field (`manual_restart`, `check_device`, `check_permissions`)

**Events**:
```typescript
// Emitted when device disconnects
interface DeviceDisconnectedEvent {
  source: AudioSource;
  reason: 'process_exit' | 'error' | 'device_removed' | 'permission_revoked' | 'unknown';
  error?: Error;
  timestamp: number;
  willAttemptReconnect: boolean;
  sessionId?: string;           // For consumer context
  durationAtDisconnect?: number; // For consumer context
}

// Emitted during reconnection attempts
interface ReconnectionAttemptEvent {
  source: AudioSource;
  attemptNumber: number;
  maxAttempts: number;
  delayMs: number;
  timestamp: number;
}

// Emitted after all attempts exhausted
interface ReconnectionFailedEvent {
  source: AudioSource;
  totalAttempts: number;
  elapsedMs: number;
  lastError?: Error;
  timestamp: number;
  recommendation: 'manual_restart' | 'check_device' | 'check_permissions';
}
```

**Configuration**:
```typescript
interface ReconnectionConfig {
  enabled: boolean;        // default: true
  maxAttempts: number;     // default: 5
  baseDelayMs: number;     // default: 1000
  maxDelayMs: number;      // default: 30000
  backoffMultiplier: number; // default: 2
}
```

### 2. Rapid Start/Stop Handling

**Goal**: Eliminate race conditions and ensure no data loss during rapid lifecycle operations.

**Approach**:
- Add `_isStopping` flag to all pipelines (SnippetPipeline, SessionPipeline)
- Use Promise-based coordination instead of polling
- `stop()` returns a Promise that resolves when fully complete
- `start()` awaits pending `stop()` Promise (with 5s timeout)
- Concurrent `stop()` calls return the same Promise

**Key Invariants**:
- Session transcript is always processed before cleanup
- `stopped` event always emits, even if cleanup fails
- No audio processing during shutdown (check both `_isRunning` and `_isStopping`)

### 3. Recording Rotation

**Goal**: Change recording location without stopping transcription.

**Approach**:
- New method: `rotateRecording(newOutputDir?: string): Promise<RecordingRotationResult>`
- Behavior:
  1. Finalize current WAV file
  2. Emit `recordingStopped` for completed segment
  3. Process session transcript for completed segment
  4. Start new recording at new location (new session ID)
  5. Emit `recordingStarted` and `recordingRotated`
- Snippet pipeline continues uninterrupted throughout

**Result**:
```typescript
interface RecordingRotationResult {
  previousSessionId: string;
  newSessionId: string;
  completedFilePath: string;
  timestamp: number;
}
```

### 4. Testing Strategy

**Goal**: Comprehensive testing of durability features without requiring real audio devices.

**Approach**:
- **Unit tests (Jest + mocks)**: Test logic in isolation
  - ReconnectionManager exponential backoff
  - Pipeline state transitions
  - Recording rotation sequence
- **Integration tests**: Test real-world scenarios
  - Simulated device disconnect via mock stream
  - Rapid start/stop/start sequences
  - Recording rotation with real file I/O

**Test Structure**:
```
tests/
├── mocks/
│   ├── audio-stream.mock.ts
│   ├── audio-capture.mock.ts
│   └── vosk-engine.mock.ts
├── unit/
│   ├── reconnection-manager.test.ts
│   ├── audio-transcriber.test.ts
│   └── *-pipeline.test.ts
└── integration/
    ├── device-disconnect.test.ts
    ├── rapid-start-stop.test.ts
    └── recording-rotation.test.ts
```

### 5. Success Criteria

| Feature | Criteria |
|---------|----------|
| Device disconnect | `deviceDisconnected` event emitted with reason, session preserved |
| Reconnection | Exponential backoff works, `reconnectionFailed` emitted after max attempts |
| Rapid start/stop | No race conditions, no data loss, concurrent calls handled |
| Recording rotation | Previous file finalized, new session started, snippets uninterrupted |
| Test coverage | >80% coverage on durability code paths |