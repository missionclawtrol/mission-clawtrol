<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { panel } from '$lib/stores/panel';
  import { getGatewayWsUrl, getPtyWsUrl, getApiBase } from '$lib/config';

  // ── Types ─────────────────────────────────────────────────────────────────

  interface Agent {
    id: string;
    name: string;
    emoji: string;
    model: string;
  }

  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    streaming?: boolean;
  }

  // ── Panel State ───────────────────────────────────────────────────────────

  let isOpen = false;
  let mode: 'chat' | 'terminal' = 'terminal';

  const unsubscribe = panel.subscribe((s) => {
    isOpen = s.open;
    mode = s.mode;
    if (s.open && s.mode === 'terminal' && terminalReady) {
      tick().then(() => fitTerminal());
    }
  });

  // ── Chat State ────────────────────────────────────────────────────────────

  let agents: Agent[] = [];
  let selectedAgentId = '';
  let messages: ChatMessage[] = [];
  let inputText = '';
  let isThinking = false;
  let proxyReady = false;
  let wsConnected = false;
  let chatStatusText = 'Connecting...';
  let chatErrorText = '';
  let messagesEl: HTMLElement;
  let textareaEl: HTMLTextAreaElement;

  let chatWs: WebSocket | null = null;
  let chatReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let streamingId: string | null = null;
  const pendingReqs = new Map<string, (payload: any) => void>();

  // ── Terminal State ────────────────────────────────────────────────────────

  let terminalEl: HTMLElement;
  let terminalReady = false;
  let ptyWs: WebSocket | null = null;
  let ptyReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let termError = '';
  let termConnected = false;

  // xterm instances (loaded dynamically)
  let xterm: any = null;
  let fitAddon: any = null;
  let xtermLoaded = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function uuid(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function now(): number { return Date.now(); }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderMarkdown(text: string): string {
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    escaped = escaped.replace(/```([a-zA-Z]*)\n?([\s\S]*?)```/g, (_m: string, lang: string, code: string) => {
      const label = lang ? `<span class="code-lang">${lang}</span>` : '';
      return `<pre class="code-block">${label}<code>${code.trim()}</code></pre>`;
    });
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    escaped = escaped.replace(/\n/g, '<br>');
    return escaped;
  }

  async function scrollToBottom() {
    await tick();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Chat — Agent loading ──────────────────────────────────────────────────

  async function loadAgents() {
    try {
      const res = await fetch(`${getApiBase()}/agents/roster`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      agents = (data.agents || []).map((a: any) => ({
        id: a.id,
        name: a.name || a.id,
        emoji: a.emoji || '🤖',
        model: a.model || '',
      }));
      if (agents.length > 0 && !selectedAgentId) selectedAgentId = agents[0].id;
    } catch {
      agents = [{ id: 'manager', name: 'Henry', emoji: '🎯', model: '' }];
      selectedAgentId = 'manager';
    }
  }

  // ── Chat — WebSocket ──────────────────────────────────────────────────────

  function connectChat() {
    if (chatWs && (chatWs.readyState === WebSocket.OPEN || chatWs.readyState === WebSocket.CONNECTING)) return;
    chatStatusText = 'Connecting…';
    wsConnected = false;
    proxyReady = false;
    chatErrorText = '';
    const url = getGatewayWsUrl();
    chatWs = new WebSocket(url);

    chatWs.onopen = () => { wsConnected = true; chatStatusText = 'Handshaking…'; };
    chatWs.onmessage = (e) => {
      try { handleGatewayMessage(JSON.parse(e.data)); } catch {}
    };
    chatWs.onclose = () => {
      wsConnected = false; proxyReady = false;
      chatStatusText = 'Disconnected — reconnecting…';
      scheduleReconnect();
    };
    chatWs.onerror = () => {
      chatStatusText = 'Connection error';
      chatErrorText = 'Could not reach the gateway proxy.';
    };
  }

  function scheduleReconnect() {
    if (chatReconnectTimer) clearTimeout(chatReconnectTimer);
    chatReconnectTimer = setTimeout(() => { chatReconnectTimer = null; connectChat(); }, 4000);
  }

  function disconnectChat() {
    if (chatReconnectTimer) { clearTimeout(chatReconnectTimer); chatReconnectTimer = null; }
    chatWs?.close(); chatWs = null;
  }

  function sendChatWs(data: object) {
    if (chatWs?.readyState === WebSocket.OPEN) chatWs.send(JSON.stringify(data));
  }

  function handleGatewayMessage(msg: any) {
    if (msg.type === 'proxy-ready') {
      proxyReady = true; chatStatusText = 'Connected'; chatErrorText = '';
      if (selectedAgentId) loadHistory(selectedAgentId);
      return;
    }
    if (msg.type === 'error') { chatStatusText = 'Error'; chatErrorText = msg.error || 'Unknown error'; return; }
    if (msg.type === 'res') {
      const cb = pendingReqs.get(msg.id);
      if (cb) {
        pendingReqs.delete(msg.id);
        if (msg.ok) cb(msg.payload);
        else { isThinking = false; chatErrorText = msg.error?.message || 'Request failed'; }
      }
      return;
    }
    if (msg.type === 'event') handleGatewayEvent(msg.event, msg.payload);
  }

  function handleGatewayEvent(event: string, payload: any) {
    if (event === 'chat') {
      const state = payload?.state;
      const messageData = payload?.message;
      if (state === 'delta' && messageData) {
        const fullText = messageData.content?.find((c: any) => c.type === 'text')?.text ?? '';
        if (!fullText) return;
        if (streamingId) {
          messages = messages.map(m => m.id === streamingId ? { ...m, content: fullText } : m);
        } else {
          streamingId = uuid();
          messages = [...messages, { id: streamingId, role: 'assistant', content: fullText, timestamp: now(), streaming: true }];
        }
        scrollToBottom(); return;
      }
      if (state === 'final') {
        const finalText = messageData?.content?.find((c: any) => c.type === 'text')?.text ?? '';
        if (streamingId) {
          messages = messages.map(m => m.id === streamingId ? { ...m, content: finalText || m.content, streaming: false } : m);
          streamingId = null;
        } else if (finalText) {
          messages = [...messages, { id: uuid(), role: 'assistant', content: finalText, timestamp: now() }];
        } else { fetchLatestResponse(); return; }
        isThinking = false; scrollToBottom(); return;
      }
      if (state === 'aborted' || state === 'error') {
        if (streamingId) { messages = messages.map(m => m.id === streamingId ? { ...m, streaming: false } : m); streamingId = null; }
        isThinking = false;
        if (state === 'error') chatErrorText = 'Agent encountered an error';
        scrollToBottom(); return;
      }
      return;
    }
    if (event === 'chat.chunk' || event === 'chat.delta') {
      const delta = payload?.delta ?? payload?.content ?? payload?.text ?? '';
      if (!delta) return;
      if (streamingId) {
        messages = messages.map(m => m.id === streamingId ? { ...m, content: m.content + delta } : m);
      } else {
        streamingId = uuid();
        messages = [...messages, { id: streamingId, role: 'assistant', content: delta, timestamp: now(), streaming: true }];
      }
      scrollToBottom(); return;
    }
    if (event === 'chat.done' || event === 'chat.complete') {
      if (streamingId) { messages = messages.map(m => m.id === streamingId ? { ...m, streaming: false } : m); streamingId = null; }
      isThinking = false; scrollToBottom(); return;
    }
    if (event === 'chat.message') {
      const content = payload?.message ?? payload?.content ?? '';
      if (content) { messages = [...messages, { id: uuid(), role: 'assistant', content, timestamp: now() }]; isThinking = false; scrollToBottom(); }
    }
  }

  function fetchLatestResponse() {
    if (!proxyReady || !selectedAgentId) { isThinking = false; return; }
    const reqId = uuid();
    sendChatWs({ type: 'req', id: reqId, method: 'chat.history', params: { sessionKey: `agent:${selectedAgentId}:mc-chat` } });
    pendingReqs.set(reqId, (payload: any) => {
      const history: Array<{ role: string; content: any }> = payload?.messages ?? payload?.history ?? [];
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role === 'assistant') {
          let text = '';
          if (typeof m.content === 'string') text = m.content;
          else if (Array.isArray(m.content)) text = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
          if (text) { messages = [...messages, { id: uuid(), role: 'assistant', content: text, timestamp: now() }]; scrollToBottom(); }
          break;
        }
      }
      isThinking = false;
    });
  }

  function loadHistory(agentId: string) {
    if (!proxyReady) return;
    const reqId = uuid();
    sendChatWs({ type: 'req', id: reqId, method: 'chat.history', params: { sessionKey: `agent:${agentId}:mc-chat` } });
    pendingReqs.set(reqId, (payload: any) => {
      const history: Array<{ role: string; content: any; timestamp?: number }> = payload?.messages ?? payload?.history ?? [];
      messages = history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          let text = '';
          if (typeof m.content === 'string') text = m.content;
          else if (Array.isArray(m.content)) text = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
          return { id: uuid(), role: m.role as 'user' | 'assistant', content: text, timestamp: m.timestamp || now() };
        })
        .filter(m => m.content);
      const clearedAt = Number(localStorage.getItem(`chat-cleared-${agentId}`) || '0');
      if (clearedAt) messages = messages.filter(m => m.timestamp > clearedAt);
      if (messages.length === 0) {
        const selectedAgent = agents.find(a => a.id === agentId);
        const agentName = selectedAgent?.name || agentId;
        const agentEmoji = selectedAgent?.emoji || '🤖';
        const otherAgents = agents.filter(a => a.id !== agentId);
        const teamList = otherAgents.length > 0
          ? '\n\n**Your team:**\n' + otherAgents.map(a => `- ${a.emoji} **${a.name}**`).join('\n')
          : '';
        messages = [{
          id: uuid(), role: 'assistant', timestamp: now(),
          content: `${agentEmoji} **Hi, I'm ${agentName}.** How can I help?${teamList}`,
        }];
      }
      scrollToBottom();
    });
  }

  async function sendMessage() {
    const text = inputText.trim();
    if (!text) return;
    if (isThinking || streamingId) stopResponse();
    if (!proxyReady) { chatErrorText = 'Not connected to gateway. Please wait…'; return; }
    chatErrorText = '';
    inputText = '';
    resetTextarea();
    const userMsg: ChatMessage = { id: uuid(), role: 'user', content: text, timestamp: now() };
    messages = [...messages, userMsg];
    isThinking = true; streamingId = null;
    await scrollToBottom();
    const reqId = uuid();
    const sessionKey = `agent:${selectedAgentId}:mc-chat`;
    sendChatWs({ type: 'req', id: reqId, method: 'chat.send', params: { sessionKey, message: text, idempotencyKey: uuid() } });
    pendingReqs.set(reqId, (payload: any) => {
      const content = payload?.message ?? payload?.reply ?? payload?.content ?? '';
      if (content && !streamingId) {
        messages = [...messages, { id: uuid(), role: 'assistant', content, timestamp: now() }];
        isThinking = false; scrollToBottom();
      }
    });
  }

  function onAgentChange() {
    messages = []; streamingId = null; isThinking = false;
    if (proxyReady) loadHistory(selectedAgentId);
  }

  function resetTextarea() {
    if (textareaEl) textareaEl.style.height = 'auto';
  }

  function autoResize() {
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
    }
  }

  function stopResponse() {
    if (streamingId) {
      messages = messages.map(m => m.id === streamingId ? { ...m, streaming: false } : m);
      streamingId = null;
    }
    isThinking = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); stopResponse(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  // ── Terminal — xterm.js ───────────────────────────────────────────────────

  async function initTerminal() {
    if (terminalReady || !terminalEl) return;
    try {
      const [xtermMod, fitMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);

      xterm = new xtermMod.Terminal({
        theme: {
          background: '#0f172a',
          foreground: '#e2e8f0',
          cursor: '#60a5fa',
          selectionBackground: 'rgba(59,130,246,0.3)',
          black: '#1e293b',
          brightBlack: '#475569',
          red: '#f87171',
          brightRed: '#fca5a5',
          green: '#4ade80',
          brightGreen: '#86efac',
          yellow: '#facc15',
          brightYellow: '#fde047',
          blue: '#60a5fa',
          brightBlue: '#93c5fd',
          magenta: '#c084fc',
          brightMagenta: '#d8b4fe',
          cyan: '#22d3ee',
          brightCyan: '#67e8f9',
          white: '#e2e8f0',
          brightWhite: '#f8fafc',
        },
        fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 5000,
        allowProposedApi: true,
      });

      fitAddon = new fitMod.FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.open(terminalEl);
      fitAddon.fit();
      terminalReady = true;
      xtermLoaded = true;

      // Send user input to PTY
      xterm.onData((data: string) => {
        if (ptyWs?.readyState === WebSocket.OPEN) {
          ptyWs.send(JSON.stringify({ type: 'input', data }));
        }
      });

      connectPty();
    } catch (err) {
      console.error('[Terminal] Failed to init xterm:', err);
      termError = `Failed to load terminal: ${err}`;
    }
  }

  function fitTerminal() {
    if (!fitAddon || !terminalEl) return;
    try {
      fitAddon.fit();
      if (ptyWs?.readyState === WebSocket.OPEN) {
        const { cols, rows } = xterm;
        ptyWs.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    } catch {}
  }

  function connectPty() {
    if (ptyWs && (ptyWs.readyState === WebSocket.OPEN || ptyWs.readyState === WebSocket.CONNECTING)) return;
    termConnected = false;
    termError = '';
    const url = getPtyWsUrl();
    ptyWs = new WebSocket(url);

    ptyWs.onopen = () => {
      termConnected = true;
      // Send initial size
      if (xterm) {
        const { cols, rows } = xterm;
        ptyWs!.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
      xterm?.write('\x1b[32m[Terminal connected]\x1b[0m\r\n');
    };

    ptyWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') xterm?.write(msg.data);
        else if (msg.type === 'exit') {
          xterm?.write(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
          termConnected = false;
          schedulePtyReconnect();
        } else if (msg.type === 'error') {
          termError = msg.message;
          xterm?.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
        }
      } catch {}
    };

    ptyWs.onclose = () => {
      termConnected = false;
      if (terminalReady) schedulePtyReconnect();
    };

    ptyWs.onerror = () => {
      termConnected = false;
      termError = 'Connection to terminal backend failed';
    };
  }

  function schedulePtyReconnect() {
    if (ptyReconnectTimer) clearTimeout(ptyReconnectTimer);
    ptyReconnectTimer = setTimeout(() => {
      ptyReconnectTimer = null;
      if (terminalReady) connectPty();
    }, 3000);
  }

  function disconnectPty() {
    if (ptyReconnectTimer) { clearTimeout(ptyReconnectTimer); ptyReconnectTimer = null; }
    ptyWs?.close(); ptyWs = null;
  }

  // ── Reactive — open/mode changes ──────────────────────────────────────────

  $: if (isOpen && mode === 'terminal' && !terminalReady) {
    tick().then(() => initTerminal());
  }

  $: if (isOpen && mode === 'terminal' && terminalReady) {
    tick().then(() => fitTerminal());
  }

  $: if (selectedAgentId) onAgentChange();
  $: if (agents.length > 0 && !selectedAgentId) selectedAgentId = agents[0].id;
  $: selectedAgent = agents.find(a => a.id === selectedAgentId);
  $: chatStatusDot = proxyReady ? 'green' : wsConnected ? 'yellow' : 'red';

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(async () => {
    await loadAgents();
    connectChat();
  });

  onDestroy(() => {
    unsubscribe();
    disconnectChat();
    disconnectPty();
    xterm?.dispose();
  });

  function closePanel() { panel.close(); }
  function setMode(m: 'chat' | 'terminal') { panel.setMode(m); }
</script>

<!-- Overlay backdrop -->
{#if isOpen}
  <div
    class="panel-backdrop"
    on:click={closePanel}
    on:keydown={(e) => e.key === 'Escape' && closePanel()}
    role="button"
    tabindex="0"
    aria-label="Close panel"
  ></div>
{/if}

<!-- Slide-out panel -->
<div class="slide-panel" class:open={isOpen}>
  <!-- Panel Header -->
  <div class="panel-header">
    <!-- Mode tabs -->
    <div class="mode-tabs">
      <button
        class="mode-tab active"
      >
        💻 Terminal
      </button>
    </div>

    <!-- Right side controls -->
    <div class="panel-header-right">
      {#if mode === 'chat'}
        <!-- Agent selector -->
        <select
          bind:value={selectedAgentId}
          class="agent-select"
          title="Select agent"
        >
          {#each agents as agent}
            <option value={agent.id}>{agent.emoji} {agent.name}</option>
          {/each}
        </select>
        <!-- Status dot -->
        <span
          class="status-dot"
          class:green={chatStatusDot === 'green'}
          class:yellow={chatStatusDot === 'yellow'}
          class:red={chatStatusDot === 'red'}
          title={chatStatusText}
        ></span>
      {:else}
        <!-- Terminal status dot -->
        <span
          class="status-dot"
          class:green={termConnected}
          class:red={!termConnected}
          title={termConnected ? 'Terminal connected' : 'Terminal disconnected'}
        ></span>
      {/if}
      <!-- Close button -->
      <button class="close-btn" on:click={closePanel} title="Close panel">✕</button>
    </div>
  </div>

  <!-- Chat Mode -->
  <div class="panel-body" class:hidden={mode !== 'chat'}>
    <!-- Error banner -->
    {#if chatErrorText}
      <div class="error-bar">⚠️ {chatErrorText}</div>
    {/if}

    <!-- Messages -->
    <div class="messages-area" bind:this={messagesEl}>
      {#if messages.length === 0 && !isThinking}
        <div class="empty-state">
          <span class="text-4xl">{selectedAgent?.emoji ?? '🤖'}</span>
          <p>Chat with {selectedAgent?.name ?? 'agent'}</p>
          <p class="text-sm opacity-60">Type a message below to get started.</p>
        </div>
      {/if}

      {#each messages as msg (msg.id)}
        <div class="msg-row" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
          {#if msg.role === 'assistant'}
            <div class="avatar">{selectedAgent?.emoji ?? '🤖'}</div>
          {/if}
          <div class="bubble" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(msg.content)}
            {#if msg.streaming}<span class="cursor-blink">▌</span>{/if}
            <div class="msg-time">{formatTime(msg.timestamp)}</div>
          </div>
          {#if msg.role === 'user'}
            <div class="avatar user-av">You</div>
          {/if}
        </div>
      {/each}

      {#if isThinking && !streamingId}
        <div class="msg-row assistant">
          <div class="avatar">{selectedAgent?.emoji ?? '🤖'}</div>
          <div class="bubble assistant thinking">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Input -->
    <div class="input-area">
      <textarea
        bind:this={textareaEl}
        bind:value={inputText}
        on:keydown={handleKeydown}
        on:input={autoResize}
        placeholder="Message {selectedAgent?.name ?? 'agent'}… (Enter to send)"
        class="message-input"
        rows="1"
        disabled={!proxyReady}
      ></textarea>
      {#if messages.length > 0}
        <button
          class="clear-btn"
          on:click={() => { messages = []; localStorage.setItem(`chat-cleared-${selectedAgentId}`, String(Date.now())); }}
          title="Clear chat"
        >🗑️</button>
      {/if}
      {#if isThinking || streamingId}
        <button class="stop-btn" on:click={stopResponse} title="Stop (Esc)">⏹</button>
      {:else}
        <button
          class="send-btn"
          on:click={sendMessage}
          disabled={!proxyReady || !inputText.trim()}
          title="Send (Enter)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <!-- Terminal Mode -->
  <div class="panel-body terminal-body" class:hidden={mode !== 'terminal'}>
    {#if termError}
      <div class="error-bar">⚠️ {termError}</div>
    {/if}
    <div class="terminal-wrap" bind:this={terminalEl}></div>
  </div>
</div>

<style>
  /* ── Backdrop ───────────────────────────────────────────────────────────── */
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 999;
    cursor: pointer;
  }

  /* ── Slide panel ────────────────────────────────────────────────────────── */
  .slide-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 80px;
    width: min(520px, 100vw);
    background: #0f172a;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    z-index: 1000;
    transform: translateX(100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
    border-radius: 0 0 0 8px;
  }

  .slide-panel.open {
    transform: translateX(0);
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    gap: 12px;
  }

  .mode-tabs {
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    padding: 3px;
  }

  .mode-tab {
    padding: 5px 14px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #64748b;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.18s, color 0.18s;
    white-space: nowrap;
  }

  .mode-tab.active {
    background: #1e3a5f;
    color: #93c5fd;
  }

  .mode-tab:hover:not(.active) {
    color: #94a3b8;
    background: rgba(255, 255, 255, 0.05);
  }

  .panel-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .agent-select {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 7px;
    color: #e2e8f0;
    font-size: 0.82rem;
    padding: 4px 8px;
    cursor: pointer;
    outline: none;
    max-width: 130px;
  }

  .agent-select option {
    background: #1e293b;
    color: #e2e8f0;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #64748b;
    flex-shrink: 0;
  }

  .status-dot.green { background: #22c55e; }
  .status-dot.yellow { background: #f59e0b; animation: pulse 1.4s infinite; }
  .status-dot.red { background: #ef4444; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .close-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: rgba(255, 255, 255, 0.06);
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.18s, color 0.18s;
  }

  .close-btn:hover { background: rgba(239, 68, 68, 0.2); color: #f87171; }

  /* ── Body ────────────────────────────────────────────────────────────────── */
  .panel-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .panel-body.hidden { display: none; }

  /* ── Error bar ───────────────────────────────────────────────────────────── */
  .error-bar {
    background: rgba(239, 68, 68, 0.12);
    border-bottom: 1px solid rgba(239, 68, 68, 0.25);
    color: #fca5a5;
    font-size: 0.82rem;
    padding: 6px 16px;
    flex-shrink: 0;
  }

  /* ── Chat messages ───────────────────────────────────────────────────────── */
  .messages-area {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scroll-behavior: smooth;
  }

  .messages-area::-webkit-scrollbar { width: 4px; }
  .messages-area::-webkit-scrollbar-track { background: transparent; }
  .messages-area::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
    padding: 40px 20px;
    color: #64748b;
  }

  .msg-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    animation: fadeIn 0.18s ease;
  }

  .msg-row.user { flex-direction: row-reverse; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    background: rgba(255, 255, 255, 0.07);
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
    line-height: 1;
  }

  .user-av {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
    font-size: 0.55rem;
    font-weight: 700;
  }

  .bubble {
    max-width: 80%;
    border-radius: 12px;
    padding: 9px 12px;
    font-size: 0.875rem;
    line-height: 1.55;
    position: relative;
    word-break: break-word;
  }

  .bubble.user {
    background: #2563eb;
    color: #eff6ff;
    border-bottom-right-radius: 3px;
  }

  .bubble.assistant {
    background: rgba(255, 255, 255, 0.06);
    color: #e2e8f0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom-left-radius: 3px;
  }

  .bubble.thinking {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 10px 14px;
    min-width: 56px;
  }

  .msg-time {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.28);
    margin-top: 4px;
    text-align: right;
  }

  .bubble.user .msg-time { color: rgba(239, 246, 255, 0.4); }

  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #64748b;
    animation: bounce 1.2s infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
    40% { transform: scale(1); opacity: 1; }
  }

  .cursor-blink {
    display: inline-block;
    animation: blink 1s step-end infinite;
    color: #60a5fa;
    margin-left: 1px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  :global(.bubble .code-block) {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 7px;
    padding: 8px 10px;
    margin: 6px 0;
    overflow-x: auto;
    font-family: 'Fira Code', monospace;
    font-size: 0.79rem;
    line-height: 1.5;
  }

  :global(.bubble .code-lang) {
    display: block;
    font-size: 0.68rem;
    color: #64748b;
    margin-bottom: 3px;
    font-family: sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  :global(.bubble .inline-code) {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 1px 4px;
    font-family: 'Fira Code', monospace;
    font-size: 0.84em;
  }

  /* ── Input area ──────────────────────────────────────────────────────────── */
  .input-area {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .message-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 0.875rem;
    line-height: 1.5;
    padding: 8px 12px;
    resize: none;
    outline: none;
    min-height: 38px;
    max-height: 120px;
    overflow-y: auto;
    transition: border-color 0.2s;
    font-family: inherit;
  }

  .message-input::placeholder { color: #475569; }
  .message-input:focus { border-color: #3b82f6; }
  .message-input:disabled { opacity: 0.45; cursor: not-allowed; }

  .clear-btn, .stop-btn, .send-btn {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.2s, transform 0.1s;
    font-size: 14px;
  }

  .clear-btn { background: rgba(255, 255, 255, 0.06); color: #64748b; }
  .clear-btn:hover { background: rgba(255, 255, 255, 0.1); color: #94a3b8; }

  .stop-btn { background: #dc2626; color: #fff; }
  .stop-btn:hover { background: #b91c1c; }
  .stop-btn:active { transform: scale(0.92); }

  .send-btn { background: #2563eb; color: #fff; }
  .send-btn:hover:not(:disabled) { background: #1d4ed8; }
  .send-btn:active:not(:disabled) { transform: scale(0.92); }
  .send-btn:disabled { background: #1e3a5f; opacity: 0.5; cursor: not-allowed; }

  /* ── Terminal ────────────────────────────────────────────────────────────── */
  .terminal-body {
    background: #0f172a;
    padding: 0;
  }

  .terminal-wrap {
    flex: 1;
    width: 100%;
    height: 100%;
    overflow: hidden;
    padding: 8px;
    box-sizing: border-box;
  }

  /* xterm global overrides */
  :global(.xterm) {
    height: 100%;
    width: 100%;
  }

  /* Enable visible scrollbar inside xterm viewport */
  :global(.xterm-viewport) {
    overflow-y: scroll !important;
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.4) transparent;
  }

  :global(.xterm-viewport::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.xterm-viewport::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(.xterm-viewport::-webkit-scrollbar-thumb) {
    background-color: rgba(148, 163, 184, 0.4);
    border-radius: 3px;
  }

  :global(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background-color: rgba(148, 163, 184, 0.7);
  }

  :global(.xterm-viewport) {
    background: #0f172a !important;
  }
</style>
