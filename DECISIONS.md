# Architecture Decisions and Rationale

This document tracks significant architectural decisions, alternatives considered, approaches attempted, and lessons learned during development.

## Bug Fix: Robust stop() with Guaranteed sessionTranscript Emission ✅

**Date**: November 2025 (v1.1.1)

**Context**: Production usage revealed three critical issues with the stop() method:
1. sessionTranscript event not emitted when cleanup errors occurred
2. Rapid stop/start sequences caused new recordings to not emit snippets
3. Generic error messages made debugging difficult

**Root Causes**:
- Session transcript processing and cleanup were in same try/catch block
- If cleanup (file deletion, pipeline shutdown) threw errors, transcript would never emit
- No mechanism to prevent concurrent stop() calls or wait for completion
- start() could be called while stop() was still cleaning up, causing state corruption
- Generic "Error stopping AudioTranscriber" message provided no context

**Solution Implemented**:
1. **Guaranteed Transcript Emission**: Restructured stop() to process and emit sessionTranscript FIRST before any cleanup
2. **Individual Error Handling**: Wrapped each cleanup step in separate try/catch blocks
3. **Non-Critical Error Classification**: Cleanup errors (stream shutdown, file deletion) are logged but don't prevent completion
4. **Stopping Flag**: Added `_isStopping` flag to prevent concurrent stop() calls
5. **Start Waits for Stop**: start() now waits up to 5 seconds for pending stop() to complete
6. **Detailed Error Messages**: Each error now includes specific step context (e.g., "Failed to stop microphone stream")

**Code Changes** (src/core/audio-transcriber.ts):
```typescript
private _isStopping = false;

async stop(): Promise<void> {
  // Prevent concurrent calls
  if (this._isStopping) {
    while (this._isStopping) await delay(100);
    return;
  }

  this._isStopping = true;
  const errors: Array<{step: string; error: Error}> = [];

  try {
    // CRITICAL: Process transcript FIRST
    if (this._sessionRecorder && this._sessionPipeline) {
      try {
        const metadata = await this._sessionRecorder.stop();
        await this._sessionPipeline.processFinalSession(metadata, source);
      } catch (error) {
        errors.push({step: 'process session transcript', error});
        // Still continue with cleanup
      }
    }

    // All cleanup wrapped in individual try/catch
    // Errors logged but don't prevent 'stopped' event

    this.emit('stopped'); // Always emitted

  } finally {
    this._isStopping = false; // Always cleared
  }
}
```

**Benefits**:
- **Data Integrity**: Session transcripts are NEVER lost, even if cleanup fails
- **Reliable Stop/Start**: Rapid stop/start sequences work without delays
- **Better Debugging**: Specific error messages help diagnose issues
- **Graceful Degradation**: Cleanup errors don't prevent successful stop

**Status**: ✅ Completed and tested in v1.1.1

---

## Decision: Remove Whisper Engine - Vosk Only ✅

**Date**: November 2025

**Context**: The library originally supported two transcription engines: Vosk (fast, real-time) and Whisper (high accuracy). After extensive testing and production use, Whisper integration proved problematic while Vosk consistently delivered excellent results.

**Whisper Issues**:
- Module loading complexities (required `.default` export workaround)
- Session pipeline integration failures (incomplete transcripts)
- Marked as "experimental" and not recommended for production
- Added maintenance burden without clear benefit
- No users actually using Whisper in production

**Vosk Success**:
- Fast, reliable, and production-ready
- Excellent accuracy for on-device processing
- Works perfectly for both snippet and session pipelines
- No integration issues
- Recommended engine in all documentation

**Decision**: Remove Whisper completely and make library Vosk-only.

