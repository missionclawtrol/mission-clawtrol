<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  const API_BASE = typeof window !== 'undefined'
    ? `http://${window.location.hostname}:3001`
    : 'http://localhost:3001';
  const WS_URL = typeof window !== 'undefined'
    ? `ws://${window.location.hostname}:3001/ws`
    : 'ws://localhost:3001/ws';

  interface Approval {
    id: string;
    command: string;
    cwd?: string;
    host?: string;
    agentId?: string;
    expiresAtMs: number;
    expiresInSec: number;
  }

  interface ResolvedApproval {
    id: string;
    command: string;
    decision: string;
    resolvedAt: number;
  }

  let approvals: Approval[] = [];
  let resolved: ResolvedApproval[] = [];
  let gatewayConnected = false;
  let loading = true;
  let error: string | null = null;
  let ws: WebSocket | null = null;
  let countdownInterval: ReturnType<typeof setInterval>;

  onMount(async () => {
    await fetchApprovals();
    connectWebSocket();
    
    // Update countdown every second
    countdownInterval = setInterval(() => {
      approvals = approvals.map(a => ({
        ...a,
        expiresInSec: Math.max(0, Math.round((a.expiresAtMs - Date.now()) / 1000))
      })).filter(a => a.expiresInSec > 0);
    }, 1000);
  });

  onDestroy(() => {
    ws?.close();
    clearInterval(countdownInterval);
  });

  async function fetchApprovals() {
    try {
      const res = await fetch(`${API_BASE}/api/approvals`);
      const data = await res.json();
      approvals = data.pending || [];
      resolved = data.resolved || [];
      gatewayConnected = data.gatewayConnected;
      loading = false;
    } catch (err) {
      error = `Failed to fetch approvals: ${(err as Error).message}`;
      loading = false;
    }
  }

  function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
      ws?.send(JSON.stringify({ type: 'subscribe', channels: ['approvals'] }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'connected') {
          gatewayConnected = msg.gatewayConnected;
        }
        
        if (msg.type === 'approval-requested') {
          const newApproval: Approval = {
            id: msg.payload.id,
            command: msg.payload.command,
            cwd: msg.payload.cwd,
            host: msg.payload.host,
            agentId: msg.payload.agentId,
            expiresAtMs: msg.payload.expiresAtMs,
            expiresInSec: Math.max(0, Math.round((msg.payload.expiresAtMs - Date.now()) / 1000)),
          };
          approvals = [newApproval, ...approvals];
        }
        
        if (msg.type === 'approval-resolved') {
          // Move from pending to resolved
          const approval = approvals.find(a => a.id === msg.payload.id);
          if (approval) {
            resolved = [{
              id: approval.id,
              command: approval.command,
              decision: msg.payload.decision,
              resolvedAt: Date.now(),
            }, ...resolved].slice(0, 10); // Keep last 10
          }
          approvals = approvals.filter(a => a.id !== msg.payload.id);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting in 3s...');
      setTimeout(connectWebSocket, 3000);
    };
  }

  async function resolveApproval(id: string, decision: 'allow-once' | 'allow-always' | 'deny') {
    try {
      const res = await fetch(`${API_BASE}/api/approvals/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to resolve approval');
      }
      
      // Optimistically update UI (WebSocket will confirm)
      const approval = approvals.find(a => a.id === id);
      if (approval) {
        resolved = [{
          id: approval.id,
          command: approval.command,
          decision,
          resolvedAt: Date.now(),
        }, ...resolved].slice(0, 10);
      }
      approvals = approvals.filter(a => a.id !== id);
    } catch (err) {
      error = `Failed to resolve approval: ${(err as Error).message}`;
    }
  }

  function formatDecision(decision: string): string {
    switch (decision) {
      case 'allow-once': return '✅ Allowed (once)';
      case 'allow-always': return '✅ Allowed (always)';
      case 'deny': return '❌ Denied';
      default: return decision;
    }
  }

  function formatCommand(cmd: string): string {
    return cmd.length > 200 ? cmd.slice(0, 200) + '...' : cmd;
  }

  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">Exec Approvals</h2>
    <div class="flex items-center gap-4">
      <span class="flex items-center gap-2 text-sm {gatewayConnected ? 'text-green-400' : 'text-red-400'}">
        <span class="w-2 h-2 rounded-full {gatewayConnected ? 'bg-green-400' : 'bg-red-400'}"></span>
        Gateway {gatewayConnected ? 'Connected' : 'Disconnected'}
      </span>
      <span class="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-sm">
        {approvals.length} pending
      </span>
    </div>
  </div>

  {#if error}
    <div class="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-400">
      {error}
      <button on:click={() => error = null} class="ml-2 underline">Dismiss</button>
    </div>
  {/if}

  {#if loading}
    <div class="bg-slate-800 rounded-lg border border-slate-700 p-12 text-center">
      <div class="text-lg">Loading...</div>
    </div>
  {:else if approvals.length === 0}
    <div class="bg-slate-800 rounded-lg border border-slate-700 p-12 text-center">
      <div class="text-4xl mb-4">✅</div>
      <div class="text-lg font-medium">All caught up!</div>
      <div class="text-slate-400">No pending approvals</div>
    </div>
  {:else}
    <!-- Pending Approvals -->
    <div class="space-y-4">
      {#each approvals as approval (approval.id)}
        <div class="bg-slate-800 rounded-lg border-l-4 border-yellow-500 bg-yellow-500/5 p-4">
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-2">
              <span>⏳</span>
              <span class="font-medium text-sm text-yellow-400">PENDING</span>
              <span class="text-xs text-slate-500">• Expires in {approval.expiresInSec}s</span>
            </div>
            <span class="text-xs font-mono text-slate-500">{approval.id.slice(0, 8)}</span>
          </div>
          
          <div class="mb-3">
            {#if approval.agentId}
              <div class="text-sm text-slate-400 mb-1">Agent: <span class="text-slate-200">{approval.agentId}</span></div>
            {/if}
            {#if approval.host}
              <div class="text-sm text-slate-400 mb-1">Host: <span class="text-slate-200">{approval.host}</span></div>
            {/if}
            {#if approval.cwd}
              <div class="text-sm text-slate-400 mb-1">CWD: <span class="text-slate-200 font-mono text-xs">{approval.cwd}</span></div>
            {/if}
            <div class="mt-2 p-3 bg-slate-900 rounded font-mono text-sm text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
              {formatCommand(approval.command)}
            </div>
          </div>
          
          <div class="flex gap-2 flex-wrap">
            <button 
              on:click={() => resolveApproval(approval.id, 'allow-once')}
              class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
            >
              Allow Once
            </button>
            <button 
              on:click={() => resolveApproval(approval.id, 'allow-always')}
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
            >
              Always Allow
            </button>
            <button 
              on:click={() => resolveApproval(approval.id, 'deny')}
              class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Recent Resolutions -->
  {#if resolved.length > 0}
    <div class="mt-8">
      <h3 class="text-sm font-medium text-slate-400 mb-3">Recent Resolutions</h3>
      <div class="space-y-2">
        {#each resolved as item (item.id)}
          <div class="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-sm">{formatDecision(item.decision)}</span>
                <span class="font-mono text-xs text-slate-500">{item.id.slice(0, 8)}</span>
              </div>
              <span class="text-xs text-slate-500">{formatTimeAgo(item.resolvedAt)}</span>
            </div>
            <div class="mt-1 text-xs font-mono text-slate-500 truncate">{formatCommand(item.command)}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
