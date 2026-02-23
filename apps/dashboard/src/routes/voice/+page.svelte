<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getVoiceWsUrl } from '$lib/config';

  // ── State ──────────────────────────────────────────────────────────────────

  type VoiceState = 'idle' | 'recording' | 'processing' | 'playing' | 'error';

  let state: VoiceState = 'idle';
  let statusText = '';
  let transcript = '';
  let responseText = '';

  // Settings
  let agentId = 'cso';
  let sttModel = 'base';
  let voiceEnabled = true;

  let settingsOpen = false;

  // ── WebSocket ──────────────────────────────────────────────────────────────

  let ws: WebSocket | null = null;
  let wsReady = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Audio Recording ────────────────────────────────────────────────────────

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let recordingDuration = 0;
  let recordingTimer: ReturnType<typeof setInterval> | null = null;

  // ── Audio Playback ─────────────────────────────────────────────────────────

  let audioContext: AudioContext | null = null;
  let audioBufferChunks: Uint8Array[] = [];

  // ── Conversation History ───────────────────────────────────────────────────

  interface Turn {
    id: string;
    userText: string;
    assistantText: string;
    responseRaw: string;
    timestamp: number;
    pending: boolean;
  }

  let history: Turn[] = [];
  let currentTurnId = '';
  let conversationEl: HTMLElement;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function uuid(): string {
    return crypto.randomUUID();
  }

  function scrollToBottom() {
    if (conversationEl) {
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function loadSettings() {
    if (typeof localStorage === 'undefined') return;
    agentId = localStorage.getItem('voice_agent_id') || 'cso';
    sttModel = localStorage.getItem('voice_stt_model') || 'base';
    voiceEnabled = localStorage.getItem('voice_tts_enabled') !== 'false';
  }

  function saveSettings() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('voice_agent_id', agentId);
    localStorage.setItem('voice_stt_model', sttModel);
    localStorage.setItem('voice_tts_enabled', String(voiceEnabled));
    // Reconnect with new settings
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'config', agentId, sttModel }));
    }
    settingsOpen = false;
  }

  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const url = getVoiceWsUrl();
    ws = new WebSocket(url);

    ws.onopen = () => {
      ws!.send(JSON.stringify({ type: 'config', agentId, sttModel }));
    };

    ws.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleVoiceMessage(msg);
    };

    ws.onclose = () => {
      wsReady = false;
      ws = null;
      reconnectTimer = setTimeout(connectWs, 5000);
    };

    ws.onerror = () => { wsReady = false; };
  }

  function sendWs(data: object) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  // ── Message Handler ────────────────────────────────────────────────────────

  function handleVoiceMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
      case 'config_ok':
        wsReady = true;
        if (state === 'idle' || state === 'error') {
          state = 'idle';
          statusText = 'Ready — click the mic to start';
        }
        break;

      case 'transcript':
        transcript = msg.text || '';
        if (transcript) {
          currentTurnId = uuid();
          history = [...history, {
            id: currentTurnId,
            userText: transcript,
            assistantText: '',
            responseRaw: '',
            timestamp: Date.now(),
            pending: true,
          }];
          setTimeout(scrollToBottom, 50);
        }
        state = 'processing';
        statusText = 'Thinking...';
        break;

      case 'thinking':
        state = 'processing';
        statusText = 'Thinking...';
        break;

      case 'response_text':
        responseText = msg.text || '';
        if (currentTurnId) {
          history = history.map(t =>
            t.id === currentTurnId
              ? { ...t, assistantText: msg.text, responseRaw: msg.text, pending: !msg.final }
              : t
          );
          setTimeout(scrollToBottom, 50);
        }
        if (!msg.final) statusText = 'Responding...';
        break;

      case 'audio_chunk':
        if (voiceEnabled) {
          const chunk = base64ToArrayBuffer(msg.data);
          audioBufferChunks.push(new Uint8Array(chunk));
        }
        break;

      case 'audio_end':
        if (voiceEnabled && audioBufferChunks.length > 0) {
          state = 'playing';
          statusText = 'Playing response...';
          playCollectedAudio();
        } else {
          state = 'idle';
          statusText = 'Ready';
          audioBufferChunks = [];
        }
        break;

      case 'error':
        state = 'error';
        statusText = msg.message || 'Error';
        setTimeout(() => { if (state === 'error') { state = 'idle'; statusText = 'Ready'; } }, 4000);
        break;

      case 'cancelled':
        state = 'idle';
        statusText = 'Cancelled';
        setTimeout(() => { if (statusText === 'Cancelled') statusText = 'Ready'; }, 2000);
        break;
    }
  }

  // ── Audio Playback ─────────────────────────────────────────────────────────

  async function playCollectedAudio() {
    try {
      if (!audioContext) audioContext = new AudioContext();
      if (audioContext.state === 'suspended') await audioContext.resume();

      const totalLength = audioBufferChunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioBufferChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      audioBufferChunks = [];

      const buffer = await audioContext.decodeAudioData(combined.buffer);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        state = 'idle';
        statusText = 'Ready — click the mic to continue';
      };
      source.start();
    } catch (err) {
      console.error('[Voice] Playback error:', err);
      state = 'idle';
      statusText = 'Ready';
      audioBufferChunks = [];
    }
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  async function startRecording() {
    if (!wsReady) { statusText = 'Not connected'; return; }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
        .find(m => MediaRecorder.isTypeSupported(m)) || '';

      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stopRecordingTimer();
        const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
        audioChunks = [];

        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        state = 'processing';
        statusText = 'Transcribing...';
        audioBufferChunks = [];
        sendWs({ type: 'audio', data: base64 });

        stream?.getTracks().forEach(t => t.stop());
        stream = null;
      };

      mediaRecorder.start(100);
      state = 'recording';
      statusText = 'Recording... click again to stop';
      recordingDuration = 0;
      recordingTimer = setInterval(() => { recordingDuration++; }, 1000);

    } catch (err: any) {
      state = 'error';
      statusText = 'Microphone access denied';
      setTimeout(() => { state = 'idle'; statusText = 'Ready'; }, 3000);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    stopRecordingTimer();
  }

  function stopRecordingTimer() {
    if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  }

  function handleMicClick() {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle' || state === 'error') {
      startRecording();
    } else if (state === 'playing') {
      audioContext?.close().catch(() => {});
      audioContext = null;
      audioBufferChunks = [];
      state = 'idle';
      statusText = 'Ready';
    } else if (state === 'processing') {
      sendWs({ type: 'cancel' });
    }
  }

  function clearHistory() {
    history = [];
    transcript = '';
    responseText = '';
    currentTurnId = '';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    loadSettings();
    connectWs();
    statusText = 'Connecting...';
  });

  onDestroy(() => {
    stopRecording();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    audioContext?.close().catch(() => {});
  });

  // ── Reactive ──────────────────────────────────────────────────────────────

  $: micLabel = state === 'recording' ? 'Stop' : state === 'processing' ? 'Cancel' : state === 'playing' ? 'Stop' : 'Speak';
  $: micClass = state === 'recording'
    ? 'bg-red-500 hover:bg-red-600 animate-pulse shadow-red-500/50'
    : state === 'processing'
    ? 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-500/50'
    : state === 'playing'
    ? 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/50'
    : state === 'error'
    ? 'bg-red-700 hover:bg-red-800 shadow-red-700/50'
    : wsReady
    ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/50'
    : 'bg-gray-500 cursor-not-allowed';
