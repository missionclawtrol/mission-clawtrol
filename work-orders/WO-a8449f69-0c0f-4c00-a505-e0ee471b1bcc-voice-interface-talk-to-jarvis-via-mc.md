# Work Order: Voice Interface - Talk to Jarvis via MC

## Goal
Build a real-time voice conversation interface embedded in Mission Clawtrol so the user can speak to Jarvis (OpenClaw) instead of typing. Fully local STT and TTS — no cloud voice services needed.

## Architecture
```
Browser Mic → WebSocket → faster-whisper (local STT) → text
text → OpenClaw API → Jarvis response (with full tools/memory)
response → Piper TTS (local) → audio → WebSocket → Browser playback
```

## Definition of Done
- [ ] Python sidecar service running faster-whisper (STT) and Piper TTS — starts alongside MC
- [ ] WebSocket endpoint at /api/voice handles bidirectional audio streaming
- [ ] Frontend floating mic widget (push-to-talk button) accessible from any MC page
- [ ] Visual feedback: recording indicator, waveform, thinking/generating states
- [ ] Transcript displayed alongside audio (what user said + Jarvis response)
- [ ] Audio playback of Jarvis responses in browser
- [ ] Settings page: enable/disable voice, select Piper voice, adjust mic sensitivity
- [ ] Works on mobile browser (phone via Tailscale)
- [ ] Piper voice model auto-downloads on first use
- [ ] faster-whisper model auto-downloads on first use

## Technical Details

### STT: faster-whisper
- CTranslate2-based Whisper implementation
- Use `base` or `small` model for speed (CPU-only, no NVIDIA GPU)
- `pip install faster-whisper`
- Accept WebM/opus audio chunks from browser, transcribe in near-real-time

### TTS: Piper
- Fast local TTS, runs great on CPU
- `pip install piper-tts` or use binary
- Good voice: `en_US-lessac-medium` or `en_US-ryan-medium`
- Output WAV, stream back to browser

### Frontend
- Web Audio API / MediaRecorder for mic capture
- WebSocket connection to /api/voice
- Floating button component (bottom-right corner, like a chat widget)
- States: idle → recording → processing → playing response
- Show transcript in expandable panel

### OpenClaw Integration
- Send transcribed text to OpenClaw's chat API (same as webchat)
- Receive text response, pipe through Piper TTS
- Must use the CSO agent (Jarvis) endpoint

### Hardware
- AMD Ryzen AI MAX+ 395, 30GB RAM, no NVIDIA GPU
- CPU inference only — both faster-whisper and Piper handle this fine

## Files / Paths
- `services/voice/` — Python sidecar (FastAPI + WebSocket)
- `services/voice/requirements.txt` — faster-whisper, piper-tts, fastapi, uvicorn, websockets
- `apps/dashboard/src/lib/components/VoiceWidget.svelte` — floating mic widget
- `apps/dashboard/src/routes/settings/voice/+page.svelte` — voice settings
- `apps/dashboard/src/lib/api.ts` — voice API types/functions
- `services/backend/src/index.ts` — proxy or redirect to voice sidecar if needed

## Out of Scope
- Wake word detection ("Hey Jarvis") — future enhancement
- Always-listening mode — start with push-to-talk only
- Phone number / Twilio integration
- Voice cloning / custom voice training
- Multi-language support (English only for now)

## Test / Verify
- Click mic button → speak → see transcript → hear Jarvis respond
- Test on desktop Chrome and mobile Safari/Chrome
- Verify faster-whisper transcription accuracy
- Verify Piper TTS audio quality and latency
- Test over Tailscale from phone
- Measure end-to-end latency (target: <5s from end of speech to start of audio response)

## Notes
- Start the voice sidecar as a separate process (like MC backend)
- Consider adding to MC's startup script so it launches together
- If Piper voice quality isn't good enough, Kokoro TTS is an alternative (heavier but better quality)
- The user (Christopher) wants this to feel like talking to Siri/Alexa but with full Jarvis capabilities
