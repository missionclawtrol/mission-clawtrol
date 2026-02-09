<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchAgents, fetchProjects, fetchActivity, checkHealth, type Agent, type Project, type ActivityEvent } from '$lib/api';
  import { connectWebSocket, wsConnected, wsMessages } from '$lib/websocket';
  
  let agents: Agent[] = [];
  let projects: Project[] = [];
  let activity: ActivityEvent[] = [];
  let backendConnected = false;
  let loading = true;
  
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
    if (lastMsg.type === 'agent_status' || lastMsg.type === 'activity') {
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
            <div class="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
              <div class="flex items-center gap-3">
                <span>{statusIcons[agent.status] || '⚫'}</span>
                <div>
                  <div class="font-medium">{agent.name}</div>
                  <div class="text-sm text-slate-400">{agent.role || 'Agent'}</div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm capitalize text-slate-300">{agent.status}</div>
                {#if agent.lastActive}
                  <div class="text-xs text-slate-500">{formatRelativeTime(agent.lastActive)}</div>
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
