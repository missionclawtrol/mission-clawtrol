<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    fetchAgents, 
    fetchTasks, 
    fetchAuditLog, 
    checkHealth, 
    type Agent, 
    type Task,
    type AuditEntry 
  } from '$lib/api';
  import { connectWebSocket, wsConnected, wsMessages } from '$lib/websocket';
  import DonutChart from '$lib/components/DonutChart.svelte';
  import BarChart from '$lib/components/BarChart.svelte';
  
  let agents: Agent[] = [];
  let tasks: Task[] = [];
  let auditLog: AuditEntry[] = [];
  let backendConnected = false;
  let loading = true;
  
  // Summary stats
  let totalTasks = 0;
  let completedThisWeek = 0;
  let totalSavings = 0;
  let activeAgents = 0;
  
  // Chart data
  let statusLabels: string[] = [];
  let statusData: number[] = [];
  let statusColors: string[] = [];
  
  let assigneeLabels: string[] = [];
  let assigneeData: number[] = [];
  let assigneeColors: string[] = [];
  
  // Status color mapping (matching kanban columns)
  const STATUS_COLORS: Record<string, string> = {
    'backlog': '#64748b', // slate-500
    'todo': '#3b82f6', // blue-500
    'in-progress': '#f59e0b', // amber-500
    'review': '#a855f7', // purple-500
    'done': '#10b981', // emerald-500
  };
  
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
    if (diffDays < 7) return `${diffDays}d ago`;
    return then.toLocaleDateString();
  }
  
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }
  
  function getActionLabel(entry: AuditEntry): string {
    const details = entry.details || {};
    
    // Map action types to human-readable labels
    switch (entry.action) {
      case 'task.created':
        return `created task "${details.title || 'Untitled'}"`;
      case 'task.updated':
        if (details.status) {
          const oldStatus = details.oldStatus || 'unknown';
          const newStatus = details.status || 'unknown';
          return `moved "${details.title || 'task'}" from ${oldStatus} to ${newStatus}`;
        }
        return `updated task "${details.title || 'Untitled'}"`;
      case 'task.status_changed':
        const oldStatus = (details.oldStatus || 'unknown').replace(/-/g, ' ');
        const newStatus = (details.newStatus || 'unknown').replace(/-/g, ' ');
        return `moved task from ${oldStatus} to ${newStatus}`;
      case 'task.deleted':
        return `deleted task "${details.title || 'Untitled'}"`;
      case 'task.assigned':
        return `assigned "${details.title || 'task'}" to ${details.agentId || 'agent'}`;
      case 'project.created':
        return `created project "${details.name || 'Untitled'}"`;
      case 'project.updated':
        return `updated project "${details.name || 'Untitled'}"`;
      case 'project.deleted':
        return `deleted project "${details.name || 'Untitled'}"`;
      case 'agent.spawned':
        return `spawned agent for "${details.task || 'task'}"`;
      default:
        return entry.action.replace(/[._]/g, ' ');
    }
  }
  
  function calculateStats() {
    // Total tasks
    totalTasks = tasks.length;
    
    // Completed this week
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    completedThisWeek = tasks.filter(t => {
      if (t.status !== 'done' || !t.updatedAt) return false;
      const updated = new Date(t.updatedAt);
      return updated >= weekAgo;
    }).length;
    
    // Total savings (sum of humanCost for done tasks)
    totalSavings = tasks
      .filter(t => t.status === 'done' && t.humanCost)
      .reduce((sum, t) => sum + (t.humanCost || 0), 0);
    
    // Active agents (distinct agentId values on in-progress tasks)
    const activeAgentIds = new Set(
      tasks
        .filter(t => t.status === 'in-progress' && t.agentId)
        .map(t => t.agentId)
    );
    activeAgents = activeAgentIds.size;
  }
  
  function prepareStatusChart() {
    // Count tasks by status
    const statusCounts: Record<string, number> = {
      'backlog': 0,
      'todo': 0,
      'in-progress': 0,
      'review': 0,
      'done': 0,
    };
    
    tasks.forEach(task => {
      if (statusCounts[task.status] !== undefined) {
        statusCounts[task.status]++;
      }
    });
    
    // Prepare chart data
    statusLabels = Object.keys(statusCounts).map(s => 
      s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    );
    statusData = Object.values(statusCounts);
    statusColors = Object.keys(statusCounts).map(s => STATUS_COLORS[s] || '#64748b');
  }
  
  function prepareAssigneeChart() {
    // Count tasks by assignee
    const assigneeCounts: Record<string, number> = {};
    
    tasks.forEach(task => {
      const assignee = task.agentName || 'Unassigned';
      assigneeCounts[assignee] = (assigneeCounts[assignee] || 0) + 1;
    });
    
    // Sort by count descending
    const sorted = Object.entries(assigneeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 assignees
    
    assigneeLabels = sorted.map(([name]) => name);
    assigneeData = sorted.map(([, count]) => count);
    
    // Generate colors (alternating shades of blue)
    assigneeColors = assigneeLabels.map((_, i) => {
      const colors = ['#3b82f6', '#60a5fa', '#93c5fd', '#2563eb', '#1d4ed8'];
      return colors[i % colors.length];
    });
  }
  
  async function loadData() {
    loading = true;
    
    // Check backend health
    backendConnected = await checkHealth();
    
    if (backendConnected) {
      try {
        // Fetch data in parallel
        const [agentsData, tasksData, auditData] = await Promise.all([
          fetchAgents(),
          fetchTasks(),
          fetchAuditLog({ limit: 30 }),
        ]);
        
        agents = agentsData;
        tasks = tasksData;
        auditLog = auditData;
        
        // Agent display info mapping
        const agentInfo: Record<string, { name: string; emoji: string }> = {
          'manager': { name: 'Henry', emoji: '🎯' },
          'builder': { name: 'Elon', emoji: '🔨' },
          'researcher': { name: 'Marie', emoji: '🔍' },
          'writer': { name: 'Ernest', emoji: '✍️' },
          'analyst': { name: 'Warren', emoji: '📊' },
          'designer': { name: 'Steve', emoji: '🎨' },
        };
        
        // Enrich tasks with agent info
        tasks = tasks.map(t => {
          const agentId = t.agentId || '';
          const agent = agentInfo[agentId] || { name: agentId || 'Unassigned', emoji: '🤖' };
          return {
            ...t,
            agentName: agent.name,
            agentEmoji: agent.emoji,
          };
        });
        
        // Calculate stats and prepare charts
        calculateStats();
        prepareStatusChart();
        prepareAssigneeChart();
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
  
  <!-- Summary Stats Cards -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <!-- Total Tasks -->
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
      <div class="flex items-center justify-between mb-2">
        <span class="text-2xl">📋</span>
        <div class="text-3xl font-bold text-blue-400">{loading ? '...' : totalTasks}</div>
      </div>
      <div class="text-sm text-slate-400">Total Tasks</div>
    </div>
    
    <!-- Completed This Week -->
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
      <div class="flex items-center justify-between mb-2">
        <span class="text-2xl">✅</span>
        <div class="text-3xl font-bold text-green-400">{loading ? '...' : completedThisWeek}</div>
      </div>
      <div class="text-sm text-slate-400">Completed This Week</div>
    </div>
    
    <!-- Total Savings -->
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
      <div class="flex items-center justify-between mb-2">
        <span class="text-2xl">💰</span>
        <div class="text-3xl font-bold text-emerald-400">{loading ? '...' : formatCurrency(totalSavings)}</div>
      </div>
      <div class="text-sm text-slate-400">Total Savings</div>
    </div>
    
    <!-- Active Agents -->
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
      <div class="flex items-center justify-between mb-2">
        <span class="text-2xl">🤖</span>
        <div class="text-3xl font-bold text-purple-400">{loading ? '...' : activeAgents}</div>
      </div>
      <div class="text-sm text-slate-400">Active Agents</div>
    </div>
  </div>
  
  <!-- Charts Row -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Task Status Breakdown Chart -->
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-700/50">
        <h2 class="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <span>📊</span> Task Status Breakdown
        </h2>
      </div>
      <div class="p-6">
        {#if loading}
          <div class="text-center py-12 text-slate-500 dark:text-slate-500">Loading...</div>
        {:else if tasks.length === 0}
          <div class="text-center py-12 text-slate-500 dark:text-slate-500">No tasks yet</div>
        {:else}
          <DonutChart 
            labels={statusLabels}
            data={statusData}
            colors={statusColors}
          />
        {/if}
      </div>
    </div>
    
    <!-- Tasks by Assignee Bar Chart -->
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-700/50">
        <h2 class="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <span>👥</span> Tasks by Assignee
        </h2>
      </div>
      <div class="p-6">
        {#if loading}
          <div class="text-center py-12 text-slate-500 dark:text-slate-500">Loading...</div>
        {:else if tasks.length === 0}
          <div class="text-center py-12 text-slate-500 dark:text-slate-500">No tasks yet</div>
        {:else}
          <BarChart 
            labels={assigneeLabels}
            data={assigneeData}
            colors={assigneeColors}
            horizontal={true}
          />
        {/if}
      </div>
    </div>
  </div>
  
  <!-- Recent Activity Timeline -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
    <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-700/50">
      <h2 class="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <span>🕐</span> Recent Activity
      </h2>
    </div>
    <div class="p-4">
      {#if loading}
        <div class="text-center py-8 text-slate-500 dark:text-slate-500">Loading...</div>
      {:else if auditLog.length === 0}
        <div class="text-center py-8 text-slate-500 dark:text-slate-500">No recent activity</div>
      {:else}
        <div class="space-y-3">
          {#each auditLog as entry (entry.id)}
            <div class="flex gap-3 p-3 bg-gray-100/50 dark:bg-slate-700/30 rounded-lg hover:bg-gray-100 dark:bg-slate-700/50 transition-colors">
              <!-- Timeline dot -->
              <div class="flex flex-col items-center mt-1">
                <div class="w-2 h-2 rounded-full bg-blue-400"></div>
                {#if entry !== auditLog[auditLog.length - 1]}
                  <div class="w-0.5 h-full bg-slate-700 mt-1"></div>
                {/if}
              </div>
              
              <!-- Event content -->
              <div class="flex-1 min-w-0">
                <div class="text-sm text-slate-600 dark:text-slate-300">
                  <span class="font-medium text-slate-900 dark:text-slate-100">{entry.userId || 'System'}</span>
                  {' '}
                  {getActionLabel(entry)}
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-500 mt-1">
                  {formatRelativeTime(entry.createdAt)}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
