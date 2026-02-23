<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getVoiceWsUrl, getApiBase } from '$lib/config';

  // ── State ──────────────────────────────────────────────────────────────────

  type VoiceState = 'idle' | 'recording' | 'processing' | 'playing' | 'error';

  let state: VoiceState = 'idle';
  let status = '';
  let transcript = '';
  let responseText = '';
  let errorMsg = '';
  let expanded = false;

  // Settings (loaded from localStorage)
  let agentId = 'cso';
  let sttModel = 'base';

  // ── WebSocket ──────────────────────────────────────────────────────────────

  let ws: WebSocket | null = null;
  let wsReady = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Audio Recording ────────────────────────────────────────────────────────

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let stream: MediaStream | null = null;

  // ── Audio Playback ─────────────────────────────────────────────────────────

  let audioContext: AudioContext | null = null;
  let audioQueue: ArrayBuffer[] = [];
  let isPlaying = false;
  let audioBufferChunks: Uint8Array[] = [];

  // ── Conversation History ───────────────────────────────────────────────────

  interface Turn {
    id: string;
    userText: string;
    assistantText: string;
    timestamp: number;
  }

  let history: Turn[] = [];
  let currentTurnId = '';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function uuid(): string {
    return crypto.randomUUID();
  }

  function loadSettings() {
    if (typeof localStorage === 'undefined') return;
    agentId = localStorage.getItem('voice_agent_id') || 'cso';
    sttModel = localStorage.getItem('voice_stt_model') || 'base';
  }

  function setState(s: VoiceState, msg = '') {
    state = s;
    status = msg;
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const url = getVoiceWsUrl();
    ws = new WebSocket(url);

    ws.onopen = () => {
      // Send config on connect
      ws!.send(JSON.stringify({
        type: 'config',
        agentId,
        sttModel,
      }));
    };

    ws.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleVoiceMessage(msg);
    };

    ws.onclose = () => {
      wsReady = false;
      ws = null;
      // Reconnect after delay
      reconnectTimer = setTimeout(connectWs, 5000);
    };

    ws.onerror = () => {
      wsReady = false;
    };
  }

  function disconnectWs() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    wsReady = false;
  }

  function sendWs(data: object) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ── Message Handler ────────────────────────────────────────────────────────

  function handleVoiceMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
      case 'config_ok':
        wsReady = true;
        if (state === 'idle' || state === 'error') setState('idle', 'Ready');
        break;

      case 'transcript':
        transcript = msg.text || '';
        if (transcript) {
          currentTurnId = uuid();
          history = [...history, {
            id: currentTurnId,
            userText: transcript,
            assistantText: '',
            timestamp: Date.now(),
          }];
        }
        setState('processing', 'Thinking...');
        break;

      case 'thinking':
        setState('processing', 'Thinking...');
        break;

      case 'response_text':
        responseText = msg.text || '';
        if (msg.final && currentTurnId) {
          history = history.map(t =>
            t.id === currentTurnId ? { ...t, assistantText: msg.text } : t
          );
        }
        if (!msg.final) setState('processing', 'Responding...');
        break;

      case 'audio_chunk':
        // Collect WAV chunks
        const chunk = base64ToArrayBuffer(msg.data);
        audioBufferChunks.push(new Uint8Array(chunk));
        break;

      case 'audio_end':
        setState('playing', 'Playing...');
        playCollectedAudio();
        break;

      case 'error':
        setState('error', msg.message || 'Error');
        errorMsg = msg.message || 'Unknown error';
        setTimeout(() => { if (state === 'error') setState('idle', ''); }, 4000);
        break;

      case 'cancelled':
        setState('idle', 'Cancelled');
        setTimeout(() => { if (state === 'idle') status = ''; }, 2000);
        break;

      case 'pong':
        break;
    }
  }

  // ── Audio helpers ──────────────────────────────────────────────────────────

  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function playCollectedAudio() {
    if (audioBufferChunks.length === 0) {
      setState('idle', '');
      return;
    }

    try {
      if (!audioContext) audioContext = new AudioContext();
      if (audioContext.state === 'suspended') await audioContext.resume();

      // Concatenate all chunks into one buffer
      const totalLength = audioBufferChunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioBufferChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      audioBufferChunks = [];

      const audioBuffer = await audioContext.decodeAudioData(combined.buffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        setState('idle', '');
        isPlaying = false;
      };
      isPlaying = true;
      source.start();
    } catch (err) {
      console.error('[VoiceMic] Audio playback error:', err);
      setState('idle', '');
      audioBufferChunks = [];
    }
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  async function startRecording() {
    if (!wsReady) {
      setState('error', 'Not connected');
      setTimeout(() => setState('idle', ''), 2000);
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // Pick best supported format
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
        .find(m => MediaRecorder.isTypeSupported(m)) || '';

      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
        audioChunks = [];

        // Convert to base64 and send
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        setState('processing', 'Transcribing...');
        sendWs({ type: 'audio', data: base64 });

        // Stop all tracks
        stream?.getTracks().forEach(t => t.stop());
        stream = null;
      };

      mediaRecorder.start(100); // Collect in 100ms chunks
      setState('recording', 'Recording... (click to stop)');

    } catch (err: any) {
      setState('error', 'Microphone access denied');
      setTimeout(() => setState('idle', ''), 3000);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  // ── Main button handler ────────────────────────────────────────────────────

  function handleMicClick() {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle' || state === 'error') {
      audioBufferChunks = [];
      startRecording();
    } else if (state === 'playing') {
      // Stop playback
      audioContext?.close();
      audioContext = null;
      audioBufferChunks = [];
      setState('idle', '');
    } else if (state === 'processing') {
      // Cancel
      sendWs({ type: 'cancel' });
    }
  }

  function toggleExpanded() {
    expanded = !expanded;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    loadSettings();
    connectWs();
  });

  onDestroy(() => {
    stopRecording();
    disconnectWs();
    audioContext?.close();
  });

  // ── Reactive ──────────────────────────────────────────────────────────────

  $: micIcon = state === 'recording' ? '🔴' : state === 'processing' ? '⏳' : state === 'playing' ? '🔊' : state === 'error' ? '❌' : '🎤';
  $: micClass = state === 'recording' ? 'bg-red-500 hover:bg-red-600 animate-pulse' :
                state === 'processing' ? 'bg-yellow-500 hover:bg-yellow-600' :
                state === 'playing' ? 'bg-blue-500 hover:bg-blue-600' :
                state === 'error' ? 'bg-red-700 hover:bg-red-800' :
                wsReady ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-500 hover:bg-gray-600';
  $: showHistory = expanded && history.length > 0;
