"""
Mission Clawtrol Voice Sidecar
-------------------------------
FastAPI + WebSocket server that handles:
  - Speech-to-Text via faster-whisper (CPU)
  - Text routing to OpenClaw (Jarvis) via MC backend
  - Text-to-Speech via Piper TTS (CPU)
  - Real-time audio streaming with browser via WebSocket

Port: 8766
WebSocket: ws://localhost:8766/ws
Health:    http://localhost:8766/health
Settings:  http://localhost:8766/api/settings
"""

import asyncio
import base64
import io
import json
import logging
import os
import tempfile
import wave
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from piper import PiperVoice
from piper.download_voices import download_voice

# ─── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voice-sidecar")

# ─── Config ─────────────────────────────────────────────────────────────────
MODELS_DIR = Path(
    os.environ.get(
        "VOICE_MODELS_DIR",
        Path.home() / ".openclaw" / "voice-models",
    )
)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

MC_BACKEND_URL = os.environ.get("MC_BACKEND_URL", "http://localhost:3001")
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL", "base")
DEFAULT_PIPER_VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")
PORT = int(os.environ.get("VOICE_PORT", "8766"))

# ─── App ────────────────────────────────────────────────────────────────────
app = FastAPI(title="Mission Clawtrol Voice Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Global model state ─────────────────────────────────────────────────────
_whisper_model: Optional[WhisperModel] = None
_piper_voice: Optional[PiperVoice] = None
_piper_voice_name: Optional[str] = None


def get_whisper_model() -> WhisperModel:
    global _whisper_model
    if _whisper_model is None:
        logger.info(f"Loading Whisper model '{WHISPER_MODEL_SIZE}' (CPU, int8)…")
        _whisper_model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device="cpu",
            compute_type="int8",
        )
        logger.info("Whisper model ready")
    return _whisper_model


def get_piper_voice(voice_name: Optional[str] = None) -> PiperVoice:
    global _piper_voice, _piper_voice_name
    name = voice_name or DEFAULT_PIPER_VOICE

    if _piper_voice is None or name != _piper_voice_name:
        model_path = MODELS_DIR / f"{name}.onnx"
        config_path = MODELS_DIR / f"{name}.onnx.json"

        if not model_path.exists() or not config_path.exists():
            logger.info(f"Downloading Piper voice '{name}'…")
            download_voice(name, MODELS_DIR)
            logger.info(f"Piper voice '{name}' downloaded to {MODELS_DIR}")

        logger.info(f"Loading Piper voice from {model_path}")
        _piper_voice = PiperVoice.load(str(model_path))
        _piper_voice_name = name
        logger.info("Piper voice ready")

    return _piper_voice


# ─── Audio helpers ──────────────────────────────────────────────────────────

