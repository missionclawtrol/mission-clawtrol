<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchAgents, fetchProjects, fetchActivity, checkHealth, deleteAgent, type Agent, type Project, type ActivityEvent } from '$lib/api';
  import { connectWebSocket, wsConnected, wsMessages } from '$lib/websocket';
  
  let agents: Agent[] = [];
  let projects: Project[] = [];
  let activity: ActivityEvent[] = [];
  let backendConnected = false;
  let loading = true;
  let deletingAgent: Agent | null = null;
  
  async function handleDeleteAgent() {
    if (!deletingAgent) return;
    const result = await deleteAgent(deletingAgent.id);
    if (result.success) {
      agents = agents.filter(a => a.id !== deletingAgent?.id);
    }
    deletingAgent = null;
  }
  
  const statusIcons: Record<string, string> = {
    idle: '🟢',
    working: '🟡',
    error: '🔴',
    waiting: '⏳',
    offline: '⚫',
  };
  
  async function loadData() {
    loading = true;
    
    // Check backend health
    backendConnected = await checkHealth();
    
    if (backendConnected) {
      // Fetch data in parallel
      const [agentsData, projectsData, activityData] = await Promise.all([
        fetchAgents(),
        fetchProjects(),
        fetchActivity(10),
      ]);
      
      agents = agentsData;
      projects = projectsData;
      activity = activityData;
    }
    
    loading = false;
  }
  
  function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  
  function formatRelativeTime(timestamp: string): string {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }
  
  onMount(() => {
    loadData();
    connectWebSocket();
    
    // Refresh data every 30 seconds
    const interval = setInterval(loadData, 30000);
    
    return () => {
      clearInterval(interval);
    };
  });
  
  // React to WebSocket messages
  $: if ($wsMessages.length > 0) {
    const lastMsg = $wsMessages[0];
    if (lastMsg.type === 'agent_status') {
      loadData();
    } else if (lastMsg.type === 'activity' && lastMsg.payload) {
      // Insert new activity event at the top without full reload
      const newEvent = lastMsg.payload as ActivityEvent;
      activity = [newEvent, ...activity.slice(0, 9)]; // Keep max 10 items
    } else if (lastMsg.type === 'approval-requested' || lastMsg.type === 'approval-resolved') {
      // Refresh data on approval events
      loadData();
    }
  }
</script>

