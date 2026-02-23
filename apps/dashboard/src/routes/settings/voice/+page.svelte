<script lang="ts">
  import { onMount } from 'svelte';

  // Settings state
  let voiceEnabled = true;
  let agentId = 'cso';
  let sttModel = 'base';
  let piperVoice = 'en_US-lessac-medium';
  let micSensitivity = 50;

  // Sidecar status
  let sidecarStatus: 'checking' | 'online' | 'offline' = 'checking';
  let sidecarInfo: { whisper_model?: string; piper_voice?: string; models_loaded?: boolean } = {};
  let availableVoices: string[] = [];

  // Save state
  let saving = false;
  let saved = false;

  const STT_MODELS = [
    { id: 'tiny', label: 'Tiny — fastest, lower accuracy' },
    { id: 'base', label: 'Base — fast, good accuracy (recommended)' },
    { id: 'small', label: 'Small — slower, better accuracy' },
    { id: 'medium', label: 'Medium — slow, high accuracy' },
  ];

  const PIPER_VOICES = [
    { id: 'en_US-lessac-medium', label: 'Lessac (US English, medium) — recommended' },
    { id: 'en_US-amy-medium', label: 'Amy (US English, medium)' },
    { id: 'en_US-ryan-medium', label: 'Ryan (US English, medium)' },
    { id: 'en_US-joe-medium', label: 'Joe (US English, medium)' },
    { id: 'en_GB-alan-medium', label: 'Alan (British English, medium)' },
    { id: 'en_GB-jenny_dioco-medium', label: 'Jenny (British English, medium)' },
  ];

  const AGENTS = [
    { id: 'cso', label: 'CSO — Chief Strategy Officer (Jarvis)' },
    { id: 'henry', label: 'Henry — Manager' },
  ];

  function loadSettings() {
    if (typeof localStorage === 'undefined') return;
    voiceEnabled = localStorage.getItem('voice_enabled') !== 'false';
    agentId = localStorage.getItem('voice_agent_id') || 'cso';
    sttModel = localStorage.getItem('voice_stt_model') || 'base';
    piperVoice = localStorage.getItem('voice_piper_voice') || 'en_US-lessac-medium';
    micSensitivity = parseInt(localStorage.getItem('voice_mic_sensitivity') || '50');
  }

  function saveSettings() {
    saving = true;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('voice_enabled', voiceEnabled ? 'true' : 'false');
      localStorage.setItem('voice_agent_id', agentId);
      localStorage.setItem('voice_stt_model', sttModel);
      localStorage.setItem('voice_piper_voice', piperVoice);
      localStorage.setItem('voice_mic_sensitivity', micSensitivity.toString());
    }
    setTimeout(() => {
      saving = false;
      saved = true;
      setTimeout(() => { saved = false; }, 3000);
    }, 200);
  }

  async function checkSidecar() {
    sidecarStatus = 'checking';
    try {
      // Try to reach the voice sidecar via the backend proxy health endpoint
      const res = await fetch('/api/voice/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        sidecarInfo = await res.json();
        sidecarStatus = 'online';
      } else {
        sidecarStatus = 'offline';
      }
    } catch {
      sidecarStatus = 'offline';
    }

    // Load available voices
    try {
      const res = await fetch('/api/voice/voices', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        availableVoices = data.voices || [];
      }
    } catch {
      // ignore
    }
  }

  onMount(() => {
    loadSettings();
    checkSidecar();
  });
</script>

