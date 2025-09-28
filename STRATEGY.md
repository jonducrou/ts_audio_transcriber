# TypeScript Audio Transcriber - Strategy & Decisions

## Strategic Decisions

### 1. On-Device vs Cloud Processing
**Decision**: Use Picovoice Cheetah for on-device processing

**Rationale**:
- **Privacy**: No audio data leaves the device
- **Latency**: Guaranteed real-time performance without network delays
- **Reliability**: No dependency on internet connectivity
- **Cost**: No per-usage charges or API limits
- **Compliance**: Easier to meet data protection requirements

**Trade-offs**:
- Higher resource usage on client device
- Potentially lower accuracy than latest cloud models
- Requires local model downloads and updates

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
**Approach**: Stream processing with partial and final results

```typescript
// Pipeline: Audio -> Chunks -> Cheetah -> Events
AudioStream -> AudioProcessor -> CheetahEngine -> TranscriptionEvent
```

**Key Features**:
1. **Chunked Processing**: Process audio in real-time chunks
2. **Partial Results**: Emit partial transcripts for responsiveness
3. **Final Results**: Emit complete utterances with higher confidence
4. **Source Tracking**: Maintain source context throughout pipeline

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

### Picovoice Cheetah Analysis
- **Accuracy**: Comparable to cloud services for most use cases
- **Languages**: Supports English, French, German, Italian, Portuguese, Spanish
- **Performance**: Real-time processing with guaranteed latency
- **Licensing**: Free tier available, paid tiers for commercial use

### Alternative Libraries Evaluated

#### Rejected: Cloud Services
- **Google Speech-to-Text**: Excellent accuracy, but requires network
- **AWS Transcribe**: Good features, but latency and privacy concerns
- **AssemblyAI**: Modern API, but external dependency

#### Rejected: Other On-Device Solutions
- **Web Speech API**: Browser-only, limited functionality
- **OpenAI Whisper**: Batch processing, not real-time optimized
- **Mozilla DeepSpeech**: Discontinued, outdated models

### macOS Audio Landscape
- **Core Audio**: Low-level, complex to use directly
- **AVAudioEngine**: Higher-level, but limited system audio access
- **ScreenCaptureKit**: Modern, comprehensive solution for audio/video capture
- **Virtual Audio Drivers**: Soundflower-style solutions are workarounds, not recommended

## Implementation Learnings

### Dependency Management
- **screencapturekit**: Well-maintained, active development, good documentation
- **@picovoice/cheetah-node**: Official SDK, regular updates, comprehensive examples
- **TypeScript**: Version 5.0+ for latest language features

### Performance Considerations
- **Audio Buffer Size**: Balance between latency and processing efficiency
- **Memory Management**: Proper cleanup of audio streams and transcription resources
- **CPU Usage**: Monitor Cheetah processing load, implement backpressure if needed

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
2. **Picovoice Licensing**: Changes to free tier or pricing structure
3. **Performance Issues**: Real-time processing on lower-end hardware

### Mitigation Strategies
1. **Version Pinning**: Lock to specific API versions, test updates thoroughly
2. **Engine Abstraction**: Design to allow swapping transcription engines
3. **Performance Monitoring**: Built-in performance metrics and warnings

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