/**
 * Gateway Operator Client
 * Connects to OpenClaw gateway as an operator with approvals + admin scope
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '7e83848aa3816ca3b0ebfb8e0155e6bd8a36e5ea1ee77a0e';
const PROTOCOL_VERSION = 3;

export interface ApprovalRequest {
  id: string;
  expiresAtMs: number;
  request: {
    command: string;
    cwd?: string;
    host?: string;
    agentId?: string;
    sessionKey?: string;
  };
}

export interface ApprovalResolved {
  id: string;
  decision: 'allow-once' | 'allow-always' | 'deny';
  resolvedBy?: string;
}

type GatewayEventHandler = (event: string, payload: unknown) => void;

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private deviceId = `mission-clawtrol-${randomUUID().slice(0, 8)}`;

  constructor() {
    super();
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      console.log(`[GatewayClient] Connecting to ${GATEWAY_URL}...`);
      
      this.ws = new WebSocket(GATEWAY_URL);

      const connectionTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 10000);

      this.ws.on('open', () => {
        console.log('[GatewayClient] WebSocket connected, waiting for challenge...');
      });

      this.ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // Handle connect challenge
          if (msg.type === 'event' && msg.event === 'connect.challenge') {
            console.log('[GatewayClient] Received challenge, sending connect request...');
            await this.sendConnectRequest(msg.payload);
          }
          
          // Handle connect response
          else if (msg.type === 'res' && msg.id === 'connect-req') {
            clearTimeout(connectionTimeout);
            if (msg.ok) {
              this.connected = true;
              console.log('[GatewayClient] Connected as operator with approvals scope');
              this.startPing();
              resolve();
            } else {
              reject(new Error(msg.error?.message || 'Connect failed'));
            }
          }
          
          // Handle events
          else if (msg.type === 'event') {
            // Log all events for debugging
            console.log('[GatewayClient] Received event:', msg.event, JSON.stringify(msg.payload, null, 2));
            this.handleEvent(msg.event, msg.payload);
          }
          
          // Handle responses to our requests
          else if (msg.type === 'res') {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
              this.pendingRequests.delete(msg.id);
              if (msg.ok) {
                pending.resolve(msg.payload);
              } else {
                pending.reject(new Error(msg.error?.message || 'Request failed'));
              }
            }
          }
        } catch (err) {
          console.error('[GatewayClient] Error parsing message:', err);
        }
      });

      this.ws.on('close', () => {
        console.log('[GatewayClient] Disconnected');
        this.connected = false;
        this.stopPing();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[GatewayClient] WebSocket error:', err.message);
        if (!this.connected) {
          clearTimeout(connectionTimeout);
          reject(err);
        }
      });
    });
  }

  private async sendConnectRequest(challenge: { nonce: string; ts: number }): Promise<void> {
    // Use 'cli' as client ID since it's an allowed constant
    // and 'backend' mode for backend services
    const connectMsg = {
      type: 'req',
      id: 'connect-req',
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'cli', // Must be a known client ID constant
          version: '1.0.0',
          platform: 'linux',
          mode: 'backend', // Must be a known mode constant
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.approvals', 'operator.admin'],
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: GATEWAY_TOKEN },
        locale: 'en-US',
        userAgent: 'mission-clawtrol/1.0.0',
        // Omit device for local connections with allowInsecureAuth
      },
    };

    this.ws?.send(JSON.stringify(connectMsg));
  }

  private handleEvent(event: string, payload: unknown): void {
    // Emit all events for general listeners
    this.emit('gateway-event', event, payload);

    // Emit specific events for typed listeners
    if (event === 'exec.approval.requested') {
      console.log('[GatewayClient] Approval requested:', (payload as ApprovalRequest).id);
      this.emit('approval-requested', payload as ApprovalRequest);
    } else if (event === 'exec.approval.resolved') {
      console.log('[GatewayClient] Approval resolved:', (payload as ApprovalResolved).id);
      this.emit('approval-resolved', payload as ApprovalResolved);
    } else if (event === 'sessions.spawn.started' || event === 'subagent-started' || event === 'session.started') {
      console.log('[GatewayClient] Subagent started:', payload);
      this.emit('subagent-started', payload);
    } else if (event === 'sessions.spawn.completed' || event === 'subagent-completed' || event === 'session.completed') {
      console.log('[GatewayClient] Subagent completed:', payload);
      this.emit('subagent-completed', payload);
    } else if (event === 'agent') {
      // Emit agent events for streaming content (used for subagent detection)
      this.emit('agent', payload);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    console.log('[GatewayClient] Scheduling reconnect in 5s...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error('[GatewayClient] Reconnect failed:', err.message);
      });
    }, 5000);
  }

  private startPing(): void {
    this.stopPing();
    // Send a ping every 30 seconds to keep connection alive
    this.pingTimer = setInterval(() => {
      if (this.ws && this.connected) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  async request(method: string, params: unknown): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected to gateway');
    }

    const id = randomUUID();
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      const msg = {
        type: 'req',
        id,
        method,
        params,
      };

      this.ws!.send(JSON.stringify(msg));

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async resolveApproval(id: string, decision: 'allow-once' | 'allow-always' | 'deny'): Promise<void> {
    console.log(`[GatewayClient] Resolving approval ${id} with decision: ${decision}`);
    await this.request('exec.approval.resolve', { id, decision });
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.connected = false;
  }
}

// Singleton instance
export const gatewayClient = new GatewayClient();
