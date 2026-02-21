/**
 * config.ts — Single source of truth for backend connection URLs.
 *
 * Dev  (Vite dev server on 5173/5174): connects directly to localhost:3001
 * Prod (served via nginx on port 80/443): uses same-origin /api and /ws paths
 */

function isDev(): boolean {
  if (typeof window === 'undefined') return true;
  const port = window.location.port;
  return port === '5173' || port === '5174';
}

/** Base URL for REST API calls (no trailing slash). */
export function getApiBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001/api';
  if (isDev()) return `http://${window.location.hostname}:3001/api`;
  return '/api';
}

/** Base URL for the backend origin (no path). Empty string in prod = same-origin. */
export function getBackendBase(): string {
  if (typeof window === 'undefined') return 'http://localhost:3001';
  if (isDev()) return `http://${window.location.hostname}:3001`;
  return '';
}

/** WebSocket URL for the /ws endpoint. */
export function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3001/ws';
  if (isDev()) return `ws://${window.location.hostname}:3001/ws`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
