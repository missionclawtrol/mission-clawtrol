"""
Mission Clawtrol Voice Sidecar
--------------------------------
Python FastAPI service that handles Speech-to-Text (faster-whisper) and
Text-to-Speech (Piper TTS) for the Mission Clawtrol voice interface.

- Models are loaded ONCE at startup and kept in memory for fast responses.
- Connects to OpenClaw (Jarvis/CSO) via the MC backend gateway proxy.
- Audio is received as base64-encoded WebM/Opus (from MediaRecorder API).
- Audio response is sent as base64-encoded WAV chunks.

Port: 8766
WebSocket: ws://localhost:8766/ws
Health:    http://localhost:8766/health
Voices:    http://localhost:8766/api/voices
"""

import asyncio
import base64
import io
import json
import logging
import os
import uuid
import wave
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from piper import PiperVoice
from piper.download_voices import download_voice

import websockets  # noqa: F401 — used for gateway proxy connection

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

# Also check the legacy piper-voices directory
LEGACY_PIPER_DIR = Path.home() / ".openclaw" / "piper-voices"

MC_BACKEND_WS = os.environ.get("MC_BACKEND_WS", "ws://localhost:3001/ws/gateway")
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL", "base")
DEFAULT_PIPER_VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")
DEFAULT_SESSION_KEY = os.environ.get("VOICE_SESSION_KEY", "agent:cso:mc-voice")
PORT = int(os.environ.get("VOICE_PORT", "8766"))

# ─── App ────────────────────────────────────────────────────────────────────
app = FastAPI(title="Mission Clawtrol Voice Sidecar", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Global model state ─────────────────────────────────────────────────────
_whisper: Optional[WhisperModel] = None
_piper: Optional[PiperVoice] = None
_piper_name: Optional[str] = None


def get_whisper() -> WhisperModel:
    global _whisper
    if _whisper is None:
        logger.info(f"Loading Whisper model '{WHISPER_MODEL_SIZE}' on CPU (int8)…")
        _whisper = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
        logger.info("✓ Whisper ready")
    return _whisper


def get_piper(voice_name: Optional[str] = None) -> PiperVoice:
    global _piper, _piper_name
    name = voice_name or DEFAULT_PIPER_VOICE

    if _piper is None or name != _piper_name:
        # Check legacy path first (for already-downloaded models)
        model_path = LEGACY_PIPER_DIR / f"{name}.onnx"
        if not model_path.exists():
            model_path = MODELS_DIR / f"{name}.onnx"

        if not model_path.exists():
            logger.info(f"Downloading Piper voice '{name}'…")
            download_voice(name, MODELS_DIR)
            model_path = MODELS_DIR / f"{name}.onnx"
            logger.info(f"✓ Downloaded to {model_path}")

        logger.info(f"Loading Piper voice from {model_path}…")
        _piper = PiperVoice.load(str(model_path))
        _piper_name = name
        logger.info("✓ Piper ready")

    return _piper


# ─── Audio helpers ──────────────────────────────────────────────────────────

def transcribe_bytes(audio_bytes: bytes) -> str:
    """
    Transcribe audio bytes (any format PyAV supports: WebM, Opus, MP4, WAV, etc.)
    using faster-whisper. PyAV is bundled and does NOT need system ffmpeg.
    Returns the transcript text (empty string if no speech detected).
    """
    model = get_whisper()
    audio_buf = io.BytesIO(audio_bytes)

    # decode_audio accepts BinaryIO and returns float32 numpy array at 16kHz
    audio_array = decode_audio(audio_buf, sampling_rate=16000)

    segments, _info = model.transcribe(
        audio_array,
        language="en",
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 200},
    )
    text = " ".join(seg.text for seg in segments).strip()
    return text


def synthesize_wav_bytes(text: str, voice_name: Optional[str] = None) -> bytes:
    """
    Synthesize text to WAV bytes using Piper TTS.
    Strips markdown formatting to produce cleaner speech.
    """
    # Strip markdown for TTS
    clean = (
        text
        .replace("```", "")
        .replace("**", "")
        .replace("__", "")
        .replace("*", "")
        .replace("_", " ")
        .replace("#", "")
        .replace("`", "")
        .strip()
    )
    # Truncate very long responses (≈ 60 seconds of speech max)
    if len(clean) > 2000:
        clean = clean[:2000] + "… and more."

    voice = get_piper(voice_name)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize_wav(clean, wav_file)
    return buf.getvalue()


# ─── Gateway integration (via MC backend proxy) ──────────────────────────────