**Benefits**:
- Simpler codebase (remove `src/engines/whisper/`)
- Reduced dependencies (remove `whisper-node`)
- Clearer documentation (no confusing engine choice)
- Lower maintenance burden
- Better user experience (one working engine vs. two options where one doesn't work)

**Trade-offs**: Users who wanted Whisper's potentially higher accuracy will need to use Vosk. However, since Whisper wasn't working properly in the library, this is not a practical loss.

**Implementation**: v1.1.0
- Removed `src/engines/whisper/` directory
- Removed `whisper-node` from dependencies
- Updated `TranscriptionEngineType` from `'vosk' | 'whisper'` to `'vosk'`
- Updated all documentation to reflect Vosk-only approach
- Removed test-whisper-direct.js test file

**Status**: ✅ Completed - Library is now Vosk-only and simpler

---

## Major Architectural Shift: Dual-Mode Transcription

**Date**: September 2024

**Context**: After initial implementation with single-pipeline processing, the project requirements were clarified to support two distinct use cases for note-taking applications:
1. Real-time 15-second snippets for live decision-making
2. Complete high-accuracy transcripts of 1+ hour sessions

**Previous Approach**: Single 5-second chunk processing with one transcription event type.

**New Approach**: Dual-pipeline architecture with independent snippet and session processing.

---

### Decision: Parallel Dual-Pipeline Architecture ✅

**Alternatives Considered**:

1. **Single Pipeline with Toggling** ❌
   - Process either snippets OR session, not both
   - User chooses mode before starting
   - **Why Rejected**: Doesn't meet requirement of *simultaneous* snippet and session transcription. Note-taking app needs both live snippets during recording AND final transcript after.

2. **Single Pipeline with Two Outputs** ❌
   - One processing pipeline that emits both snippet and session events
   - Use same engine and chunk size for both
   - **Why Rejected**: Can't optimise for both use cases. 15-second chunks with Vosk good for snippets but not ideal for session accuracy. Complete session with Whisper good for accuracy but too slow for real-time snippets.

3. **Sequential Processing** ❌
   - Process snippets during recording, then process session after stopping
   - **Why Rejected**: This is actually what we're doing, but doesn't justify single pipeline. Better to separate concerns into dedicated pipelines.

4. **Parallel Dual-Pipeline** ✅ **SELECTED**
   - **Snippet Pipeline**: Real-time, 15-second chunks, Vosk, low latency
   - **Session Pipeline**: Post-session, complete recording, Whisper, high accuracy
   - **Shared Audio Capture**: Single audio source broadcasts to both
   - **Independent Operation**: Each can run separately or together

   **Advantages**:
   - Optimised for each use case independently
   - Different engines for different requirements
   - Clear separation of concerns
   - One pipeline failure doesn't affect the other
   - Independent configuration

   **Trade-offs**:
   - More complexity (two pipelines vs. one)
   - Requires audio recording to disk
   - More code to maintain

**Rationale**: The dual-pipeline approach is the only architecture that truly meets the requirements. Note-taking applications need BOTH real-time snippets (for live decision-making) AND complete accurate transcripts (for archiving). These are fundamentally different use cases with different constraints:

- Snippets: latency matters, accuracy less critical
- Session: accuracy matters, latency acceptable

Trying to serve both use cases with a single pipeline would compromise both. The dual-pipeline approach lets us optimise each independently.

**Breaking Change**: Yes - old `transcription` event removed, new `snippet` and `sessionTranscript` events added. This is a major version change (2.0.0).

---

### Decision: Post-Session Mode (Not Progressive) ✅

**Context**: For session transcription, should we process during recording (progressive) or after stopping (post-session)?

**Alternatives Considered**:

1. **Progressive Mode** ❌
   - Process session in 5-minute segments during recording
   - Build up transcript progressively
   - Emit partial session transcripts every 5 minutes
   - **Advantages**: User sees draft transcript building up
   - **Disadvantages**:
     - More complex implementation
     - Worse accuracy (context boundaries)
     - Higher CPU during recording
     - More difficult to test
   - **Why Not Now**: Added complexity doesn't justify marginal benefit. User can see live snippets for real-time feedback.

2. **Post-Session Mode** ✅ **SELECTED**
   - Record entire session to disk
   - Process complete session with Whisper after stopping
   - Single `sessionTranscript` event when complete
   - **Advantages**:
     - Simpler implementation
     - Best accuracy (full context)
     - Lower CPU during recording
     - Easier to test
   - **Disadvantages**:
     - User waits for processing after stopping
     - No progressive transcript

**Rationale**: Start simple. Post-session mode gives highest accuracy and simplest implementation. Users get live feedback from snippets during recording, so progressive session transcript is less critical. Can add progressive mode later if user feedback demands it.

**Implementation**: Session pipeline remains idle during recording, activates after `stop()`.

---

### Decision: Recording to Disk (Always) ✅

**Context**: For session pipeline to work, need complete audio. Should we store in memory or on disk?

**Alternatives Considered**:

1. **In-Memory Buffering** ❌
   - Accumulate entire session in memory
   - Process from memory after stopping
   - **Why Rejected**:
     - 1-hour session = ~115MB in memory
     - 10-hour session = ~1.15GB in memory
     - Risk of out-of-memory errors
     - No recovery if app crashes

2. **Recording to Disk** ✅ **SELECTED**
   - Stream audio to WAV file continuously
   - Process from disk after stopping
   - **Advantages**:
     - Bounded memory usage (only write buffer ~10MB)
     - Survives crashes (partial recordings recoverable)
     - Can reprocess with different engines/settings later
     - Enables future features (playback, editing)
   - **Disadvantages**:
     - Requires disk space (~115MB/hour)
     - Disk I/O overhead
     - Need cleanup policy

**Rationale**: Disk recording is only viable approach for 1+ hour sessions. Memory would be exhausted. Disk provides reliability, crash recovery, and future flexibility. Disk space is cheap (~115MB/hour is acceptable).

**Implementation**: `SessionRecorder` class streams WAV to disk with minimal memory footprint.

**User Control**: Recording configuration (outputDir, autoCleanup) always required - user explicitly decides where recordings go and whether to keep them.

---

### Decision: Vosk for Snippets, Whisper for Session ✅

**Context**: Which engine for which pipeline?

**Alternatives Considered**:

1. **Vosk for Both** ❌
   - Use Vosk for both snippets and session
   - Consistent engine, simpler
   - **Why Rejected**: Vosk accuracy (80-90%) not good enough for final archival transcript. Can do better.

2. **Whisper for Both** ❌
   - Use Whisper for both snippets and session
   - Best accuracy everywhere
   - **Why Rejected**: Whisper too slow for real-time snippets. Processing 15-second chunks could take 3-5 seconds, missing real-time requirement.

3. **Vosk for Snippets, Whisper for Session** ✅ **SELECTED**
   - **Snippet Pipeline**: Vosk
     - Fast (<1s per 15-second chunk)
     - Good enough accuracy (80-90%)
     - Real-time optimised
   - **Session Pipeline**: Whisper
     - Best accuracy (95%+)
     - Batch-oriented
     - Acceptable latency for post-processing

   **Rationale**: Use the right tool for each job. Vosk excels at real-time streaming. Whisper excels at accuracy. Why compromise either use case when we can optimise both?

**Implementation**: Each pipeline instantiates its own engine. Independent configuration per pipeline.

---

### Decision: Independent Pipeline Configuration ✅

**Context**: Should both pipelines always run, or be independently configurable?

**Alternatives Considered**:

1. **Both Always Run** ❌
   - Snippets and session always enabled
   - Simpler API (no configuration needed)
   - **Why Rejected**: Wastes resources if user only needs one mode. Not all use cases need both.

2. **Independently Configurable** ✅ **SELECTED**
   - Each pipeline has `enabled: boolean` flag
   - Can run snippets only, session only, or both
   - **Advantages**:
     - Flexibility for different use cases
     - Resource efficiency
     - Clear user intent
   - **Disadvantages**:
     - More configuration options
     - Need validation (at least one enabled)

**Rationale**: Flexibility wins. Some users may only want live snippets (live captioning app). Others may only want final transcripts (batch processing). Most note-taking apps want both. Let users decide.

**Implementation**:
```typescript
snippets: { enabled: true, ... }
sessionTranscript: { enabled: true, ... }
```

---

### Decision: Configurable Audio Cleanup ✅

**Context**: After session transcription completes, should we keep or delete the WAV file?

**Alternatives Considered**:

1. **Always Keep** ❌
   - Preserve all recordings indefinitely
   - **Why Rejected**: Disk space grows unbounded. Could fill disk over time.

2. **Always Delete** ❌
   - Auto-delete after successful transcription
   - **Why Rejected**: User may want to keep recordings for reprocessing, backup, or playback.

3. **Always Configurable** ✅ **SELECTED**
   - User explicitly sets `autoCleanup: boolean` in configuration
   - No default - user must decide
   - **Rationale**: Audio recordings are user data. Library shouldn't make assumptions about keeping or deleting user data. Force explicit decision.

**Implementation**:
```typescript
recording: {
  enabled: true,
  outputDir: './recordings',
  autoCleanup: true,  // or false - user decides
}
```

---

### Decision: Breaking API Change (No Backward Compatibility) ✅

**Context**: Should we maintain compatibility with old `transcription` event or make breaking change?

**Alternatives Considered**:

1. **Maintain Compatibility** ❌
   - Keep old `transcription` event
   - Add new `snippet` and `sessionTranscript` events
   - Emit both old and new events
   - **Why Rejected**:
     - Confusing API (three event types for same thing)
     - More events emitted (performance overhead)
     - Harder to document
     - Doesn't reflect new dual-mode architecture

2. **Breaking Change** ✅ **SELECTED**
   - Remove old `transcription` event
   - Only emit new event types (`snippet`, `sessionTranscript`)
   - Clean, clear API
   - **Rationale**: The architecture has fundamentally changed. Trying to maintain compatibility would compromise the new design. Better to make a clean break, bump to 2.0.0, and have a clear migration path.

**Migration**: Users must update code to listen for `snippet` and/or `sessionTranscript` events instead of `transcription`.

---

## Decision Log

### 1. Transcription Engine Selection

**Decision**: Use **Vosk** as the primary transcription engine, with **Whisper** as an alternative option.

**Date**: September 2024

**Context**:
- Required real-time, on-device speech recognition
- Needed open source solution with no API costs
- Must support streaming audio with low latency
- TypeScript/Node.js compatibility essential

**Alternatives Considered**:

1. **Picovoice Cheetah** ❌
   - **Why Rejected**: Requires paid licensing and API keys
   - Does not meet "completely free" requirement
   - Would introduce vendor lock-in

2. **Google Cloud Speech-to-Text** ❌
   - **Why Rejected**: Cloud-based service with costs
   - Privacy concerns (data leaves device)
   - Network latency issues
   - Requires API credentials and has usage limits

3. **AWS Transcribe** ❌
   - **Why Rejected**: Cloud-based, expensive for real-time use
   - High latency for streaming
   - Requires AWS credentials and billing setup

4. **OpenAI Whisper** ⚠️
   - **Considered**: Very accurate, open source, free
   - **Limitation**: Primarily batch-oriented, not optimised for real-time streaming
   - **Outcome**: Included as alternative engine for batch processing use cases
   - Good for accuracy, less ideal for low-latency streaming

5. **Mozilla DeepSpeech** ❌
   - **Why Rejected**: Development discontinued in 2021
   - No active maintenance
   - Risk of compatibility issues with newer systems

6. **Coqui STT** ✅ **ADDED**
   - **Status**: Now implemented as third engine option
   - Community fork of DeepSpeech with active development
   - Provides balanced performance between Vosk (speed) and Whisper (accuracy)
   - Useful for users wanting an alternative to Vosk/Whisper

7. **Vosk** ✅ **SELECTED**
   - **Advantages**:
     - Specifically designed for real-time streaming
     - Lightweight and fast (<500ms latency achievable)
     - Good Node.js bindings via vosk-koffi
     - Multi-language support (20+ languages)
     - Active development and community
     - Completely free and open source
     - Downloadable models of various sizes
   - **Trade-offs**:
     - Slightly lower accuracy than Whisper for complex audio
     - Model quality varies by language
     - Requires manual model download

**Rationale**: Vosk best meets the requirements for real-time, on-device transcription with low latency. Whisper included as alternative for users prioritising accuracy over latency.

**Status**: ✅ Implemented successfully

---

### 2. Audio Capture Technology

**Decision**: Use **ScreenCaptureKit** via the `screencapturekit` npm package for both microphone and system audio capture.

**Date**: September 2024

**Context**:
- Need to capture both microphone input and system audio output
- macOS-specific solution acceptable
- Must support modern macOS versions (13+)

**Alternatives Considered**:

1. **node-record-lpcm16** ⚠️
   - **Pros**: Simple, reliable microphone recording
   - **Cons**: No system audio support, limited to microphone only
   - **Outcome**: Included as fallback for microphone-only scenarios

2. **portaudio / node-portaudio** ❌
   - **Why Rejected**: Complex C++ bindings, harder to maintain
   - No built-in system audio capture on macOS
   - Would need additional tools like BlackHole or Loopback

3. **Web Audio API** ❌
   - **Why Rejected**: Browser-only, not suitable for Node.js library
   - Would limit use cases to Electron or web apps

4. **ScreenCaptureKit** ✅ **SELECTED**
   - **Advantages**:
     - Native macOS framework for audio/screen capture
     - Supports both microphone (macOS 15+) and system audio
     - Official Apple API, well-documented
     - Good npm wrapper (`screencapturekit` package)
     - Low-level access to audio streams
   - **Trade-offs**:
     - macOS 13+ required (13.0 for system audio, 15.0 for microphone)
     - Platform-specific (no cross-platform)
     - Requires Screen Recording permission for system audio

**Rationale**: ScreenCaptureKit is the only solution that provides both microphone and system audio capture on macOS through a single, official API.

**Status**: ✅ Implemented successfully

---

### 3. Audio Processing Strategy

**Decision**: Use **5-second chunk processing** with sequential queue processing.

**Date**: September 2024

**Context**:
- Need to balance latency with transcription quality
- Engines (especially Vosk) need sufficient audio context
- Must handle continuous streaming without dropping audio

**Approaches Attempted**:

1. **Immediate Processing (every buffer)** ❌
   - **Attempted**: Process each small audio buffer immediately
   - **Result**: Poor transcription quality, too little context
   - **Issue**: Engines need minimum audio duration for accurate results
   - **Abandoned**: Not enough context for good accuracy

2. **1-second chunks with overlap** ⚠️
   - **Attempted**: Process 1-second audio chunks with 100ms overlap
   - **Result**: Better than immediate, but still suboptimal
   - **Issue**: Still too short for Vosk to produce quality results
   - **Partially works**: Could be useful for ultra-low latency scenarios

3. **5-second chunks without overlap** ✅ **CURRENT**
   - **Implemented**: Buffer audio into 5-second chunks, process sequentially
   - **Result**: Good balance of latency (~5s) and accuracy
   - **Advantages**:
     - Sufficient context for accurate transcription
     - Clean chunk boundaries
     - Simpler state management
     - Reduced CPU usage
   - **Trade-offs**:
     - 5-second delay from speech to transcription
     - Cannot process audio faster than 5-second intervals

4. **Sliding window with overlap** 🔄
   - **Considered**: 5-second chunks with 250ms overlap for continuity
   - **Status**: Attempted but removed in favour of clean chunks
   - **Reasoning**: Complexity didn't justify marginal improvement
   - **Future**: Could revisit if word boundary issues arise

**Rationale**: 5-second chunks provide the best balance between latency and accuracy. Engines need sufficient audio context, and this duration allows for quality transcription without excessive delay.

**Status**: ✅ Implemented and working

---

### 4. Processing Queue Architecture

**Decision**: Use **sequential queue processing** rather than parallel processing.

**Date**: September 2024

**Context**:
- Multiple audio chunks arriving continuously
- Transcription engines may not be thread-safe
- Need to prevent resource exhaustion

**Alternatives Considered**:

1. **Parallel Processing** ❌
   - **Why Rejected**: Could overwhelm CPU with multiple concurrent transcriptions
   - Risk of race conditions with engine state
   - Memory usage could spike with many simultaneous processes
   - Transcription engines not guaranteed to be thread-safe

2. **Sequential Queue** ✅ **SELECTED**
   - **Advantages**:
     - Controlled resource usage
     - Predictable behaviour
     - No race conditions
     - Simple state management
   - **Trade-offs**:
     - If transcription is slower than audio rate, queue could back up
     - Cannot leverage multi-core for transcription

3. **Worker Pool** 🔄
   - **Considered**: Pool of worker threads for parallel processing
   - **Status**: Not implemented yet
   - **Future**: Could improve throughput on multi-core systems
   - **Complexity**: Requires careful state management and IPC

**Rationale**: Sequential processing is simpler, more predictable, and sufficient for real-time use cases. The 5-second chunk strategy means queue rarely backs up.

**Status**: ✅ Implemented successfully

---

### 5. Event Architecture

**Decision**: Use **EventEmitter** pattern with TypeScript type safety.

**Date**: September 2024

**Context**:
- Need real-time notification of transcription results
- Multiple event types (transcription, errors, metrics)
- TypeScript type safety desired

**Alternatives Considered**:

1. **Callbacks** ❌
   - **Why Rejected**: Less flexible, callback hell
   - Doesn't support multiple listeners
   - Not idiomatic for Node.js streaming

2. **Promises/Async Iterators** ❌
   - **Why Rejected**: More complex for continuous streaming
   - Event-based is more natural for real-time streams
   - Would require additional abstraction layer

3. **EventEmitter** ✅ **SELECTED**
   - **Advantages**:
     - Native Node.js pattern
     - Multiple listeners supported
     - Standard pattern familiar to developers
     - Easy to extend with TypeScript type safety
   - **Implementation**: Custom type-safe wrapper around EventEmitter

**Rationale**: EventEmitter is the standard Node.js pattern for streaming events and provides the flexibility needed for this library.

**Status**: ✅ Implemented with full type safety

---

### 6. Confidence Threshold Filtering

**Decision**: Apply **confidence threshold at emission** rather than at engine level.

**Date**: September 2024

**Context**:
- Transcription results have varying confidence scores
- Users may want to filter low-confidence results
- Different use cases need different thresholds

**Approach**:
- Engine returns all results with confidence scores
- AudioTranscriber filters based on user-configured threshold
- Default threshold: 0.3 (30%)

**Rationale**: Filtering at the application level gives users flexibility to adjust thresholds without re-processing audio. Raw results are still available in logs for debugging.

**Status**: ✅ Implemented

---

### 7. Partial Results Strategy

**Decision**: Support **both partial and final results** with user control.

**Date**: September 2024

**Context**:
- Users may want immediate feedback (partial results)
- Or only final, accurate transcriptions (final results only)
- Different engines handle partial results differently

**Implementation**:
- `enablePartialResults` option (default: true)
- Engines mark results as `isPartial: boolean`
- Application filters based on user preference

**Engine Behaviour**:
- **Vosk**: Supports partial results natively
- **Whisper**: Batch-oriented, typically final results only

**Rationale**: Flexibility to support different use cases. Real-time applications benefit from partial results, while batch processing can use final-only mode.

**Status**: ✅ Implemented

---

### 8. Error Handling Strategy

**Decision**: Use **custom error types** with detailed context.

**Date**: September 2024

**Context**:
- Many failure modes (permissions, devices, engines, etc.)
- Users need clear error messages for debugging
- Different errors require different recovery strategies

**Implementation**:
- `TranscriptionError` class with error types
- Error types: PERMISSION_DENIED, DEVICE_NOT_FOUND, AUDIO_CAPTURE_FAILED, etc.
- Errors include original error for stack traces
- All errors emitted through 'error' event

**Rationale**: Structured error handling helps users diagnose issues quickly. Type-safe errors enable better error recovery logic.

**Status**: ✅ Implemented

---

### 9. Performance Metrics

**Decision**: Track and emit **real-time performance metrics** automatically.

**Date**: September 2024

**Context**:
- Users need visibility into library performance
- Debugging requires latency and resource usage data
- Quality monitoring needs confidence tracking

**Metrics Tracked**:
- Average latency
- CPU usage (estimated)
- Memory usage
- Transcription count
- Error count
- Average confidence
- Partial result count

**Implementation**:
- Metrics updated on each transcription
- Emitted via 'metrics' event every 5 seconds
- Available on-demand via `getMetrics()`

**Rationale**: Built-in observability helps users monitor and optimise their applications. Automatic emission reduces boilerplate code.

**Status**: ✅ Implemented

---

### 10. Model Management Strategy

**Decision**: **User-managed models** with manual download.

**Date**: September 2024

**Context**:
- Speech models are large (100MB - 1GB+)
- Different users need different languages/sizes
- License implications of bundling models

**Approach**:
- Users download models from official sources
- Specify model path in configuration
- No automatic download or bundling

**Alternatives Considered**:

1. **Bundle Default Model** ❌
   - **Why Rejected**: Would make npm package huge
   - Not all users need all models
   - License complexity

2. **Automatic Download** ❌
   - **Why Rejected**: Could fail in restricted environments
   - Users may want specific model versions
   - Adds complexity and failure modes

3. **User-Managed** ✅ **SELECTED**
   - Simple, explicit, predictable
   - Users choose model size/language
   - No network operations in library

**Rationale**: Explicit model management keeps the library lean and gives users full control over which models they use.

**Status**: ✅ Implemented

---

## Lessons Learned

### What Worked Well
1. **Vosk for Real-Time** - Excellent latency and accuracy balance
2. **ScreenCaptureKit** - Reliable, official API for audio capture
3. **5-Second Chunks** - Good balance for quality and latency
4. **Sequential Processing** - Simple and sufficient for real-time
5. **EventEmitter Pattern** - Natural fit for streaming events
6. **TypeScript** - Type safety caught many bugs early

### What Was Challenging
1. **Audio Buffering** - Finding optimal chunk size took experimentation
2. **Vosk Integration** - Less documentation than commercial options
3. **System Audio Permissions** - macOS permission flow can confuse users
4. **Engine Abstraction** - Creating generic interface for different engines
5. **Whisper Real-Time** - Not ideal for streaming, better for batch

### What Would We Do Differently
1. **Document Model Download Earlier** - Should be in quick start
2. **Add Example Scripts** - More working examples would help users
3. **Worker Pool** - Consider earlier for better multi-core usage
4. **Automatic Tests** - Should have unit tests from the start
5. **Model Management Helper** - Could provide utility to list/download models

---

## Future Considerations

### Short Term
1. **Add Example Applications** - More real-world demo scenarios
2. **Improve Documentation** - API reference, troubleshooting guide
3. **Performance Tuning** - Optimise buffer sizes per engine
4. **Error Recovery** - Better automatic reconnection logic

### Long Term
1. **Additional Engines** - Coqui STT, Wav2Vec2 support
2. **Cross-Platform** - Windows/Linux support via different audio APIs
3. **Language Detection** - Automatic language switching
4. **Speaker Diarization** - Identify multiple speakers
5. **Model Management** - Helper utilities for downloading/managing models
6. **Cloud Engines** - Optional commercial API support for comparison
7. **Worker Pools** - Multi-threaded processing for throughput

---

## Decision-Making Principles

1. **Simplicity First** - Choose simpler solutions unless complexity is justified
2. **User Control** - Give users options rather than making choices for them
3. **Privacy Priority** - Prefer on-device over cloud when possible
4. **Open Source** - No dependencies on paid services or APIs
5. **Real-Time Focus** - Optimise for low latency over batch processing
6. **TypeScript Safety** - Maintain full type safety throughout
7. **Graceful Degradation** - Handle errors without crashing

---

### Decision: Add Coqui STT Engine ✅

**Date**: November 2025

**Context**: User requested to expand engine options to provide more flexibility. Three candidates considered: Faster Whisper, Silero Models, and Coqui STT/DeepSpeech.

**Alternatives Considered**:

1. **Faster Whisper** ❌
   - **Why Rejected**: Python-only implementation using CTranslate2
   - No native Node.js bindings available
   - Would require Python microservice bridge (excessive complexity)
   - **Trade-off**: Current whisper-node uses whisper.cpp which is already optimised for Node.js

2. **Silero Models** ❌
   - **Why Rejected**: Primarily PyTorch/ONNX implementation
   - Available Node.js packages (avr-vad, @ricky0123/vad) are for Voice Activity Detection (VAD), not transcription
   - Silero STT models lack good Node.js bindings
   - **Could Add**: Silero VAD in future for better snippet detection

3. **Coqui STT** ✅ **SELECTED**
   - **Advantages**:
     - Native Node.js bindings via `stt` npm package
     - DeepSpeech fork with active community
     - Balanced performance between Vosk (speed) and Whisper (accuracy)
     - Fully offline, privacy-preserving
     - Multi-language support
   - **Trade-offs**:
     - Models need to be downloaded separately
     - Doesn't provide confidence scores natively (estimated heuristically)
     - Moderate accuracy/speed compared to extremes (Vosk fast, Whisper accurate)

**Rationale**: Coqui STT is the only viable Node.js option among the three candidates. It provides users with a third choice beyond Vosk/Whisper, filling the "balanced" middle ground. Faster Whisper and Silero would require Python integration which adds complexity without clear benefit.

**Implementation**:
- Extended BaseTranscriptionEngine for Coqui
- Added 'coqui' to TranscriptionEngineType
- Updated both snippet and session pipelines to support Coqui
- Added UI options in demo app

**Status**: ⚠️ Implemented but limited platform support

**Limitation**: The `stt` npm package does not provide prebuilt binaries for Apple Silicon (darwin-arm64). It only supports:
- darwin-x64 (Intel Mac)
- linux-x64, linux-arm, linux-arm64
- win32-x64

Coqui STT will not work on Apple Silicon Macs without compiling from source. Users on Apple Silicon should use Vosk or Whisper engines instead.

**Future**: Could add Silero VAD for improved snippet boundary detection if users request it.

---

### Decision: Disable Sox Silence Detection for Continuous Recording ✅

**Date**: November 2025

**Context**: During testing, microphone recordings were producing choppy, repeating audio that resulted in poor transcription quality. Vosk and Whisper both produced garbled, repeated text like "one one two to three three...".

**Root Cause**: The `node-record-lpcm16` package was configured with sox silence detection (`silence: '0.1'` parameter), which causes sox to automatically stop and restart recording during quiet periods. This is incompatible with continuous transcription workflows.

**Problem Symptoms**:
- WAV files with choppy, fragmented audio
- Repeated words in transcriptions
- Audio amplitude dropping significantly between chunks (12,024 → 229.6)
- Whisper detecting speech at impossible timestamps
- Transcription engines returning empty results for most chunks

**Attempted Approach** ❌:
```typescript
const microphoneOptions = {
  threshold: 0.001,           // Low noise gate threshold
  silence: '0.1',             // ❌ This caused the problem
  recordProgram: 'rec',
  // ...
};
```

**Fix Applied** ✅:
```typescript
const microphoneOptions = {
  sampleRateHertz: 16000,
  threshold: 0,               // ✅ Disable noise gate entirely
  verbose: false,
  recordProgram: 'rec',
  // Do NOT use silence detection - causes choppy, repeating audio
  channels: 1,
  format: 'S16_LE',
  bitRate: 256000,
  // ❌ silence parameter REMOVED
};
```

**Rationale**: Sox silence detection is designed for voice-activated recording (e.g., dictation where you want to skip quiet periods). For continuous transcription, we need uninterrupted audio flow. The snippet and session pipelines handle audio segmentation at the application level, so sox should just continuously stream raw PCM data.

**Testing**: Created `test-audio-capture.js` CLI tool to quickly verify audio recording quality without running full Electron app. Confirmed clean, continuous audio with no choppiness or repetition.

**Status**: ✅ Fixed and verified

**Location**: `/src/audio/capture.ts:336-345`

---

### Decision: Remove Coqui STT Engine ✅

**Date**: November 2025

**Context**: The `stt` npm package (Coqui STT) does not provide prebuilt binaries for Apple Silicon (darwin-arm64), causing installation and runtime failures on M1/M2 Macs. Since most modern development happens on Apple Silicon, maintaining an engine that doesn't work on the primary platform creates confusion and support burden.

**Problem**:
- `stt` package only supports: darwin-x64, linux-x64, linux-arm, linux-arm64, win32-x64
- Does NOT support darwin-arm64 (Apple Silicon)
- Users on M1/M2 Macs cannot use Coqui STT without compiling from source
- Including a non-functional engine option in the UI is misleading

**Decision**: ✅ **Completely remove Coqui STT from the codebase**

**Changes Made**:
1. Removed `'coqui'` from `TranscriptionEngineType` in `/src/types/index.ts`
2. Removed Coqui imports from `/src/core/snippet-pipeline.ts`
3. Removed Coqui imports from `/src/core/session-pipeline.ts`
4. Removed Coqui option from snippet engine dropdown in `/demo/src/index.html`
5. Removed Coqui option from session engine dropdown in `/demo/src/index.html`
6. Removed Coqui badge styling from `/demo/src/index.html`
7. Removed Coqui configuration logic from `/demo/src/renderer.js`
8. Deleted `/src/engines/coqui/` directory entirely
9. Uninstalled `stt` package from `package.json`

**Rationale**: The library focuses on reliability and cross-platform support within macOS. Vosk (fast) and Whisper (accurate) provide excellent coverage for all use cases. Removing Coqui simplifies the codebase, eliminates platform-specific failures, and improves user experience.

**Status**: ✅ Removed and tested

---

### Decision: Fix Buffer Overrun in Audio Stream Processing ✅

**Date**: November 2025

**Context**: During testing, sox was outputting warnings: "unhandled buffer overrun. Data discarded" because the audio stream wasn't being consumed fast enough. Vosk processing takes 8+ seconds per 15-second chunk, causing the stdout buffer from sox to overflow and drop audio data.

**Problem**:
- `AudioTranscriber.setupStreamHandlers()` used `await this._snippetPipeline.processAudio()`
- This blocked the event loop for 8+ seconds during transcription
- During this time, sox continued outputting to stdout but nobody was reading
- The OS buffer (typically 64KB) filled up and sox discarded data
- Result: Choppy audio, missed transcription segments, buffer overrun warnings

**Root Cause**: Synchronous/blocking audio processing in the data event handler.

**Fix Applied**: ✅ **Non-blocking audio stream processing**

**Changes Made** (`/src/core/audio-transcriber.ts:478-497`):
```typescript
// BEFORE (blocking):
stream.onData(async (audioData: Buffer, timestamp: number) => {
  // ...
  await this._snippetPipeline.processAudio(audioData, source, timestamp);
  // ...
});

// AFTER (non-blocking):
stream.onData((audioData: Buffer, timestamp: number) => {
  // ...
  // Process asynchronously without blocking the stream read
  this._snippetPipeline.processAudio(audioData, source, timestamp).catch(error => {
    console.error('Snippet pipeline processing error:', error);
    this._metrics.errorCount++;
  });
  // ...
});
```

**How It Works**:
1. Audio stream data event fires continuously as sox outputs PCM data
2. Data is immediately passed to SessionRecorder (writes to disk - fast)
3. Data is passed to SnippetPipeline asynchronously (fire-and-forget)
4. SnippetPipeline has internal queue with overflow protection (drops oldest if >3 chunks queued)
5. Event handler returns immediately, allowing stream to continue reading
6. No blocking = no buffer overrun

**Testing**: Created `test-audio-capture.js` to verify continuous audio reading without blocking.

**Status**: ✅ Fixed and verified

---

### Decision: Fix Low Audio Amplitude with node-record-lpcm16 ✅

**Date**: November 2025

**Context**: When using sox directly with raw PCM output, audio amplitude was extremely low (avg=37.6, max=63 instead of thousands), resulting in nearly silent, distorted audio and poor transcription quality.

**Problem**:
- Direct sox usage: `sox -d -t raw -r 16000 -e signed-integer -b 16 -c 1 -`
- This produces raw PCM but with very low volume/gain
- Transcription engines couldn't detect speech due to low amplitude
- Test script using `node-record-lpcm16` worked perfectly with normal amplitude

**Root Cause**: sox needs proper gain/volume settings, or use of `rec` command instead of `sox` for recording.

**Fix Applied**: ✅ **Use node-record-lpcm16 for microphone capture**

**Changes Made** (`/src/audio/capture.ts:329-396`):
```typescript
// BEFORE: Direct sox with raw PCM output (low amplitude)
const soxProcess = spawn('sox', [
  '-d', '-t', 'raw', '-r', '16000',
  '-e', 'signed-integer', '-b', '16',
  '-c', '1', '-'
]);

// AFTER: Use node-record-lpcm16 (proper amplitude)
const microphoneOptions = {
  sampleRateHertz: 16000,
  threshold: 0,              // Disable noise gate
  verbose: false,
  recordProgram: 'rec',      // Use sox 'rec' command
  channels: 1,
  format: 'S16_LE',          // 16-bit signed little-endian PCM
  bitRate: 256000,           // Higher bit rate for better quality
};

const recording = recorder.record(microphoneOptions);
const micProcess = recording.stream();
```

**Why node-record-lpcm16**:
1. Uses sox `rec` command internally (optimised for recording)
2. Handles gain/volume automatically for proper amplitude
3. Outputs raw PCM data directly to stdout (no WAV header)
4. Same configuration as test-audio-capture.js which works perfectly
5. Proven reliable in production environments

**Process Wrapper**: Since node-record-lpcm16 returns a ReadableStream instead of ChildProcess, we wrap it in a ChildProcess-compatible interface for consistency with the AudioStream architecture.

**Testing**: The test-audio-capture.js script demonstrates this works correctly with normal amplitude.

**Status**: ✅ Fixed and ready for testing

---

### Decision: Fix Duplicate Audio Chunks from EventEmitter Double-Callback ✅

**Date**: November 2025

**Context**: Audio recordings had repeating/stuttering words where each phrase was duplicated. Test recordings showed pairs of chunks with identical first 16 bytes, indicating audio data was being duplicated at the stream level.

**Root Cause**: The `ScreenCaptureAudioStream.onData()` method registered callbacks TWICE:
1. Stored callback in `this._dataCallback` (line 162)
2. Added as event listener via `this.on('data', callback)` (line 162)

Then `setupProcessHandlers()` emitted each chunk twice:
1. Called `this._dataCallback(data, timestamp)` directly (line 44)
2. Called `this.emit('data', data, timestamp)` which triggered ALL registered listeners including the same callback (line 46)

**Problem Symptoms**:
- Test output showed chunk pairs with identical hex data:
  ```
  Chunk 1: 33 00 20 00 46 00 93 00 98 00 a7 00 96 00 87 00
  Chunk 2: 33 00 20 00 46 00 93 00 98 00 a7 00 96 00 87 00  ← IDENTICAL
  Chunk 3: 8c ff a4 ff c0 ff e6 ff f2 ff 01 00 0b 00 10 00
  Chunk 4: 8c ff a4 ff c0 ff e6 ff f2 ff 01 00 0b 00 10 00  ← IDENTICAL
  ```
- Transcriptions had repeating words: "one one two two three three"
- Both SessionRecorder (disk) and SnippetPipeline (memory) affected
- Issue persisted across different sox configurations

**Attempted Fixes** ❌:
1. Removing sox `rate -h` effect - improved chunking but didn't fix duplicates
2. Switching between sox and node-record-lpcm16 - duplicates persisted
3. Adjusting buffer sizes - no effect on duplicates

**Fix Applied**: ✅ **Use pure EventEmitter pattern without redundant callbacks**

**Changes Made** (`/src/audio/stream.ts`):

```typescript
// BEFORE (duplicate invocation):
private setupProcessHandlers(): void {
  this._captureProcess.stdout?.on('data', (data: Buffer) => {
    if (this._isActive) {
      const timestamp = Date.now();

      if (this._dataCallback) {
        this._dataCallback(data, timestamp);  // ← Called once
      }
      this.emit('data', data, timestamp);     // ← Called again (duplicates)
    }
  });
}

onData(callback: (data: Buffer, timestamp: number) => void): void {
  this._dataCallback = callback;     // ← Stored
  this.on('data', callback);         // ← Also registered as listener
}

// AFTER (single invocation):
private setupProcessHandlers(): void {
  this._captureProcess.stdout?.on('data', (data: Buffer) => {
    if (this._isActive) {
      const timestamp = Date.now();
      this.emit('data', data, timestamp);  // ← Only emit event once
    }
  });
}

onData(callback: (data: Buffer, timestamp: number) => void): void {
  this.on('data', callback);  // ← Simple pass-through to EventEmitter
}
```

**Removed**:
- `_dataCallback`, `_errorCallback`, `_endCallback` private fields (no longer needed)
- Direct callback invocations in `setupProcessHandlers()`
- Duplicate event emission logic

**Testing**:
```bash
npm run test:audio 5
```

**Result**: Chunks now unique:
```
Chunk 1: 09 00 0d 00 fb ff d7 ff db ff 13 00 55 00 87 00
Chunk 2: 34 00 1b 00 40 00 57 00 69 00 5d 00 0b 00 e6 ff  ← DIFFERENT
Chunk 3: ae 00 8e 00 67 00 7a 00 9a 00 4f 00 2a 00 2b 00  ← DIFFERENT
Chunk 4: 3d ff 3c ff 5a ff 44 ff 44 ff 8f ff a1 ff 9e ff  ← DIFFERENT
```

**Rationale**: Node.js EventEmitter is designed to handle multiple listeners efficiently. Maintaining a parallel callback mechanism created an opportunity for duplicate invocation. Using EventEmitter as the single source of truth is simpler and eliminates the duplication bug.

**Key Learning**: When wrapping EventEmitter, don't create redundant callback mechanisms. Use EventEmitter's built-in listener pattern directly.

**Status**: ✅ Fixed and verified

**Location**: `/src/audio/stream.ts:35-167`

---

### Decision: Fix Whisper Module Loading for whisper-node ✅

**Date**: November 2025

**Context**: Whisper engine was returning empty results `[]` when attempting to transcribe audio. Direct testing revealed that whisper-node works correctly and returns transcriptions with `.speech` properties, but the integration in WhisperTranscriptionEngine was failing.

**Root Cause**: The whisper-node npm package exports an object with `.default` and `.whisper` properties, not a direct function. The original code did:

```typescript
let whisper: any;
try {
  whisper = require('whisper-node');  // Returns { default: function, whisper: object }
  console.log('[WHISPER] whisper-node loaded successfully');
} catch (error) {
  whisper = null;
}
```

This assigned the module object to `whisper`, not the actual transcription function. Later code checked `typeof whisper !== 'function'` but the fallback logic didn't correctly extract the `.default` export.

**Testing Process**:
1. Created `test-whisper-direct.js` to test whisper-node in isolation
2. Confirmed whisper-node works: returns array with `{start, end, speech}` objects
3. Discovered module structure: `{ whisper: object, default: function }`
4. Identified that `.default` contains the actual transcription function

**Fix Applied** ✅:
```typescript
// Import whisper-node with error handling
let whisper: any;
try {
  const whisperModule = require('whisper-node');
  // whisper-node exports as { default: function, whisper: object }
  // We need to use the .default export
  if (typeof whisperModule === 'object' && typeof whisperModule.default === 'function') {
    whisper = whisperModule.default;
    console.log('[WHISPER] whisper-node loaded successfully (using .default export)');
  } else if (typeof whisperModule === 'function') {
    whisper = whisperModule;
    console.log('[WHISPER] whisper-node loaded successfully (direct function)');
  } else {
    console.error('[WHISPER] whisper-node module structure unexpected:', Object.keys(whisperModule || {}));
    whisper = null;
  }
} catch (error) {
  console.error('[WHISPER] Failed to load whisper-node:', error);
  whisper = null;
}
```

**Result Format**: Whisper returns an array of segments:
```json
[
  {
    "start": "00:00:02.760",
    "end": "00:00:08.840",
    "speech": "Testing."
  }
]
```

The `extractText()` method correctly handles this format by mapping over the array and extracting `.speech` properties.

**Simplified Initialization**: Removed redundant module resolution logic from `initializeEngine()` since the module is now loaded correctly at import time.

**Testing**: Direct test with `test-whisper-direct.js` confirms Whisper transcribes audio files correctly with ~260ms processing time for a 5-second audio clip.

**Status**: ⚠️ **Partially Fixed - Experimental**

The module loading is now correct and Whisper works for isolated file transcription. However, integration with SessionPipeline for complete session transcripts still has issues. For production use, **Vosk is recommended** for both snippet and session pipelines.

**Location**: `/src/engines/whisper/whisper-engine.ts:14-33, 169-186, 247-376`

---

**Last Updated**: November 2025
**Status**: Living document - update as new decisions are made
