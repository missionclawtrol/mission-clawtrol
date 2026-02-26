// WebSocket client for real-time updates
import { writable, type Writable } from 'svelte/store';
import { getWsUrl } from '$lib/config';

const WS_URL = getWsUrl();

export interface WSMessage {
  type: string;
  [key: string]: any;
}

export const wsConnected: Writable<boolean> = writable(false);
export const wsMessages: Writable<WSMessage[]> = writable([]);

// Direct message callback registry (bypasses Svelte reactivity batching)
type MessageCallback = (message: WSMessage) => void;
const messageCallbacks: MessageCallback[] = [];

export function addWSMessageCallback(callback: MessageCallback): () => void {
  messageCallbacks.push(callback);
  return () => {
    const idx = messageCallbacks.indexOf(callback);
    if (idx >= 0) messageCallbacks.splice(idx, 1);
  };
}

let socket: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  
  try {
    socket = new WebSocket(WS_URL);
    
    socket.onopen = (event) => {
      console.log('WebSocket connected');
      wsConnected.set(true);
      
      // Use event.target to avoid race condition where module-level `socket`
      // may have been reassigned to a new CONNECTING socket before this fires
      const ws = event.target as WebSocket;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'subscribe',
          channels: ['activity', 'agents', 'approvals', 'tasks']
        }));
      }
    };
    
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        // Only log non-activity messages (activity floods the console)
        if (message.type !== 'task-activity') {
          console.log('WS message:', message);
        }
        
        wsMessages.update(msgs => {
          const updated = [message, ...msgs];
          return updated.slice(0, 100); // Keep last 100 messages
        });

        // Dispatch to direct callbacks (guaranteed per-message, no batching)
        for (const cb of [...messageCallbacks]) {
          try { cb(message); } catch (e) { console.error('WS callback error:', e); }
        }
      } catch (error) {
        console.error('Failed to parse WS message:', error);
      }
    };
    
    socket.onclose = () => {
      console.log('WebSocket disconnected');
      wsConnected.set(false);
      
      // Reconnect after 3 seconds
      reconnectTimeout = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    };
    
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    wsConnected.set(false);
  }
}

export function disconnectWebSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  if (socket) {
    socket.close();
    socket = null;
  }
  
  wsConnected.set(false);
}

export function sendWSMessage(message: WSMessage) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