async def ask_jarvis(
    text: str,
    session_key: str,
    on_delta: Optional[asyncio.Queue] = None,
    timeout_secs: float = 90.0,
) -> str:
    """
    Send `text` to the CSO (Jarvis) via the MC backend gateway proxy.
    Optionally streams text deltas into `on_delta` queue.
    Returns the final response text.
    """
    import websockets as ws_lib

    gateway_url = MC_BACKEND_WS
    response_parts: list[str] = []
    final_text = ""

    try:
        async with ws_lib.connect(gateway_url, open_timeout=10) as gw:
            # Wait for proxy-ready
            ready = False
            async for raw in gw:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if msg.get("type") == "proxy-ready":
                    ready = True
                    break
                if msg.get("type") == "error":
                    raise RuntimeError(f"Gateway proxy error: {msg.get('message')}")

            if not ready:
                raise RuntimeError("Gateway proxy did not send proxy-ready")

            # Send the chat request
            req_id = f"voice-{uuid.uuid4().hex[:8]}"
            idempotency = uuid.uuid4().hex
            await gw.send(json.dumps({
                "type": "req",
                "id": req_id,
                "method": "chat.send",
                "params": {
                    "sessionKey": session_key,
                    "message": text,
                    "idempotencyKey": idempotency,
                },
            }))

            # Listen for response events
            deadline = asyncio.get_event_loop().time() + timeout_secs

            async for raw in gw:
                if asyncio.get_event_loop().time() > deadline:
                    break
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue

                if msg.get("type") == "event" and msg.get("event") == "chat":
                    payload = msg.get("payload", {})
                    state = payload.get("state")
                    message_data = payload.get("message", {})

                    if state == "delta":
                        content = message_data.get("content", [])
                        for block in content:
                            if block.get("type") == "text":
                                delta = block.get("text", "")
                                if delta:
                                    response_parts.append(delta)
                                    if on_delta:
                                        await on_delta.put(delta)

                    elif state == "final":
                        content = message_data.get("content", [])
                        parts = [b.get("text", "") for b in content if b.get("type") == "text"]
                        final_text = "".join(parts) or "".join(response_parts)
                        break

                    elif state in ("aborted", "error"):
                        final_text = "".join(response_parts)
                        if not final_text:
                            raise RuntimeError(f"Chat {state}")
                        break

    except Exception as exc:
        logger.error(f"Gateway error: {exc}")
        raise RuntimeError(f"Could not reach Jarvis: {exc}") from exc

    return final_text or "".join(response_parts) or "I'm sorry, I didn't get a response."


# ─── REST endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "mission-clawtrol-voice",
        "whisper_model": WHISPER_MODEL_SIZE,
        "piper_voice": DEFAULT_PIPER_VOICE,
        "models_loaded": _whisper is not None,
        "piper_loaded": _piper is not None,
    }


@app.get("/api/voices")
def list_voices():
    downloaded = []
    for d in [MODELS_DIR, LEGACY_PIPER_DIR]:
        if d.exists():
            downloaded.extend(f.stem for f in d.glob("*.onnx"))
    return {"voices": list(set(downloaded)), "current": _piper_name or DEFAULT_PIPER_VOICE}


from pydantic import BaseModel

class SwitchVoiceRequest(BaseModel):
    voice: str

@app.post("/api/voices/switch")
def switch_voice(req: SwitchVoiceRequest):
    """Switch the active Piper TTS voice. Downloads if not already available."""
    try:
        get_piper(req.voice)  # loads (and downloads if needed)
        return {"ok": True, "current": _piper_name}
    except Exception as e:
        logger.error(f"Failed to switch voice to '{req.voice}': {e}")
        return {"ok": False, "error": str(e)}


# ─── WebSocket voice endpoint ────────────────────────────────────────────────

