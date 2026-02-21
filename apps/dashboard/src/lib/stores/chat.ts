// Chat state store — manages WebSocket connection to MC backend chat relay
import { writable, derived, get } from 'svelte/store';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agentId: string;
  streaming?: boolean;
}

export interface ChatContext {
  route?: string;
  projectId?: string;
  taskId?: string;
  taskTitle?: string;
}

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  model: string;
}

// Core stores
export const chatOpen = writable(false);
export const messages = writable<ChatMessage[]>([]);
export const isStreaming = writable(false);
export const isConnected = writable(false);
export const selectedAgentId = writable('cso');
export const agents = writable<Agent[]>([{ id: 'cso', name: 'Chief Strategy Officer', emoji: '🎯', model: '' }]);
export const unreadCount = writable(0);
export const currentContext = writable<ChatContext>({});

// Derived: show unread badge when panel is closed and there are unread messages
export const showUnreadBadge = derived(
  [chatOpen, unreadCount],
  ([$chatOpen, $unreadCount]) => !$chatOpen && $unreadCount > 0
);

// WebSocket connection
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let streamingMessageId: string | null = null;
let streamingTimeout: ReturnType<typeof setTimeout> | null = null;

const STREAMING_TIMEOUT_MS = 120_000; // 2 minutes max

function clearStreamingTimeout() {
  if (streamingTimeout) {
    clearTimeout(streamingTimeout);
    streamingTimeout = null;
  }
}

function startStreamingTimeout() {
  clearStreamingTimeout();
  streamingTimeout = setTimeout(() => {
    // Auto-reset if streaming hangs
    isStreaming.set(false);
    if (streamingMessageId) {
      messages.update((msgs) =>
        msgs.map((m) =>
          m.id === streamingMessageId
            ? { ...m, content: m.content || '⚠️ Response timed out. The agent may still be processing — try again.', streaming: false }
            : m
        )
      );
      streamingMessageId = null;
    }
  }, STREAMING_TIMEOUT_MS);
}

const WS_URL = typeof window !== 'undefined'
  ? `ws://${window.location.hostname}:3001/api/chat/ws`
  : 'ws://localhost:3001/api/chat/ws';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function connectChatWS(): void {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  console.log('[Chat] Connecting to chat WebSocket...');

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[Chat] WebSocket connected');
      isConnected.set(true);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onclose = () => {
      console.log('[Chat] WebSocket disconnected');
      isConnected.set(false);
      ws = null;
      // Reconnect after 5 seconds
      reconnectTimer = setTimeout(() => {
        connectChatWS();
      }, 5000);
    };

    ws.onerror = (err) => {
      console.error('[Chat] WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWSMessage(data);
      } catch (err) {
        console.error('[Chat] Failed to parse WS message:', err);
      }
    };
  } catch (err) {
    console.error('[Chat] Failed to connect:', err);
  }
}

export function disconnectChatWS(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null; // Prevent reconnect loop
    ws.close();
    ws = null;
  }
  isConnected.set(false);
}

function handleWSMessage(data: any): void {
  switch (data.type) {
    case 'connected': {
      // Server sent initial history
      if (data.history && Array.isArray(data.history)) {
        const agentId = data.agentId || 'cso';
        const histMsgs: ChatMessage[] = data.history
          .filter((m: any) => m.content?.trim())
          .map((m: any) => ({
            id: generateId(),
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || Date.now(),
            agentId,
          }));
        messages.set(histMsgs);
      }
      break;
    }

    case 'agent-switched': {
      selectedAgentId.set(data.agentId);
      if (data.history && Array.isArray(data.history)) {
        const histMsgs: ChatMessage[] = data.history
          .filter((m: any) => m.content?.trim())
          .map((m: any) => ({
            id: generateId(),
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || Date.now(),
            agentId: data.agentId,
          }));
        messages.set(histMsgs);
      }
      break;
    }

    case 'user-message': {
      // Echo confirmed — message is already shown optimistically, skip
      break;
    }

    case 'stream-start': {
      isStreaming.set(true);
      startStreamingTimeout();
      streamingMessageId = generateId();
      // Add placeholder streaming message
      messages.update((msgs) => [
        ...msgs,
        {
          id: streamingMessageId!,
          role: 'assistant',
          content: '',
          timestamp: data.timestamp || Date.now(),
          agentId: data.agentId || get(selectedAgentId),
          streaming: true,
        },
      ]);
      break;
    }

    case 'stream-chunk': {
      if (streamingMessageId) {
        messages.update((msgs) =>
          msgs.map((m) =>
            m.id === streamingMessageId
              ? { ...m, content: m.content + (data.content || '') }
              : m
          )
        );
      }
      break;
    }

    case 'stream-end': {
      isStreaming.set(false);
      clearStreamingTimeout();
      if (streamingMessageId) {
        messages.update((msgs) =>
          msgs.map((m) =>
            m.id === streamingMessageId
              ? { ...m, content: data.fullContent || m.content, streaming: false }
              : m
          )
        );
        streamingMessageId = null;
      }
      // Increment unread if panel is closed
      if (!get(chatOpen)) {
        unreadCount.update((n) => n + 1);
      }
      break;
    }

    case 'history': {
      if (data.messages && Array.isArray(data.messages)) {
        const histMsgs: ChatMessage[] = data.messages
          .filter((m: any) => m.content?.trim())
          .map((m: any) => ({
            id: generateId(),
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || Date.now(),
            agentId: data.agentId || get(selectedAgentId),
          }));
        messages.set(histMsgs);
      }
      break;
    }

    case 'history-cleared': {
      messages.set([]);
      break;
    }

    case 'error': {
      isStreaming.set(false);
      clearStreamingTimeout();
      streamingMessageId = null;
      // Add error message to chat
      messages.update((msgs) => [
        ...msgs,
        {
          id: generateId(),
          role: 'assistant',
          content: `⚠️ Error: ${data.error}`,
          timestamp: Date.now(),
          agentId: get(selectedAgentId),
        },
      ]);
      break;
    }
  }
}

function sendWS(data: object): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

export function sendMessage(content: string, context?: ChatContext): void {
  const trimmed = content.trim();
  if (!trimmed || get(isStreaming)) return;

  const agentId = get(selectedAgentId);

  // Optimistic UI: add user message immediately
  messages.update((msgs) => [
    ...msgs,
    {
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      agentId,
    },
  ]);

  sendWS({
    type: 'message',
    content: trimmed,
    agentId,
    context: context || get(currentContext),
  });
}

export function switchAgent(agentId: string): void {
  selectedAgentId.set(agentId);
  sendWS({ type: 'switch-agent', agentId });
}

export function clearHistory(): void {
  const agentId = get(selectedAgentId);
  messages.set([]);
  sendWS({ type: 'clear-history', agentId });
}

export function openChat(): void {
  chatOpen.set(true);
  unreadCount.set(0);
  // Connect WebSocket on first open
  connectChatWS();
  loadAgents();
}

export function closeChat(): void {
  chatOpen.set(false);
}

export function toggleChat(): void {
  chatOpen.update((open) => {
    if (!open) {
      unreadCount.set(0);
      connectChatWS();
      loadAgents();
    }
    return !open;
  });
}

export function setContext(ctx: ChatContext): void {
  currentContext.set(ctx);
}

export async function loadAgents(): Promise<void> {
  try {
    const res = await fetch(`http://${window.location.hostname}:3001/api/chat/agents`);
    if (res.ok) {
      const data = await res.json();
      if (data.agents?.length) {
        agents.set(data.agents);
      }
    }
  } catch (err) {
    console.error('[Chat] Failed to load agents:', err);
  }
}