def transcribe_wav(wav_bytes: bytes) -> str:
    """Transcribe WAV audio bytes using faster-whisper. Returns transcript text."""
    model = get_whisper_model()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav_bytes)
        tmp_path = f.name

    try:
        segments, _info = model.transcribe(
            tmp_path,
            language="en",
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        text = " ".join(seg.text for seg in segments).strip()
        return text
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def synthesize_tts(text: str, voice_name: Optional[str] = None) -> bytes:
    """Synthesize text to WAV bytes using Piper TTS."""
    voice = get_piper_voice(voice_name)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    return buf.getvalue()


# ─── OpenClaw integration ───────────────────────────────────────────────────

async def send_to_jarvis(text: str, timeout_secs: int = 90) -> str:
    """
    Send transcribed text to Jarvis (CSO agent) via MC backend and
    poll the session history for a new assistant reply.
    
    Returns the assistant's response text.
    Raises RuntimeError on timeout or communication failure.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        # Snapshot current history
        prev_assistant_texts: list[str] = []
        try:
            res = await client.get(
                f"{MC_BACKEND_URL}/api/message/history",
                params={"limit": "100"},
            )
            if res.status_code == 200:
                msgs = res.json().get("messages", [])
                prev_assistant_texts = [
                    m["content"] for m in msgs if m["role"] == "assistant"
                ]
        except Exception as exc:
            logger.warning(f"Could not snapshot history: {exc}")

        # Send the user message
        try:
            await client.post(
                f"{MC_BACKEND_URL}/api/message",
                json={"message": text},
                timeout=15.0,
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to send message to MC backend: {exc}") from exc

        # Poll for a new assistant reply
        prev_set = set(prev_assistant_texts)
        deadline = asyncio.get_event_loop().time() + timeout_secs

        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(1.5)
            try:
                res = await client.get(
                    f"{MC_BACKEND_URL}/api/message/history",
                    params={"limit": "100"},
                    timeout=8.0,
                )
                if res.status_code != 200:
                    continue
                msgs = res.json().get("messages", [])
                new_assistant = [
                    m["content"]
                    for m in msgs
                    if m["role"] == "assistant" and m["content"] not in prev_set
                ]
                if new_assistant:
                    return new_assistant[-1]
            except Exception as exc:
                logger.warning(f"History poll error: {exc}")

        raise RuntimeError("Timed out waiting for Jarvis response")


# ─── REST endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "mission-clawtrol-voice",
        "whisper_model": WHISPER_MODEL_SIZE,
        "piper_voice": DEFAULT_PIPER_VOICE,
        "models_dir": str(MODELS_DIR),
    }


@app.get("/api/settings")
def get_settings():
    return {
        "whisperModel": WHISPER_MODEL_SIZE,
        "piperVoice": DEFAULT_PIPER_VOICE,
        "modelsDir": str(MODELS_DIR),
    }


@app.get("/api/voices")
def list_voices():
    """List available Piper voices (already downloaded)."""
    downloaded = []
    for f in MODELS_DIR.glob("*.onnx"):
        downloaded.append(f.stem)
    return {"voices": downloaded, "current": DEFAULT_PIPER_VOICE}


# ─── WebSocket voice endpoint ────────────────────────────────────────────────

@app.websocket("/ws")
async def voice_websocket(ws: WebSocket):
    """
    WebSocket voice conversation endpoint.

    Client → Server:
      - text: {"type":"audio_start"}            - user started recording
      - binary: <WAV bytes>                      - audio chunk (16kHz, 16-bit, mono WAV)
      - text: {"type":"audio_end"}               - user finished recording → trigger pipeline
      - text: {"type":"ping"}                    - keepalive

    Server → Client:
      - text: {"type":"state","state":"idle|listening|processing|speaking"}
      - text: {"type":"transcript","text":"..."}  - STT result
      - text: {"type":"response_text","text":"..."}  - Jarvis reply text
      - text: {"type":"audio_start"}             - TTS audio beginning
      - binary: <WAV bytes>                      - TTS audio data
      - text: {"type":"audio_end"}               - TTS audio done
      - text: {"type":"error","message":"..."}   - error
      - text: {"type":"pong"}                    - ping reply
    """
    await ws.accept()
    logger.info("Voice WebSocket connected")

    audio_buffer = bytearray()

    async def send_json(obj: dict):
        try:
            await ws.send_text(json.dumps(obj))
        except Exception:
            pass

    async def send_state(state: str):
        await send_json({"type": "state", "state": state})

    try:
        await send_state("idle")

        while True:
            try:
                data = await asyncio.wait_for(ws.receive(), timeout=120.0)
            except asyncio.TimeoutError:
                # Send keepalive to avoid idle disconnect
                await send_json({"type": "pong"})
                continue

            # Disconnected
            if data.get("type") == "websocket.disconnect":
                break

            # Binary audio chunk
            if data.get("bytes"):
                audio_buffer.extend(data["bytes"])
                continue

            # Text control message
            text_data = data.get("text", "")
            if not text_data:
                continue

            try:
                msg = json.loads(text_data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "ping":
                await send_json({"type": "pong"})

            elif msg_type == "audio_start":
                audio_buffer.clear()
                await send_state("listening")

            elif msg_type == "audio_end":
                if not audio_buffer:
                    logger.warning("audio_end with empty buffer — ignoring")
                    await send_state("idle")
                    continue

                wav_bytes = bytes(audio_buffer)
                audio_buffer.clear()

                try:
                    # ── STT ──────────────────────────────────────────────
                    await send_state("processing")
                    logger.info(f"Transcribing {len(wav_bytes)//1024}KB of audio…")

                    loop = asyncio.get_event_loop()
                    transcript = await loop.run_in_executor(
                        None, transcribe_wav, wav_bytes
                    )

                    logger.info(f"Transcript: {transcript!r}")

                    if not transcript:
                        await send_json({"type": "error", "message": "No speech detected"})
                        await send_state("idle")
                        continue

                    await send_json({"type": "transcript", "text": transcript})

                    # ── Jarvis ───────────────────────────────────────────
                    logger.info("Sending to Jarvis…")
                    response_text = await send_to_jarvis(transcript)
                    logger.info(f"Jarvis replied ({len(response_text)} chars)")

                    await send_json({"type": "response_text", "text": response_text})

                    # ── TTS ──────────────────────────────────────────────
                    await send_state("speaking")
                    logger.info("Synthesizing TTS…")

                    tts_audio = await loop.run_in_executor(
                        None, synthesize_tts, response_text
                    )
                    logger.info(f"TTS produced {len(tts_audio)//1024}KB")

                    await send_json({"type": "audio_start"})

                    # Stream audio in 32KB chunks
                    chunk_size = 32768
                    for i in range(0, len(tts_audio), chunk_size):
                        await ws.send_bytes(tts_audio[i : i + chunk_size])

                    await send_json({"type": "audio_end"})

                except Exception as exc:
                    logger.error(f"Voice pipeline error: {exc}", exc_info=True)
                    await send_json({"type": "error", "message": str(exc)})
                finally:
                    await send_state("idle")

    except WebSocketDisconnect:
        logger.info("Voice WebSocket disconnected")
    except Exception as exc:
        logger.error(f"Voice WebSocket error: {exc}", exc_info=True)


# ─── Startup: pre-load models ────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    """Pre-load models in the background so first request is fast."""
    logger.info("Voice sidecar starting up…")
    loop = asyncio.get_event_loop()

    # Load Whisper in background thread
    loop.run_in_executor(None, get_whisper_model)
    # Load Piper in background thread
    loop.run_in_executor(None, get_piper_voice)

    logger.info(f"Voice sidecar ready on port {PORT}")


# ─── Entry point ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        log_level="info",
        reload=False,
    )
