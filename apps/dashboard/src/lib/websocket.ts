// WebSocket client for real-time updates
import { writable, type Writable } from 'svelte/store';

const WS_URL = typeof window !== 'undefined'
  ? `ws://${window.location.hostname}:3001/ws`
  : 'ws://localhost:3001/ws';

export interface WSMessage {
  type: string;
  [key: string]: any;
}

export const wsConnected: Writable<boolean> = writable(false);
export const wsMessages: Writable<WSMessage[]> = writable([]);

let socket: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket() {
  if (socket?.readyState === WebSocket.OPEN) return;
  
  try {
    socket = new WebSocket(WS_URL);
    
    socket.onopen = () => {
      console.log('WebSocket connected');
      wsConnected.set(true);
      
      // Subscribe to all channels
      socket?.send(JSON.stringify({
        type: 'subscribe',
        channels: ['activity', 'agents', 'approvals', 'tasks']
      }));
    };
    
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('WS message:', message);
        
        wsMessages.update(msgs => {
          const updated = [message, ...msgs];
          return updated.slice(0, 100); // Keep last 100 messages
        });
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
