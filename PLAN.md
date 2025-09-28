# TypeScript Audio Transcriber - Implementation Plan

## Project Overview
Building a TypeScript library for real-time audio transcription on macOS that can capture both microphone and system audio, providing streaming transcription with source identification using **open source** technologies.

## Architecture Strategy

### Core Components
1. **Audio Capture Layer** - ScreenCaptureKit integration for macOS audio
2. **Transcription Engine** - Open source speech recognition for offline processing
3. **Event System** - Real-time streaming with EventEmitter pattern
4. **Demo Application** - Electron app for testing and permissions

### Technology Choices

#### Audio Capture: ScreenCaptureKit
- **Package**: `screencapturekit` v1.0.22
- **Rationale**:
  - Native macOS ScreenCaptureKit wrapper
  - Supports both microphone (macOS 15+) and system audio
  - Node.js compatible with TypeScript
  - Active maintenance and recent updates

#### Transcription: Open Source Solutions (TO RESEARCH)
**Requirements**:
- On-device processing (privacy + performance)
- Real-time streaming transcription capability
- TypeScript/Node.js compatibility
- No paid API dependencies
- Multi-language support preferred

**Open Source Options to Evaluate**:
- **OpenAI Whisper**: Popular, accurate, but primarily batch-oriented
- **Mozilla DeepSpeech**: Real-time capable, but development discontinued
- **Wav2Vec2**: Facebook's model, good accuracy
- **SpeechRecognition (WebKit)**: Browser-based, limited
- **Vosk**: Lightweight, real-time focused
- **Coqui STT**: Community fork of DeepSpeech

#### Alternative Rejected: Cloud/Paid Services
- **Google Cloud Speech-to-Text**: Rejected due to cloud dependency and cost
- **AWS Transcribe**: Rejected due to latency, privacy, and cost concerns
- **Picovoice Cheetah**: Rejected due to paid licensing requirement
- **AssemblyAI**: Rejected due to external API and cost requirement

## Implementation Phases

### Phase 1: Core Library Foundation ✅
- [x] Project structure with TypeScript configuration
- [x] Dependencies installation and validation
- [x] Type definitions and interfaces

### Phase 2: Audio Capture Integration
- [ ] ScreenCaptureKit wrapper implementation
- [ ] Audio device enumeration and selection
- [ ] Audio stream management and routing
- [ ] Source detection (microphone vs system audio)

### Phase 3: Transcription Engine Integration
- [ ] Picovoice Cheetah initialisation
- [ ] Real-time audio processing pipeline
- [ ] Event emission for transcription results
- [ ] Error handling and recovery

### Phase 4: Main API Implementation
- [ ] AudioTranscriber class with EventEmitter
- [ ] Start/stop functionality
- [ ] Configuration options
- [ ] Stream management

### Phase 5: Demo Application
- [ ] Electron app setup
- [ ] macOS permissions handling
- [ ] Real-time UI for transcription display
- [ ] Testing and validation

### Phase 6: Documentation and Testing
- [ ] API documentation
- [ ] Usage examples
- [ ] Integration tests
- [ ] Build scripts and CI

## API Design

### Core Interface
```typescript
interface TranscriptionEvent {
  text: string;
  source: 'microphone' | 'system-audio';
  confidence: number;
  timestamp: number;
  isPartial: boolean;
}

interface TranscriberOptions {
  enableMicrophone?: boolean;
  enableSystemAudio?: boolean;
  accessKey?: string; // Picovoice access key
  language?: string;
}

class AudioTranscriber extends EventEmitter {
  constructor(options?: TranscriberOptions)
  async start(): Promise<void>
  async stop(): Promise<void>
  async getAvailableDevices(): Promise<AudioDevice[]>
  on(event: 'transcription', listener: (event: TranscriptionEvent) => void): this
  on(event: 'error', listener: (error: Error) => void): this
}
```

## Technical Considerations

### macOS Permissions
- NSMicrophoneUsageDescription required for microphone access
- System audio capture requires ScreenCaptureKit permissions
- Electron app will handle permission prompts

### Audio Pipeline
1. ScreenCaptureKit captures raw audio streams
2. Audio data is processed and formatted for Cheetah
3. Cheetah processes audio in real-time chunks
4. Transcription events are emitted with source identification
5. Both partial and final transcripts are provided

### Error Handling
- Device availability checking
- Permission denial handling
- Audio stream interruption recovery
- Transcription engine failure recovery

## Directory Structure
```
ts-audio-transcriber/
├── src/
│   ├── types/           # TypeScript interfaces
│   ├── audio/           # Audio capture implementation
│   ├── transcription/   # Picovoice integration
│   ├── core/            # Main AudioTranscriber class
│   └── index.ts         # Public API exports
├── demo/                # Electron demo app
├── docs/                # API documentation
├── tests/               # Unit and integration tests
└── dist/                # Compiled output
```

## Risk Mitigation

### Audio Capture Reliability
- Fallback mechanisms for device failures
- Robust stream management
- Device hot-plugging support

### Transcription Accuracy
- Confidence scoring for quality assessment
- Language detection and switching
- Audio quality monitoring

### Platform Compatibility
- macOS version requirements (13+ for ScreenCaptureKit)
- Node.js version compatibility (16+)
- Electron compatibility testing

## Success Criteria
1. Real-time transcription with <100ms latency
2. Clear source identification (mic vs system audio)
3. Robust error handling and recovery
4. Simple, intuitive API for developers
5. Comprehensive documentation and examples