<div class="space-y-6">
  <!-- Connection Status Banner -->
  {#if !backendConnected && !loading}
    <div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-3">
      <span class="text-red-400">⚠️</span>
      <div>
        <div class="font-medium text-red-400">Backend not connected</div>
        <div class="text-sm text-red-400/70">Start the backend: cd services/backend && npm run dev</div>
      </div>
    </div>
  {/if}
  
  <!-- Stats Row -->
  <div class="grid grid-cols-4 gap-4">
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold">{loading ? '...' : agents.length}</div>
      <div class="text-sm text-slate-400">Total Agents</div>
    </div>
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold">{loading ? '...' : agents.filter(a => a.status === 'working').length}</div>
      <div class="text-sm text-slate-400">Active</div>
    </div>
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold">{loading ? '...' : projects.length}</div>
      <div class="text-sm text-slate-400">Projects</div>
    </div>
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold text-yellow-400">0</div>
      <div class="text-sm text-slate-400">Pending Approvals</div>
    </div>
  </div>
  
  <!-- Main Grid -->
  <div class="grid grid-cols-2 gap-6">
    <!-- Agents Panel -->
    <div class="bg-slate-800 rounded-lg border border-slate-700">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 class="font-semibold">Agents</h2>
        <div class="flex items-center gap-2">
          {#if $wsConnected}
            <span class="w-2 h-2 bg-green-500 rounded-full"></span>
            <span class="text-xs text-slate-500">Live</span>
          {:else}
            <span class="w-2 h-2 bg-slate-500 rounded-full"></span>
            <span class="text-xs text-slate-500">Polling</span>
          {/if}
        </div>
      </div>
      <div class="p-4 space-y-3">
        {#if loading}
          <div class="text-center py-8 text-slate-500">Loading agents...</div>
        {:else if agents.length === 0}
          <div class="text-center py-8 text-slate-500">No agents found</div>
        {:else}
          {#each agents as agent}
            <div class="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors">
              <div class="flex items-center gap-3">
                <span>{statusIcons[agent.status] || '⚫'}</span>
                <div>
                  <div class="font-medium">{agent.name}</div>
                  <div class="text-xs text-slate-500 font-mono">{agent.id.slice(-8)}</div>
                  {#if agent.model}
                    <div class="text-xs text-blue-400/70 mt-0.5">🧠 {agent.model.split('/').pop()}</div>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-3">
                <div class="text-right">
                  <div class="text-sm capitalize text-slate-300">{agent.status}</div>
                  {#if agent.lastActive}
                    <div class="text-xs text-slate-500">{formatRelativeTime(agent.lastActive)}</div>
                  {/if}
                  {#if agent.tokens}
                    <div class="text-xs text-emerald-400/60">{agent.tokens.toLocaleString()} tokens</div>
                  {/if}
                </div>
                {#if agent.id !== 'agent:main:main'}
                  <button
                    on:click|stopPropagation={() => deletingAgent = agent}
                    class="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    title="Delete agent"
                  >
                    🗑️
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
    
    <!-- Projects Panel -->
    <div class="bg-slate-800 rounded-lg border border-slate-700">
      <div class="px-4 py-3 border-b border-slate-700">
        <h2 class="font-semibold">Projects</h2>
      </div>
      <div class="p-4 space-y-3">
        {#if loading}
          <div class="text-center py-8 text-slate-500">Loading projects...</div>
        {:else if projects.length === 0}
          <div class="text-center py-8 text-slate-500">No projects found</div>
        {:else}
          {#each projects as project}
            <div class="p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span>📁</span>
                  <span class="font-medium">{project.name}</span>
                </div>
                {#if project.updated}
                  <span class="text-xs text-slate-500">{formatRelativeTime(project.updated)}</span>
                {/if}
              </div>
              <div class="text-xs text-slate-500">{project.path}</div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
  
  <!-- Recent Activity -->
  <div class="bg-slate-800 rounded-lg border border-slate-700">
    <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
      <h2 class="font-semibold">Recent Activity</h2>
      <button on:click={loadData} class="text-xs text-slate-500 hover:text-slate-300">Refresh</button>
    </div>
    <div class="p-4 space-y-2">
      {#if loading}
        <div class="text-center py-4 text-slate-500">Loading activity...</div>
      {:else if activity.length === 0}
        <div class="text-center py-4 text-slate-500">No recent activity</div>
      {:else}
        {#each activity as event}
          <div class="flex items-center gap-4 text-sm">
            <span class="text-slate-500 w-16">{formatTime(event.timestamp)}</span>
            {#if event.type === 'message'}
              <span class="text-blue-400">💬</span>
              <span><span class="text-slate-300">{event.from || 'Unknown'}</span> → <span class="text-slate-300">{event.to || 'Unknown'}</span>: {event.message}</span>
            {:else if event.type === 'status'}
              <span class="text-yellow-400">🔄</span>
              <span><span class="text-slate-300">{event.agent}</span>: {event.message}</span>
            {:else if event.type === 'file'}
              <span class="text-green-400">📄</span>
              <span><span class="text-slate-300">{event.agent}</span>: {event.message}</span>
            {:else if event.type === 'spawn'}
              <span class="text-purple-400">🚀</span>
              <span><span class="text-slate-300 font-medium">{event.agent}</span>: {event.message}</span>
            {:else if event.type === 'error'}
              <span class="text-red-400">❌</span>
              <span class="text-red-300">{event.message}</span>
            {:else if event.type === 'approval'}
              <span class="text-orange-400">🔐</span>
              <span>{event.message}</span>
            {:else if event.type === 'project'}
              <span class="text-cyan-400">📁</span>
              <span>{event.message}</span>
            {:else if event.type === 'complete'}
              <span class="text-green-400">✅</span>
              <span><span class="text-slate-300">{event.agent}</span>: {event.message}</span>
            {:else}
              <span class="text-slate-400">•</span>
              <span>{event.message || 'Unknown event'}</span>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<!-- Delete Confirmation Modal -->
{#if deletingAgent}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" on:click={() => deletingAgent = null}>
    <div class="bg-slate-800 rounded-lg p-6 max-w-md border border-slate-700" on:click|stopPropagation>
      <h3 class="text-lg font-semibold mb-4">Delete Agent?</h3>
      <p class="text-slate-400 mb-4">
        Are you sure you want to delete <span class="text-white font-medium">{deletingAgent.name}</span>?
        This will remove the session and cannot be undone.
      </p>
      <div class="flex gap-3 justify-end">
        <button
          on:click={() => deletingAgent = null}
          class="px-4 py-2 text-slate-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          on:click={handleDeleteAgent}
          class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
{/if}