</script>

<div class="max-w-3xl mx-auto flex flex-col gap-6">

  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-slate-100">🎙️ Voice — Talk to Jarvis</h1>
      <p class="text-sm text-slate-400 mt-1">Browser mic → faster-whisper → OpenClaw → Piper TTS</p>
    </div>
    <div class="flex items-center gap-3">
      <!-- Connection status -->
      <div class="flex items-center gap-2 text-sm">
        <div class="w-2 h-2 rounded-full {wsReady ? 'bg-green-400' : 'bg-red-400'}"></div>
        <span class="text-slate-400">{wsReady ? 'Connected' : 'Connecting...'}</span>
      </div>

      <!-- Settings toggle -->
      <button
        on:click={() => settingsOpen = !settingsOpen}
        class="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
        title="Voice settings"
      >⚙️</button>

      <!-- Clear history -->
      {#if history.length > 0}
        <button
          on:click={clearHistory}
          class="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors text-sm"
          title="Clear conversation"
        >🗑️</button>
      {/if}
    </div>
  </div>

  <!-- Settings panel -->
  {#if settingsOpen}
    <div class="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col gap-4">
      <h3 class="text-sm font-semibold text-slate-300 uppercase tracking-wider">Voice Settings</h3>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="agent-id">Agent ID</label>
          <input
            id="agent-id"
            bind:value={agentId}
            class="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
            placeholder="jarvis"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="stt-model">Whisper Model</label>
          <select
            id="stt-model"
            bind:value={sttModel}
            class="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-purple-500"
          >
            <option value="tiny">tiny (fastest, less accurate)</option>
            <option value="base">base (fast, good accuracy)</option>
            <option value="small">small (slower, better)</option>
            <option value="medium">medium (slowest, best)</option>
          </select>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <label class="text-sm text-slate-300 flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            bind:checked={voiceEnabled}
            class="w-4 h-4 accent-purple-500"
          />
          Enable TTS audio playback
        </label>
      </div>

      <div class="flex gap-3">
        <button
          on:click={saveSettings}
          class="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm text-white font-medium transition-colors"
        >Save</button>
        <button
          on:click={() => settingsOpen = false}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors"
        >Cancel</button>
      </div>
    </div>
  {/if}

  <!-- Conversation -->
  <div
    bind:this={conversationEl}
    class="flex-1 min-h-[400px] max-h-[500px] overflow-y-auto bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex flex-col gap-4"
  >
    {#if history.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-3 py-16">
        <span class="text-6xl">🎙️</span>
        <p class="text-center">Click the mic button below to start a voice conversation.</p>
        <p class="text-center text-xs text-slate-600">Powered by faster-whisper (STT) + OpenClaw + Piper (TTS)</p>
      </div>
    {:else}
      {#each history as turn (turn.id)}
        <div class="flex flex-col gap-2">
          <!-- User message -->
          <div class="flex justify-end">
            <div class="flex flex-col items-end gap-1">
              <div class="bg-purple-600/30 border border-purple-500/30 text-purple-100 text-sm px-4 py-2.5 rounded-2xl rounded-br-sm max-w-lg">
                {turn.userText}
              </div>
              <span class="text-xs text-slate-600">{formatTime(turn.timestamp)} · You</span>
            </div>
          </div>

          <!-- Assistant message -->
          {#if turn.assistantText}
            <div class="flex justify-start">
              <div class="flex flex-col items-start gap-1">
                <div class="bg-slate-700 border border-slate-600/50 text-slate-100 text-sm px-4 py-2.5 rounded-2xl rounded-bl-sm max-w-lg whitespace-pre-wrap">
                  {turn.assistantText}
                </div>
                <span class="text-xs text-slate-600">Jarvis</span>
              </div>
            </div>
          {:else if turn.id === currentTurnId && (state === 'processing' || state === 'playing')}
            <div class="flex justify-start">
              <div class="bg-slate-700 border border-slate-600/50 text-slate-400 text-sm px-4 py-2.5 rounded-2xl rounded-bl-sm">
                <span class="animate-pulse">Thinking...</span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Mic control area -->
  <div class="flex flex-col items-center gap-4 py-4">

    <!-- Status text -->
    <div class="h-6 flex items-center">
      {#if statusText}
        <span class="text-sm text-slate-400 {state === 'error' ? 'text-red-400' : ''}">
          {statusText}
        </span>
      {/if}
    </div>

    <!-- Recording timer -->
    {#if state === 'recording'}
      <div class="text-red-400 text-sm font-mono">
        🔴 {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:{(recordingDuration % 60).toString().padStart(2, '0')}
      </div>
    {/if}

    <!-- Main mic button -->
    <button
      on:click={handleMicClick}
      disabled={!wsReady && state === 'idle'}
      class="w-20 h-20 rounded-full {micClass} text-white flex flex-col items-center justify-center shadow-xl transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-purple-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="{micLabel} voice input"
    >
      {#if state === 'recording'}
        <span class="text-3xl">⏹️</span>
        <span class="text-xs mt-0.5">Stop</span>
      {:else if state === 'processing'}
        <span class="text-3xl animate-spin">⚙️</span>
        <span class="text-xs mt-0.5">Cancel</span>
      {:else if state === 'playing'}
        <span class="text-3xl">🔊</span>
        <span class="text-xs mt-0.5">Stop</span>
      {:else}
        <span class="text-3xl">🎤</span>
        <span class="text-xs mt-0.5">{micLabel}</span>
      {/if}
    </button>

    <!-- Keyboard shortcut hint -->
    <p class="text-xs text-slate-600">
      {#if state === 'idle'}
        Click to start recording
      {:else if state === 'recording'}
        Click again to stop and send
      {:else if state === 'processing'}
        Processing your message...
      {:else if state === 'playing'}
        Playing Jarvis's response
      {/if}
    </p>
  </div>

</div>
