<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { getGatewayWsUrl, getApiBase } from '$lib/config';

  // ── Types ────────────────────────────────────────────────────────────────

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

  // ── State ────────────────────────────────────────────────────────────────

  let agents: Agent[] = [];
  let selectedAgentId = '';
  let messages: ChatMessage[] = [];
  let inputText = '';
  let isThinking = false;
  let proxyReady = false;
  let wsConnected = false;
  let statusText = 'Connecting...';
  let errorText = '';
  let messagesEl: HTMLElement;
  let textareaEl: HTMLTextAreaElement;

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // In-progress streaming message
  let streamingId: string | null = null;

  // Track inflight request IDs
  const pendingReqs = new Map<string, (payload: any) => void>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function uuid(): string {
    return crypto.randomUUID();
  }

  function now(): number {
    return Date.now();
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Very simple markdown renderer — handles code blocks, inline code, and newlines.
   * Does NOT use a full MD library to keep deps minimal.
   */
  function renderMarkdown(text: string): string {
    // Escape HTML first
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Fenced code blocks ```lang\n...\n```
    escaped = escaped.replace(/```([a-zA-Z]*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      const label = lang ? `<span class="code-lang">${lang}</span>` : '';
      return `<pre class="code-block">${label}<code>${code.trim()}</code></pre>`;
    });

    // Inline code `...`
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold **...**
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic *...*
    escaped = escaped.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Newlines → <br>
    escaped = escaped.replace(/\n/g, '<br>');

    return escaped;
  }

  async function scrollToBottom() {
    await tick();
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // ── Agent loading ─────────────────────────────────────────────────────────

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
      if (agents.length > 0 && !selectedAgentId) {
        selectedAgentId = agents[0].id;
      }
    } catch (err) {
      console.error('[Chat] Failed to load agents:', err);
      // Fallback — single dummy agent so the UI is usable
      agents = [{ id: 'cso', name: 'Chief Strategy Officer', emoji: '🎯', model: '' }];
      selectedAgentId = 'cso';
    }
  }

  // ── WebSocket / Gateway ───────────────────────────────────────────────────

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    statusText = 'Connecting…';
    wsConnected = false;
    proxyReady = false;
    errorText = '';

    const url = getGatewayWsUrl();
    ws = new WebSocket(url);

    ws.onopen = () => {
      wsConnected = true;
      statusText = 'Handshaking with gateway…';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleGatewayMessage(msg);
      } catch {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      wsConnected = false;
      proxyReady = false;
      statusText = 'Disconnected — reconnecting…';
      scheduleReconnect();
    };

    ws.onerror = () => {
      statusText = 'Connection error';
      errorText = 'Could not reach the gateway proxy. Is the backend running?';
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 4000);
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
  }

  function sendWs(data: object) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function handleGatewayMessage(msg: any) {
    // Proxy-level messages (not from the gateway itself)
    if (msg.type === 'proxy-ready') {
      proxyReady = true;
      statusText = 'Connected';
      errorText = '';
      // Load history for the currently selected agent
      if (selectedAgentId) loadHistory(selectedAgentId);
      return;
    }

    if (msg.type === 'error') {
      statusText = 'Error';
      errorText = msg.error || 'Unknown error from gateway';
      return;
    }

    // Gateway response to one of our requests
    if (msg.type === 'res') {
      const cb = pendingReqs.get(msg.id);
      if (cb) {
        pendingReqs.delete(msg.id);
        if (msg.ok) {
          cb(msg.payload);
        } else {
          console.warn('[Chat] Gateway request failed:', msg.error);
          isThinking = false;
          errorText = msg.error?.message || 'Request failed';
        }
      }
      return;
    }

    // Gateway streaming event
    if (msg.type === 'event') {
      handleGatewayEvent(msg.event, msg.payload);
    }
  }

  function handleGatewayEvent(event: string, payload: any) {
    // The gateway sends all chat events under event name "chat"
    // with payload.state = "delta" | "final" | "aborted" | "error"
    if (event === 'chat') {
      const state = payload?.state;
      const messageData = payload?.message;

      // Delta — streaming content
      if (state === 'delta' && messageData) {
        // messageData.content is an array like [{type:"text", text:"..."}]
        const fullText = messageData.content?.find((c: any) => c.type === 'text')?.text ?? '';
        if (!fullText) return;

        if (streamingId) {
          // Replace content with full accumulated text (gateway sends full text each delta)
          messages = messages.map(m =>
            m.id === streamingId
              ? { ...m, content: fullText }
              : m
          );
        } else {
          streamingId = uuid();
          messages = [...messages, {
            id: streamingId,
            role: 'assistant',
            content: fullText,
            timestamp: now(),
            streaming: true,
          }];
        }
        scrollToBottom();
        return;
      }

      // Final — agent finished responding
      if (state === 'final') {
        if (streamingId) {
          messages = messages.map(m =>
            m.id === streamingId ? { ...m, streaming: false } : m
          );
          streamingId = null;
          isThinking = false;
          scrollToBottom();
        } else {
          // No deltas received — fetch the response from history
          fetchLatestResponse();
        }
        return;
      }

      // Aborted or error
      if (state === 'aborted' || state === 'error') {
        if (streamingId) {
          messages = messages.map(m =>
            m.id === streamingId ? { ...m, streaming: false } : m
          );
          streamingId = null;
        }
        isThinking = false;
        if (state === 'error') errorText = 'Agent encountered an error';
        scrollToBottom();
        return;
      }
      return;
    }

    // Legacy event names (fallback)
    if (event === 'chat.chunk' || event === 'chat.delta') {
      const delta = payload?.delta ?? payload?.content ?? payload?.text ?? '';
      if (!delta) return;

      if (streamingId) {
        messages = messages.map(m =>
          m.id === streamingId
            ? { ...m, content: m.content + delta }
            : m
        );
      } else {
        streamingId = uuid();
        messages = [...messages, {
          id: streamingId,
          role: 'assistant',
          content: delta,
          timestamp: now(),
          streaming: true,
        }];
      }
      scrollToBottom();
      return;
    }

    if (event === 'chat.done' || event === 'chat.complete') {
      if (streamingId) {
        messages = messages.map(m =>
          m.id === streamingId ? { ...m, streaming: false } : m
        );
        streamingId = null;
      }
      isThinking = false;
      scrollToBottom();
      return;
    }

    if (event === 'chat.message') {
      const content = payload?.message ?? payload?.content ?? '';
      if (content) {
        messages = [...messages, {
          id: uuid(),
          role: 'assistant',
          content,
          timestamp: now(),
        }];
        isThinking = false;
        scrollToBottom();
      }
    }
  }

  // ── Fetch latest response (fallback when no deltas received) ────────────

  function fetchLatestResponse() {
    if (!proxyReady || !selectedAgentId) {
      isThinking = false;
      return;
    }

    const reqId = uuid();
    sendWs({
      type: 'req',
      id: reqId,
      method: 'chat.history',
      params: { sessionKey: `agent:${selectedAgentId}:main` },
    });

    pendingReqs.set(reqId, (payload: any) => {
      const history: Array<{ role: string; content: any }> =
        payload?.messages ?? payload?.history ?? [];

      // Find the last assistant message
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role === 'assistant') {
          // Content can be a string or array of {type:"text", text:"..."}
          let text = '';
          if (typeof m.content === 'string') {
            text = m.content;
          } else if (Array.isArray(m.content)) {
            text = m.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('');
          }

          if (text) {
            messages = [...messages, {
              id: uuid(),
              role: 'assistant',
              content: text,
              timestamp: now(),
            }];
            scrollToBottom();
          }
          break;
        }
      }

      isThinking = false;
    });
  }

  // ── History loading ───────────────────────────────────────────────────────

  function loadHistory(agentId: string) {
    if (!proxyReady) return;

    const reqId = uuid();
    sendWs({
      type: 'req',
      id: reqId,
      method: 'chat.history',
      params: { sessionKey: `agent:${agentId}:main` },
    });

    pendingReqs.set(reqId, (payload: any) => {
      const history: Array<{ role: string; content: any; timestamp?: number }> =
        payload?.messages ?? payload?.history ?? [];
      messages = history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          // Content can be string or array of {type:"text", text:"..."}
          let text = '';
          if (typeof m.content === 'string') {
            text = m.content;
          } else if (Array.isArray(m.content)) {
            text = m.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('');
          }
          return {
            id: uuid(),
            role: m.role as 'user' | 'assistant',
            content: text,
            timestamp: m.timestamp || now(),
          };
        })
        .filter(m => m.content); // skip empty messages
      scrollToBottom();
    });
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || isThinking) return;
    if (!proxyReady) {
      errorText = 'Not connected to gateway. Please wait…';
      return;
    }

    errorText = '';
    inputText = '';
    resetTextarea();

    // Optimistically add user message
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: text,
      timestamp: now(),
    };
    messages = [...messages, userMsg];
    isThinking = true;
    streamingId = null;
    await scrollToBottom();

    const reqId = uuid();
    const sessionKey = `agent:${selectedAgentId}:main`;

    sendWs({
      type: 'req',
      id: reqId,
      method: 'chat.send',
      params: {
        sessionKey,
        message: text,
        idempotencyKey: uuid(),
      },
    });

    // The response may come as:
    // A) events (chat.chunk / chat.done)
    // B) a single res with payload.message
    pendingReqs.set(reqId, (payload: any) => {
      // If payload contains the full reply (non-streaming gateway)
      const content = payload?.message ?? payload?.reply ?? payload?.content ?? '';
      if (content && !streamingId) {
        messages = [...messages, {
          id: uuid(),
          role: 'assistant',
          content,
          timestamp: now(),
        }];
        isThinking = false;
        scrollToBottom();
      } else if (!content) {
        // Streaming — events will follow; keep isThinking until chat.done
        // isThinking will be cleared in handleGatewayEvent
      }
    });
  }

  // ── Agent switching ───────────────────────────────────────────────────────

  function onAgentChange() {
    messages = [];
    streamingId = null;
    isThinking = false;
    if (proxyReady) loadHistory(selectedAgentId);
  }

  // ── Textarea helpers ──────────────────────────────────────────────────────

  function resetTextarea() {
    if (textareaEl) {
      textareaEl.style.height = 'auto';
    }
  }

  function autoResize() {
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + 'px';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(async () => {
    await loadAgents();
    connect();
  });

  onDestroy(() => {
    disconnect();
  });

  // Reactively reload history when selectedAgentId changes
  $: if (selectedAgentId) {
    onAgentChange();
  }

  // Keep selected agent in sync (runs once agents are loaded)
  $: if (agents.length > 0 && !selectedAgentId) {
    selectedAgentId = agents[0].id;
  }

  $: selectedAgent = agents.find(a => a.id === selectedAgentId);
  $: statusDot = proxyReady ? 'green' : wsConnected ? 'yellow' : 'red';
</script>

<div class="chat-page">
  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <div class="chat-header">
    <div class="header-left">
      <h2 class="page-title">💬 Agent Chat</h2>

      <!-- Agent selector -->
      <div class="agent-selector-wrap">
        <label for="agent-select" class="agent-label">Talk to:</label>
        <select
          id="agent-select"
          bind:value={selectedAgentId}
          class="agent-select"
        >
          {#each agents as agent}
            <option value={agent.id}>{agent.emoji} {agent.name}</option>
          {/each}
          {#if agents.length === 0}
            <option value="">Loading agents…</option>
          {/if}
        </select>
      </div>
    </div>

    <!-- Connection status -->
    <div class="status-pill" class:green={statusDot === 'green'} class:yellow={statusDot === 'yellow'} class:red={statusDot === 'red'}>
      <span class="status-dot"></span>
      <span class="status-text">{statusText}</span>
    </div>
  </div>

  <!-- Error banner -->
  {#if errorText}
    <div class="error-banner">
      ⚠️ {errorText}
    </div>
  {/if}

  <!-- ── Message list ────────────────────────────────────────────────────── -->
  <div class="messages-area" bind:this={messagesEl}>
    {#if messages.length === 0 && !isThinking}
      <div class="empty-state">
        {#if selectedAgent}
          <span class="empty-emoji">{selectedAgent.emoji}</span>
          <p class="empty-title">Chat with {selectedAgent.name}</p>
          <p class="empty-sub">Type a message below to get started.</p>
        {:else}
          <p class="empty-title">Select an agent above to chat.</p>
        {/if}
      </div>
    {/if}

    {#each messages as msg (msg.id)}
      <div class="msg-row" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
        {#if msg.role === 'assistant'}
          <div class="avatar">
            {selectedAgent?.emoji ?? '🤖'}
          </div>
        {/if}

        <div class="bubble" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html renderMarkdown(msg.content)}
          {#if msg.streaming}
            <span class="cursor-blink">▌</span>
          {/if}
          <div class="msg-time">{formatTime(msg.timestamp)}</div>
        </div>

        {#if msg.role === 'user'}
          <div class="avatar user-avatar">You</div>
        {/if}
      </div>
    {/each}

    <!-- Thinking indicator -->
    {#if isThinking && !streamingId}
      <div class="msg-row assistant">
        <div class="avatar">{selectedAgent?.emoji ?? '🤖'}</div>
        <div class="bubble assistant thinking">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Input area ──────────────────────────────────────────────────────── -->
  <div class="input-area">
    <textarea
      bind:this={textareaEl}
      bind:value={inputText}
      on:keydown={handleKeydown}
      on:input={autoResize}
      placeholder="Message {selectedAgent?.name ?? 'agent'}… (Enter to send, Shift+Enter for newline)"
      class="message-input"
      rows="1"
      disabled={!proxyReady}
    ></textarea>

    <button
      class="send-btn"
      on:click={sendMessage}
      disabled={!proxyReady || !inputText.trim() || isThinking}
      title="Send message (Enter)"
    >
      {#if isThinking}
        <span class="spinner"></span>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      {/if}
    </button>
  </div>
</div>

<style>
  /* ── Layout ─────────────────────────────────────────────────────────────── */
  .chat-page {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 140px); /* header + nav */
    max-height: 900px;
    background: var(--chat-bg, #0f172a);
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.08);
    overflow: hidden;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .page-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: #e2e8f0;
    margin: 0;
  }

  .agent-selector-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .agent-label {
    font-size: 0.85rem;
    color: #94a3b8;
    white-space: nowrap;
  }

  .agent-select {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 0.9rem;
    padding: 5px 10px;
    cursor: pointer;
    outline: none;
    transition: border-color 0.2s;
  }

  .agent-select:hover,
  .agent-select:focus {
    border-color: #3b82f6;
  }

  .agent-select option {
    background: #1e293b;
    color: #e2e8f0;
  }

  /* Status pill */
  .status-pill {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.8rem;
    padding: 4px 12px;
    border-radius: 99px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    color: #94a3b8;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: #64748b;
  }

  .status-pill.green .status-dot { background: #22c55e; }
  .status-pill.yellow .status-dot { background: #f59e0b; animation: pulse 1.4s infinite; }
  .status-pill.red .status-dot { background: #ef4444; }
  .status-pill.green .status-text { color: #86efac; }
  .status-pill.yellow .status-text { color: #fde68a; }
  .status-pill.red .status-text { color: #fca5a5; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  /* ── Error banner ───────────────────────────────────────────────────────── */
  .error-banner {
    background: rgba(239,68,68,0.12);
    border-bottom: 1px solid rgba(239,68,68,0.25);
    color: #fca5a5;
    font-size: 0.85rem;
    padding: 8px 20px;
    flex-shrink: 0;
  }

  /* ── Messages ───────────────────────────────────────────────────────────── */
  .messages-area {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    scroll-behavior: smooth;
  }

  .messages-area::-webkit-scrollbar { width: 4px; }
  .messages-area::-webkit-scrollbar-track { background: transparent; }
  .messages-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 4px; }

  /* Empty state */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 60px 20px;
    color: #475569;
    gap: 8px;
  }

  .empty-emoji { font-size: 3rem; }
  .empty-title { font-size: 1rem; font-weight: 500; color: #64748b; }
  .empty-sub { font-size: 0.85rem; color: #475569; }

  /* Message rows */
  .msg-row {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    animation: fadeIn 0.18s ease;
  }

  .msg-row.user {
    flex-direction: row-reverse;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Avatars */
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    background: rgba(255,255,255,0.07);
    flex-shrink: 0;
    border: 1px solid rgba(255,255,255,0.1);
    line-height: 1;
  }

  .user-avatar {
    background: rgba(59,130,246,0.2);
    color: #93c5fd;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  /* Bubbles */
  .bubble {
    max-width: 72%;
    border-radius: 14px;
    padding: 10px 14px;
    font-size: 0.9rem;
    line-height: 1.55;
    position: relative;
    word-break: break-word;
  }

  .bubble.user {
    background: #2563eb;
    color: #eff6ff;
    border-bottom-right-radius: 4px;
  }

  .bubble.assistant {
    background: rgba(255,255,255,0.06);
    color: #e2e8f0;
    border: 1px solid rgba(255,255,255,0.08);
    border-bottom-left-radius: 4px;
  }

  .bubble.thinking {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 12px 16px;
    min-width: 60px;
  }

  .msg-time {
    font-size: 0.68rem;
    color: rgba(255,255,255,0.3);
    margin-top: 4px;
    text-align: right;
  }

  .bubble.user .msg-time {
    color: rgba(239,246,255,0.45);
  }

  /* Thinking dots */
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #64748b;
    animation: bounce 1.2s infinite;
  }

  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
    40%           { transform: scale(1);   opacity: 1; }
  }

  /* Blinking cursor for streaming */
  .cursor-blink {
    display: inline-block;
    animation: blink 1s step-end infinite;
    color: #60a5fa;
    font-weight: 400;
    margin-left: 1px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }

  /* Code blocks */
  :global(.bubble .code-block) {
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 10px 12px;
    margin: 8px 0;
    overflow-x: auto;
    font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
    font-size: 0.82rem;
    line-height: 1.5;
    position: relative;
  }

  :global(.bubble .code-lang) {
    display: block;
    font-size: 0.7rem;
    color: #64748b;
    margin-bottom: 4px;
    font-family: sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  :global(.bubble .inline-code) {
    background: rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: 'Fira Code', monospace;
    font-size: 0.85em;
  }

  /* ── Input area ──────────────────────────────────────────────────────────── */
  .input-area {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 14px 16px;
    background: rgba(255,255,255,0.03);
    border-top: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }

  .message-input {
    flex: 1;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    color: #e2e8f0;
    font-size: 0.9rem;
    line-height: 1.5;
    padding: 10px 14px;
    resize: none;
    outline: none;
    min-height: 42px;
    max-height: 160px;
    overflow-y: auto;
    transition: border-color 0.2s;
    font-family: inherit;
  }

  .message-input::placeholder {
    color: #475569;
  }

  .message-input:focus {
    border-color: #3b82f6;
    background: rgba(255,255,255,0.08);
  }

  .message-input:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .send-btn {
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: #2563eb;
    border: none;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.2s, transform 0.1s;
  }

  .send-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .send-btn:active:not(:disabled) {
    transform: scale(0.93);
  }

  .send-btn:disabled {
    background: #1e3a5f;
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Spinner inside send button */
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: inline-block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
