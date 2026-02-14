<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchAgents, fetchTasks, checkHealth, type Agent, type Task } from '$lib/api';
  import { connectWebSocket, wsConnected, wsMessages } from '$lib/websocket';
  
  let agents: Agent[] = [];
  let tasks: Task[] = [];
  let backendConnected = false;
  let loading = true;
  
  // Filtered task lists
  let needsAttention: Task[] = [];
  let recentCompleted: Task[] = [];
  
  // Quick stats
  let tasksToday = 0;
  let completedThisWeek = 0;
  let activeAgents = 0;
  
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
  
  function formatTokens(total: number): string {
    if (total >= 1_000_000) {
      return `${(total / 1_000_000).toFixed(1)}M`;
    } else if (total >= 1_000) {
      return `${(total / 1_000).toFixed(0)}K`;
    }
    return total.toString();
  }
  
  function getStatusColor(status: string): string {
    switch (status) {
      case 'online':
      case 'working':
        return 'bg-green-500';
      case 'idle':
        return 'bg-yellow-500';
      case 'offline':
      default:
        return 'bg-gray-500';
    }
  }
  
  function getStatusDisplay(status: string): string {
    switch (status) {
      case 'online':
      case 'working':
        return 'Online';
      case 'idle':
        return 'Idle';
      case 'offline':
      default:
        return 'Offline';
    }
  }
  
  function filterNeedsAttention(allTasks: Task[]): Task[] {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    return allTasks.filter(task => {
      // Status = 'review' AND updatedAt > 2 hours ago
      if (task.status === 'review' && task.updatedAt) {
        const updatedAt = new Date(task.updatedAt);
        if (updatedAt > twoHoursAgo) return true;
      }
      
      // Status = 'todo' or 'in-progress' AND agentId is null
      if ((task.status === 'todo' || task.status === 'in-progress') && !task.agentId) {
        return true;
      }
      
      // Priority = 'P0' or 'P1' AND status not 'done'
      if ((task.priority === 'P0' || task.priority === 'P1') && task.status !== 'done') {
        return true;
      }
      
      return false;
    });
  }
  
  function calculateStats(allTasks: Task[], allAgents: Agent[]) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Tasks today
    tasksToday = allTasks.filter(t => {
      if (!t.createdAt) return false;
      const created = new Date(t.createdAt);
      return created >= today;
    }).length;
    
    // Completed this week
    completedThisWeek = allTasks.filter(t => {
      if (t.status !== 'done' || !t.updatedAt) return false;
      const updated = new Date(t.updatedAt);
      return updated >= weekAgo;
    }).length;
    
    // Active agents
    activeAgents = allAgents.filter(a => a.status === 'working' || a.status === 'online').length;
  }
  
  async function loadData() {
    loading = true;
    
    // Check backend health
    backendConnected = await checkHealth();
    
    if (backendConnected) {
      try {
        // Fetch data in parallel
        const [agentsData, tasksData] = await Promise.all([
          fetchAgents(),
          fetchTasks(),
        ]);
        
        agents = agentsData;
        tasks = tasksData;
        
        // Agent display info mapping
        const agentInfo: Record<string, { name: string; emoji: string }> = {
          'senior-dev': { name: 'Senior Dev', emoji: '👨‍💻' },
          'junior-dev': { name: 'Junior Dev', emoji: '👩‍💻' },
          'senior-researcher': { name: 'Sr Researcher', emoji: '🔬' },
          'junior-researcher': { name: 'Jr Researcher', emoji: '📚' },
          'editor': { name: 'Editor', emoji: '✍️' },
          'sysadmin': { name: 'SysAdmin', emoji: '🖥️' },
          'security': { name: 'Security', emoji: '🔒' },
          'cso': { name: 'CSO', emoji: '🎯' },
        };
        
        // Enrich tasks with agent info
        tasks = tasks.map(t => {
          const agent = agentInfo[t.agentId] || { name: t.agentId || 'Unassigned', emoji: '🤖' };
          return {
            ...t,
            agentName: agent.name,
            agentEmoji: agent.emoji,
            projectName: t.projectId || 'No project'
          };
        });
        
        // Filter and calculate
        needsAttention = filterNeedsAttention(tasks);
        recentCompleted = tasks
          .filter(t => t.status === 'done')
          .sort((a, b) => {
            // Sort by completedAt first, fall back to updatedAt
            const aDate = new Date(a.completedAt || a.updatedAt || 0).getTime();
            const bDate = new Date(b.completedAt || b.updatedAt || 0).getTime();
            return bDate - aDate;
          })
          .slice(0, 5);
        
        calculateStats(tasks, agents);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }
    
    loading = false;
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
    if (lastMsg.type === 'agent_status' || lastMsg.type === 'task_update' || lastMsg.type === 'activity') {
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
  
  <!-- Main Grid: 2-column on desktop, stack on mobile -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- 1. Needs Attention -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-700 bg-slate-700/50">
        <h2 class="font-semibold text-slate-100 flex items-center gap-2">
          <span>🚨</span> Needs Attention
        </h2>
      </div>
      <div class="p-4 space-y-3 min-h-[200px]">
        {#if loading}
          <div class="text-center py-8 text-slate-500">Loading...</div>
        {:else if needsAttention.length === 0}
          <div class="text-center py-8 text-slate-500">All tasks on track ✅</div>
        {:else}
          {#each needsAttention as task}
            <div class="p-3 bg-slate-700/50 rounded-lg border-l-2 border-orange-500 hover:bg-slate-700 transition-colors cursor-pointer">
              <div class="flex items-start justify-between gap-2 mb-1">
                <div class="flex-1">
                  <div class="font-medium text-slate-100">{task.title}</div>
                  <div class="text-xs text-slate-500">{task.projectName || 'Unknown project'}</div>
                </div>
                <span class="inline-block px-2 py-1 rounded text-xs font-medium {task.priority === 'P0' ? 'bg-red-500/20 text-red-300' : task.priority === 'P1' ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-600 text-slate-300'}">
                  {task.priority}
                </span>
              </div>
              <div class="flex items-center justify-between text-xs text-slate-400">
                <span>Status: {task.status.replace('_', ' ')}</span>
                {#if task.agentName}
                  <span>{task.agentEmoji || '🤖'} {task.agentName}</span>
                {:else}
                  <span class="text-red-400">Unassigned</span>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
    
    <!-- 2. Quick Stats -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-700 bg-slate-700/50">
        <h2 class="font-semibold text-slate-100 flex items-center gap-2">
          <span>📊</span> Quick Stats
        </h2>
      </div>
      <div class="p-4 grid grid-cols-3 gap-3">
        <div class="bg-slate-700/50 rounded-lg p-4 border border-slate-600 text-center">
          <div class="text-3xl font-bold text-blue-400">{loading ? '...' : tasksToday}</div>
          <div class="text-xs text-slate-400 mt-1">Tasks Today</div>
        </div>
        <div class="bg-slate-700/50 rounded-lg p-4 border border-slate-600 text-center">
          <div class="text-3xl font-bold text-green-400">{loading ? '...' : completedThisWeek}</div>
          <div class="text-xs text-slate-400 mt-1">Completed Week</div>
        </div>
        <div class="bg-slate-700/50 rounded-lg p-4 border border-slate-600 text-center">
          <div class="text-3xl font-bold text-purple-400">{loading ? '...' : activeAgents}</div>
          <div class="text-xs text-slate-400 mt-1">Active Agents</div>
        </div>
      </div>
      
      <!-- Additional Info -->
      <div class="px-4 py-3 border-t border-slate-700">
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-slate-400">Total Tasks:</span>
            <span class="text-slate-100 font-medium">{loading ? '...' : tasks.length}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Total Agents:</span>
            <span class="text-slate-100 font-medium">{loading ? '...' : agents.length}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Issues to Address:</span>
            <span class="text-slate-100 font-medium">{loading ? '...' : needsAttention.length}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Second Row: Agent Status + Recent Activity -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- 3. Agent Status Grid -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-700 bg-slate-700/50">
        <h2 class="font-semibold text-slate-100 flex items-center gap-2">
          <span>🤖</span> Agent Status
        </h2>
      </div>
      <div class="p-4">
        {#if loading}
          <div class="text-center py-8 text-slate-500">Loading agents...</div>
        {:else if agents.length === 0}
          <div class="text-center py-8 text-slate-500">No agents found</div>
        {:else}
          <div class="grid grid-cols-3 gap-3">
            {#each agents as agent}
              <div class="bg-slate-700/50 rounded-lg p-3 border border-slate-600 hover:border-slate-500 transition-colors cursor-pointer">
                <div class="flex items-start gap-2 mb-2">
                  <span class="text-2xl">{agent.emoji || '🤖'}</span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-slate-100 truncate">{agent.name}</div>
                    <div class="text-xs text-slate-500 truncate">{agent.role || 'Agent'}</div>
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full {getStatusColor(agent.status)}"></span>
                  <span class="text-xs text-slate-400">{getStatusDisplay(agent.status)}</span>
                </div>
                {#if agent.lastActive}
                  <div class="text-xs text-slate-500 mt-1">{formatRelativeTime(agent.lastActive)}</div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    
    <!-- 4. Recent Activity -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-slate-700 bg-slate-700/50">
        <h2 class="font-semibold text-slate-100 flex items-center gap-2">
          <span>📋</span> Recent Activity
        </h2>
      </div>
      <div class="p-4 space-y-3">
        {#if loading}
          <div class="text-center py-8 text-slate-500">Loading...</div>
        {:else if recentCompleted.length === 0}
          <div class="text-center py-8 text-slate-500">No completed tasks</div>
        {:else}
          {#each recentCompleted as task}
            <div class="p-3 bg-slate-700/50 rounded-lg border-l-2 border-green-500 hover:bg-slate-700 transition-colors">
              <div class="flex items-start justify-between gap-2 mb-1">
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-slate-100 truncate">{task.title}</div>
                  <div class="text-xs text-slate-500">
                    {task.projectName || 'Unknown project'}
                  </div>
                </div>
                <span class="inline-block px-2 py-1 rounded text-xs bg-green-500/20 text-green-300 whitespace-nowrap">
                  Done
                </span>
              </div>
              <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span title={task.completedAt || task.updatedAt || ''}>
                  {formatRelativeTime(task.completedAt || task.updatedAt || '')}
                  <span class="text-slate-500 ml-1">
                    ({new Date(task.completedAt || task.updatedAt || '').toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })})
                  </span>
                </span>
                <span>{task.agentEmoji || '🤖'} {task.agentName || 'Unknown'}</span>
              </div>
              {#if task.tokens || task.cost}
                <div class="flex gap-3 text-xs text-slate-500 pt-1 border-t border-slate-600">
                  {#if task.tokens}
                    <span>📊 {formatTokens(task.tokens.total)} tokens</span>
                  {/if}
                  {#if task.cost}
                    <span>💰 ${task.cost.toFixed(2)}</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- Background set in app.css -->
