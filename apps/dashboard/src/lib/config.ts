/**
 * config.ts — Single source of truth for backend connection URLs.
 *
 * Dev  (Vite dev server on 5173/5174): uses same-origin paths via Vite proxy.
 *      Vite proxies /api → http://localhost:3001/api and /ws → ws://localhost:3001/ws.
 *      This avoids mixed-content issues when the dev server runs HTTPS (for mic access).
 * Prod (served via nginx on port 80/443): uses same-origin /api and /ws paths
 */

/** Base URL for REST API calls (no trailing slash). */
export function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001/api';
  return '/api';
}

/** Base URL for the backend origin (no path). Empty string = same-origin. */
export function getBackendBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  return '';
}

function wsUrl(path: string): string {
  if (typeof window === 'undefined') return `ws://localhost:3001${path}`;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

/** WebSocket URL for the /ws endpoint. */
export function getWsUrl(): string { return wsUrl('/ws'); }

/** WebSocket URL for the gateway proxy endpoint (/ws/gateway). */
export function getGatewayWsUrl(): string { return wsUrl('/ws/gateway'); }

/** WebSocket URL for the PTY terminal endpoint (/ws/pty). */
export function getPtyWsUrl(): string { return wsUrl('/ws/pty'); }

/** WebSocket URL for the voice interface endpoint (/ws/voice). */
export function getVoiceWsUrl(): string { return wsUrl('/ws/voice'); }