@app.websocket("/ws")
async def voice_ws(ws: WebSocket):
    """
    Voice conversation WebSocket.

    Client → Server:
      text: {"type":"config","agentId":"cso","sttModel":"base","voiceModel":"/path/to.onnx"}
      text: {"type":"audio","data":"<base64-webm-or-wav>"}
      text: {"type":"cancel"}
      text: {"type":"ping"}

    Server → Client:
      text: {"type":"ready"}
      text: {"type":"config_ok","agentId":"...","sttModel":"..."}
      text: {"type":"transcript","text":"..."}
      text: {"type":"thinking"}
      text: {"type":"response_text","text":"...","final":true/false}
      text: {"type":"audio_chunk","data":"<base64-wav>"}
      text: {"type":"audio_end"}
      text: {"type":"error","message":"..."}
      text: {"type":"pong"}
    """
    await ws.accept()
    logger.info("Voice WebSocket client connected")

    # Per-connection state
    session_key = DEFAULT_SESSION_KEY
    voice_name: Optional[str] = None
    processing = False
    cancelled = False

    async def send(obj: dict):
        try:
            await ws.send_text(json.dumps(obj))
        except Exception:
            pass

    # Send ready immediately
    await send({"type": "ready"})

    try:
        while True:
            try:
                data = await asyncio.wait_for(ws.receive(), timeout=120.0)
            except asyncio.TimeoutError:
                await send({"type": "pong"})
                continue

            if data.get("type") == "websocket.disconnect":
                break

            text_data = data.get("text", "")
            if not text_data:
                continue

            try:
                msg = json.loads(text_data)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            # ── Ping ────────────────────────────────────────────────────────
            if msg_type == "ping":
                await send({"type": "pong"})

            # ── Config ──────────────────────────────────────────────────────
            elif msg_type == "config":
                agent_id = msg.get("agentId", "cso")
                stt_model = msg.get("sttModel", WHISPER_MODEL_SIZE)
                voice_model = msg.get("voiceModel")

                session_key = f"agent:{agent_id}:mc-voice"
                if voice_model:
                    voice_name = voice_model  # path or name
                    
                logger.info(f"Config: agent={agent_id}, stt={stt_model}, sessionKey={session_key}")
                await send({
                    "type": "config_ok",
                    "agentId": agent_id,
                    "sttModel": stt_model,
                    "sessionKey": session_key,
                })

            # ── Cancel ──────────────────────────────────────────────────────
            elif msg_type == "cancel":
                cancelled = True
                processing = False
                await send({"type": "cancelled"})

            # ── Audio ───────────────────────────────────────────────────────
            elif msg_type == "audio":
                if processing:
                    await send({"type": "error", "message": "Already processing — please wait"})
                    continue

                audio_b64 = msg.get("data", "")
                if not audio_b64:
                    await send({"type": "error", "message": "No audio data"})
                    continue

                audio_bytes = base64.b64decode(audio_b64)
                if len(audio_bytes) < 500:
                    await send({"type": "error", "message": "Audio too short"})
                    continue

                processing = True
                cancelled = False

                try:
                    # ── STT ─────────────────────────────────────────────────
                    logger.info(f"Transcribing {len(audio_bytes)//1024}KB audio…")
                    loop = asyncio.get_event_loop()
                    transcript = await loop.run_in_executor(None, transcribe_bytes, audio_bytes)
                    logger.info(f"Transcript: {transcript!r}")

                    if not transcript:
                        await send({"type": "error", "message": "No speech detected"})
                        continue

                    await send({"type": "transcript", "text": transcript})
                    if cancelled:
                        continue

                    # ── Jarvis ───────────────────────────────────────────────
                    await send({"type": "thinking"})
                    logger.info(f"Asking Jarvis (session={session_key})…")

                    delta_queue: asyncio.Queue = asyncio.Queue()
                    jarvis_task = asyncio.create_task(
                        ask_jarvis(transcript, session_key, on_delta=delta_queue)
                    )

                    # Stream text deltas to client while waiting
                    accumulated = ""
                    while not jarvis_task.done():
                        if cancelled:
                            jarvis_task.cancel()
                            break
                        try:
                            delta = await asyncio.wait_for(delta_queue.get(), timeout=0.5)
                            accumulated += delta
                            await send({"type": "response_text", "text": accumulated, "final": False})
                        except asyncio.TimeoutError:
                            pass

                    if cancelled:
                        continue

                    try:
                        final_response = await jarvis_task
                    except asyncio.CancelledError:
                        continue

                    if not final_response:
                        final_response = accumulated

                    logger.info(f"Jarvis replied ({len(final_response)} chars)")
                    await send({"type": "response_text", "text": final_response, "final": True})

                    if cancelled:
                        continue

                    # ── TTS ──────────────────────────────────────────────────
                    logger.info("Synthesizing TTS…")
                    wav_bytes = await loop.run_in_executor(
                        None, synthesize_wav_bytes, final_response, voice_name
                    )
                    logger.info(f"TTS: {len(wav_bytes)//1024}KB WAV")

                    # Send in 32KB chunks as base64
                    chunk_size = 32768
                    for i in range(0, len(wav_bytes), chunk_size):
                        if cancelled:
                            break
                        chunk = wav_bytes[i : i + chunk_size]
                        await send({"type": "audio_chunk", "data": base64.b64encode(chunk).decode()})

                    await send({"type": "audio_end"})

                except Exception as exc:
                    logger.error(f"Pipeline error: {exc}", exc_info=True)
                    await send({"type": "error", "message": str(exc)})
                finally:
                    processing = False

    except WebSocketDisconnect:
        logger.info("Voice WebSocket disconnected")
    except Exception as exc:
        logger.error(f"Voice WebSocket error: {exc}", exc_info=True)


# ─── Startup ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    logger.info("Voice sidecar starting up — pre-loading models in background…")
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, get_whisper)
    loop.run_in_executor(None, get_piper)
    logger.info(f"Voice sidecar ready — listening on :{PORT}")


# ─── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info", reload=False)
