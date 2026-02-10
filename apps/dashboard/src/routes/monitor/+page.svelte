<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fetchAgents, fetchProjects, fetchActivity, type Agent, type Project, type ActivityEvent } from '$lib/api';

  const API_BASE = 'http://localhost:3001';
  const WS_URL = 'ws://localhost:3001/ws';

  let agents: Agent[] = [];
  let projects: Project[] = [];
  let activity: ActivityEvent[] = [];
  let loading = true;
  let ws: WebSocket | null = null;
  let gatewayConnected = false;

  // Group agents by their type/project
  $: agentGroups = groupAgents(agents);

  function groupAgents(agents: Agent[]) {
    const groups: Record<string, Agent[]> = {
      'Main': [],
      'Sub-agents': [],
      'Other': [],
    };

    for (const agent of agents) {
      if (agent.id === 'agent:main:main') {
        groups['Main'].push(agent);
      } else if (agent.id.includes(':subagent:')) {
        groups['Sub-agents'].push(agent);
      } else {
        groups['Other'].push(agent);
      }
    }

    // Remove empty groups
    return Object.entries(groups).filter(([_, agents]) => agents.length > 0);
  }

  const statusIcons: Record<string, string> = {
    idle: '🟢',
    working: '🔵',
    error: '🔴',
    offline: '⚫',
  };

  function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false });
  }

  function formatRelativeTime(timestamp: string): string {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }

  function getAgentDisplayName(agent: Agent): string {
    if (agent.id === 'agent:main:main') return 'Jarvis (Main)';
    if (agent.id.includes(':subagent:')) {
      const uuid = agent.id.split(':').pop() || '';
      return `Sub-agent ${uuid.slice(0, 8)}`;
    }
    return agent.name || agent.id;
  }

  async function loadData() {
    loading = true;
    const [agentsData, projectsData, activityData] = await Promise.all([
      fetchAgents(),
      fetchProjects(),
      fetchActivity(20),
    ]);
    agents = agentsData;
    projects = projectsData;
    activity = activityData;
    loading = false;
  }

  function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('Monitor WebSocket connected');
      ws?.send(JSON.stringify({ type: 'subscribe', channels: ['agents', 'activity'] }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'connected' || msg.type === 'subscribed') {
          gatewayConnected = msg.gatewayConnected ?? true;
        }

        if (msg.type === 'activity') {
          // Add new activity to the top
          activity = [msg.payload, ...activity].slice(0, 50);
        }

        if (msg.type === 'agent-update') {
          // Refresh agents list
          loadData();
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('Monitor WebSocket disconnected, reconnecting in 3s...');
      setTimeout(connectWebSocket, 3000);
    };
  }

  onMount(() => {
    loadData();
    connectWebSocket();

    // Refresh data every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  });

  onDestroy(() => {
    ws?.close();
  });
</script>

<div class="h-[calc(100vh-180px)] flex flex-col gap-4">
  <!-- Top Section: Agent List + Projects -->
  <div class="flex-1 grid grid-cols-2 gap-4 min-h-0">
    <!-- Active Agents -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 flex flex-col min-h-0">
      <div class="px-4 py-3 border-b border-slate-700 flex-shrink-0 flex items-center justify-between">
        <h2 class="font-semibold">Active Agents</h2>
        <div class="flex items-center gap-2">
          <span class="text-xs {gatewayConnected ? 'text-green-400' : 'text-red-400'}">
            {gatewayConnected ? '● Connected' : '○ Disconnected'}
          </span>
          <button on:click={loadData} class="text-xs text-slate-500 hover:text-slate-300">↻</button>
        </div>
      </div>
      <div class="p-4 overflow-y-auto flex-1">
        {#if loading}
          <div class="text-center py-8 text-slate-500">Loading agents...</div>
        {:else if agents.length === 0}
          <div class="text-center py-8 text-slate-500">No active agents</div>
        {:else}
          {#each agentGroups as [groupName, groupAgents]}
            <div class="mb-4">
              <div class="flex items-center gap-2 text-slate-400 mb-2">
                <span>{groupName === 'Main' ? '🤖' : groupName === 'Sub-agents' ? '🔹' : '📦'}</span>
                <span class="font-medium text-sm">{groupName}</span>
                <span class="text-xs text-slate-500">({groupAgents.length})</span>
              </div>
              <div class="ml-4 space-y-2">
                {#each groupAgents as agent}
                  <div class="flex items-center justify-between p-2 bg-slate-700/50 rounded hover:bg-slate-700 transition-colors">
                    <div class="flex items-center gap-2">
                      <span>{statusIcons[agent.status] || '⚪'}</span>
                      <span class="text-sm">{getAgentDisplayName(agent)}</span>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-slate-500">
                      {#if agent.model}
                        <span class="truncate max-w-[100px]" title={agent.model}>
                          {agent.model.split('/').pop()}
                        </span>
                      {/if}
                      {#if agent.lastActive}
                        <span>{formatRelativeTime(agent.lastActive)}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
    
    <!-- Projects Overview -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 flex flex-col min-h-0">
      <div class="px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <h2 class="font-semibold">Projects</h2>
      </div>
      <div class="p-4 overflow-y-auto flex-1">
        {#if loading}
          <div class="text-center py-8 text-slate-500">Loading projects...</div>
        {:else if projects.length === 0}
          <div class="text-center py-8 text-slate-500">No projects found</div>
        {:else}
          <div class="space-y-2">
            {#each projects as project}
              <div class="flex items-center justify-between p-3 bg-slate-700/50 rounded hover:bg-slate-700 transition-colors">
                <div class="flex items-center gap-2">
                  <span>📁</span>
                  <div>
                    <span class="font-medium">{project.name}</span>
                    <div class="text-xs text-slate-500">{project.path}</div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  {#if project.hasStatusMd}
                    <span class="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded" title="STATUS.md">S</span>
                  {/if}
                  {#if project.hasProjectMd}
                    <span class="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded" title="PROJECT.md">P</span>
                  {/if}
                  {#if project.hasHandoffMd}
                    <span class="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded" title="HANDOFF.md">H</span>
                  {/if}
                  {#if project.updated}
                    <span class="text-xs text-slate-500 ml-2">{formatRelativeTime(project.updated)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
  
  <!-- Bottom Section: Activity Log -->
  <div class="h-48 bg-slate-800 rounded-lg border border-slate-700 flex flex-col">
    <div class="px-4 py-2 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
      <h2 class="font-semibold text-sm">Activity Log</h2>
      <span class="text-xs text-slate-500">{activity.length} events</span>
    </div>
    <div class="p-3 overflow-y-auto flex-1 font-mono text-xs">
      {#if activity.length === 0}
        <div class="text-center py-4 text-slate-500">No recent activity</div>
      {:else}
        {#each activity as event}
          <div class="flex gap-3 py-1 hover:bg-slate-700/50">
            <span class="text-slate-500 flex-shrink-0">{formatTime(event.timestamp)}</span>
            <span class="text-slate-400 flex-shrink-0">[{event.type}]</span>
            <span class="text-slate-300">
              {#if event.agent}
                <span class="text-blue-400">{event.agent}</span>:
              {/if}
              {event.message || '—'}
            </span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