</script>

<!-- Floating Voice Widget -->
<div class="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-2">

  <!-- History panel (expanded) -->
  {#if expanded}
    <div class="mb-2 w-80 max-h-96 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold text-purple-400 uppercase tracking-wider">Voice Chat</span>
        <a href="/voice" class="text-xs text-slate-400 hover:text-slate-200 underline">Full view →</a>
      </div>

      {#if history.length === 0}
        <p class="text-sm text-slate-500 italic">No conversation yet. Click 🎤 to start.</p>
      {:else}
        {#each history as turn (turn.id)}
          <div class="flex flex-col gap-1">
            <!-- User -->
            <div class="flex justify-end">
              <div class="bg-purple-600/30 text-purple-100 text-sm px-3 py-1.5 rounded-lg rounded-br-sm max-w-[90%]">
                {turn.userText}
              </div>
            </div>
            <!-- Assistant -->
            {#if turn.assistantText}
              <div class="flex justify-start">
                <div class="bg-slate-700 text-slate-100 text-sm px-3 py-1.5 rounded-lg rounded-bl-sm max-w-[90%]">
                  {turn.assistantText}
                </div>
              </div>
            {:else if turn.id === currentTurnId && state === 'processing'}
              <div class="flex justify-start">
                <div class="bg-slate-700 text-slate-400 text-sm px-3 py-1.5 rounded-lg rounded-bl-sm italic">
                  Thinking...
                </div>
              </div>
            {/if}
          </div>
        {/each}
      {/if}

      <!-- Current status -->
      {#if status && state !== 'idle'}
        <div class="text-xs text-center text-slate-400 mt-1">{status}</div>
      {/if}
    </div>
  {/if}

  <!-- Controls row -->
  <div class="flex items-center gap-2">

    <!-- Expand toggle -->
    <button
      on:click={toggleExpanded}
      class="w-8 h-8 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-sm transition-colors shadow-lg"
      title="{expanded ? 'Collapse' : 'Expand'} voice panel"
    >
      {expanded ? '▾' : '▸'}
    </button>

    <!-- Main mic button -->
    <button
      on:click={handleMicClick}
      class="w-12 h-12 rounded-full {micClass} text-white flex items-center justify-center text-xl shadow-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
      title="{state === 'recording' ? 'Stop recording' : state === 'processing' ? 'Cancel' : state === 'playing' ? 'Stop' : 'Start voice'}"
      aria-label="Voice input"
    >
      {micIcon}
    </button>

    <!-- Status bubble -->
    {#if status && !expanded}
      <div class="bg-slate-800/90 text-slate-200 text-xs px-3 py-1.5 rounded-full shadow-lg max-w-xs truncate">
        {status}
      </div>
    {/if}

    <!-- Connection dot -->
    <div
      class="w-2 h-2 rounded-full {wsReady ? 'bg-green-400' : 'bg-red-400'} shadow"
      title="Voice WebSocket {wsReady ? 'connected' : 'disconnected'}"
    ></div>
  </div>
</div>