<div class="max-w-2xl space-y-6">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">🎙️ Voice Settings</h2>
    <a href="/settings" class="text-sm text-blue-400 hover:text-blue-300">← Back to Settings</a>
  </div>

  <!-- Sidecar Status -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-medium">🔌 Voice Sidecar Status</h3>
      <button
        on:click={checkSidecar}
        class="text-xs text-blue-400 hover:text-blue-300 underline"
      >
        Refresh
      </button>
    </div>

    <div class="flex items-center gap-2 mb-2">
      {#if sidecarStatus === 'checking'}
        <span class="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse"></span>
        <span class="text-sm text-slate-400">Checking…</span>
      {:else if sidecarStatus === 'online'}
        <span class="w-2.5 h-2.5 rounded-full bg-green-400"></span>
        <span class="text-sm text-green-400">Online</span>
      {:else}
        <span class="w-2.5 h-2.5 rounded-full bg-red-400"></span>
        <span class="text-sm text-red-400">Offline</span>
      {/if}
    </div>

    {#if sidecarStatus === 'offline'}
      <div class="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-300">
        <p class="font-medium mb-1">Voice sidecar not running</p>
        <p class="text-amber-400/80">Start it with:</p>
        <code class="block mt-1 bg-slate-900 rounded px-2 py-1 text-xs font-mono">
          cd ~/.openclaw/workspace/mission-clawtrol/services/voice<br>
          python3 main.py
        </code>
        <p class="mt-2 text-amber-400/80">Or use PM2 to start all services:</p>
        <code class="block mt-1 bg-slate-900 rounded px-2 py-1 text-xs font-mono">
          cd ~/.openclaw/workspace/mission-clawtrol<br>
          pm2 start ecosystem.config.cjs
        </code>
      </div>
    {:else if sidecarStatus === 'online'}
      <div class="grid grid-cols-2 gap-2 text-sm mt-2">
        <div class="text-slate-400">Whisper Model:</div>
        <div class="font-mono text-slate-200">{sidecarInfo.whisper_model || '—'}</div>
        <div class="text-slate-400">Piper Voice:</div>
        <div class="font-mono text-slate-200">{sidecarInfo.piper_voice || '—'}</div>
        <div class="text-slate-400">Models Loaded:</div>
        <div class="{sidecarInfo.models_loaded ? 'text-green-400' : 'text-yellow-400'}">
          {sidecarInfo.models_loaded ? '✓ In memory' : 'Loading…'}
        </div>
      </div>
    {/if}
  </div>

  <!-- Enable/Disable -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">⚙️ General</h3>

    <div class="flex items-center justify-between">
      <div>
        <div class="font-medium">Enable Voice Interface</div>
        <div class="text-sm text-slate-500 dark:text-slate-400">
          Show the floating mic button on all pages
        </div>
      </div>
      <label class="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" bind:checked={voiceEnabled} class="sr-only peer">
        <div class="w-11 h-6 bg-gray-100 dark:bg-slate-700 peer-focus:outline-none rounded-full peer
                    peer-checked:after:translate-x-full peer-checked:after:border-white
                    after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                    after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all
                    peer-checked:bg-purple-600"></div>
      </label>
    </div>
  </div>

  <!-- Agent Selection -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">🤖 AI Agent</h3>

    <div>
      <label for="agent-select" class="block text-sm font-medium mb-2">Talk to</label>
      <select
        id="agent-select"
        bind:value={agentId}
        class="bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm w-full"
      >
        {#each AGENTS as agent}
          <option value={agent.id}>{agent.label}</option>
        {/each}
      </select>
      <p class="text-xs text-slate-500 mt-1">This agent will receive your voice messages.</p>
    </div>
  </div>

  <!-- STT Settings -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">🎤 Speech-to-Text (faster-whisper)</h3>

    <div>
      <label for="stt-model" class="block text-sm font-medium mb-2">Whisper Model</label>
      <select
        id="stt-model"
        bind:value={sttModel}
        class="bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm w-full"
      >
        {#each STT_MODELS as model}
          <option value={model.id}>{model.label}</option>
        {/each}
      </select>
      <p class="text-xs text-slate-500 mt-1">
        Model downloads automatically on first use. CPU-only inference — no GPU required.
      </p>
    </div>

    <div class="mt-4">
      <label for="mic-sensitivity" class="block text-sm font-medium mb-2">
        Mic Sensitivity — {micSensitivity}%
      </label>
      <input
        id="mic-sensitivity"
        type="range"
        min="0"
        max="100"
        bind:value={micSensitivity}
        class="w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
      >
      <p class="text-xs text-slate-500 mt-1">Higher = more sensitive (may pick up background noise).</p>
    </div>
  </div>

  <!-- TTS Settings -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">🔊 Text-to-Speech (Piper TTS)</h3>

    <div>
      <label for="piper-voice" class="block text-sm font-medium mb-2">Voice</label>
      <select
        id="piper-voice"
        bind:value={piperVoice}
        class="bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm w-full"
      >
        {#each PIPER_VOICES as voice}
          <option value={voice.id}>{voice.label}</option>
        {/each}
      </select>
      <p class="text-xs text-slate-500 mt-1">
        Voice model downloads automatically on first use (~50MB each). CPU-only.
      </p>
    </div>

    {#if availableVoices.length > 0}
      <div class="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded">
        <p class="text-xs text-green-400 font-medium mb-1">Downloaded voices:</p>
        <div class="flex flex-wrap gap-1 mt-1">
          {#each availableVoices as v}
            <span class="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded">{v}</span>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- How to Use -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-3">📖 How to Use</h3>
    <ol class="text-sm text-slate-400 space-y-2 list-decimal list-inside">
      <li>Look for the <strong class="text-purple-400">🎤 purple mic button</strong> in the bottom-left corner</li>
      <li>Click it to start recording — button turns <strong class="text-red-400">red 🔴</strong></li>
      <li>Speak your message, then click again to stop</li>
      <li>Wait while Jarvis processes — button shows <strong class="text-yellow-400">⏳ thinking</strong></li>
      <li>Audio response plays automatically — button shows <strong class="text-blue-400">🔊 playing</strong></li>
      <li>Expand the panel with <strong class="text-slate-300">▸</strong> to see conversation history</li>
    </ol>
    <p class="text-xs text-slate-500 mt-3">
      💡 Tip: Click the mic during playback to stop audio early.
    </p>
  </div>

  <!-- Save Button -->
  <div class="flex items-center justify-end gap-3">
    {#if saved}
      <span class="text-sm text-green-400">✅ Settings saved</span>
    {/if}
    <button
      on:click={saveSettings}
      disabled={saving}
      class="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded font-medium transition-colors"
    >
      {saving ? 'Saving…' : 'Save Settings'}
    </button>
  </div>
</div>
