<script lang="ts">
  import { onMount } from 'svelte';

  interface CostSummary {
    totalTasks: number;
    totalLines: number;
    totalAiCost: number;
    totalHumanCost: number;
    totalAiSeconds: number;
    totalHumanMinutes: number;
    netSavings: number;
    hoursSaved: number;
  }

  interface AgentCost {
    agentId: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
  }

  interface ProjectCost {
    projectId: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
  }

  interface TimeSeriesPoint {
    date: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
  }

  interface RecentTask {
    id: string;
    title: string;
    agentId: string;
    projectId: string;
    model: string;
    cost: number;
    runtime: number;
    humanCost: number;
    estimatedHumanMinutes: number;
    linesAdded: number;
    linesRemoved: number;
    linesTotal: number;
    completedAt: string;
    savings: number;
  }

  let summary: CostSummary | null = null;
  let agents: AgentCost[] = [];
  let projects: ProjectCost[] = [];
  let timeSeries: TimeSeriesPoint[] = [];
  let recentTasks: RecentTask[] = [];
  let loading = true;
  let error = '';

  async function loadData() {
    loading = true;
    error = '';
    try {
      const API_BASE = `http://${window.location.hostname}:3001/api`;

      const [summaryRes, agentsRes, projectsRes, timeSeriesRes, recentRes] = await Promise.all([
        fetch(`${API_BASE}/costs/summary`),
        fetch(`${API_BASE}/costs/by-agent`),
        fetch(`${API_BASE}/costs/by-project`),
        fetch(`${API_BASE}/costs/over-time?period=day`),
        fetch(`${API_BASE}/costs/recent?limit=10`),
      ]);

      if (summaryRes.ok) summary = await summaryRes.json();
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        agents = data.agents || [];
      }
      if (projectsRes.ok) {
        const data = await projectsRes.json();
        projects = data.projects || [];
      }
      if (timeSeriesRes.ok) {
        const data = await timeSeriesRes.json();
        timeSeries = data.timeSeries || [];
      }
      if (recentRes.ok) {
        const data = await recentRes.json();
        recentTasks = data.tasks || [];
      }
    } catch (e) {
      error = 'Failed to load cost data';
      console.error(e);
    } finally {
      loading = false;
    }
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
  }

  function formatRuntime(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (minutes < 60) {
      return `${minutes}m ${secs}s`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function truncateId(id: string | null | undefined): string {
    if (!id) return 'N/A';
    return id.slice(0, 8);
  }

  // Calculate max savings for bar charts
  $: maxAgentSavings = agents.length > 0 ? Math.max(...agents.map(a => a.savings)) : 1;
  $: maxProjectSavings = projects.length > 0 ? Math.max(...projects.map(p => p.savings)) : 1;
  $: maxTimeSavings = timeSeries.length > 0 ? Math.max(...timeSeries.map(t => t.savings), 1) : 1;

  onMount(() => {
    loadData();
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold text-slate-100">💰 Cost Dashboard</h1>
    <p class="text-slate-400">Track AI vs human cost savings</p>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
    </div>
  {:else if error}
    <div class="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded">
      {error}
    </div>
  {:else}
    <!-- Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total Saved -->
      <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">💰</span>
          <span class="text-slate-400 text-sm">Total Saved</span>
        </div>
        <p class="text-3xl font-bold text-green-400">
          {summary ? formatCurrency(summary.netSavings) : '$0'}
        </p>
      </div>

      <!-- Hours Saved -->
      <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">⏱️</span>
          <span class="text-slate-400 text-sm">Hours Saved</span>
        </div>
        <p class="text-3xl font-bold text-blue-400">
          {summary ? summary.hoursSaved.toFixed(1) : '0.0'}h
        </p>
      </div>

      <!-- Lines of Code -->
      <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">📝</span>
          <span class="text-slate-400 text-sm">Lines of Code</span>
        </div>
        <p class="text-3xl font-bold text-purple-400">
          {summary ? formatNumber(summary.totalLines) : '0'}
        </p>
      </div>

      <!-- Tasks Completed -->
      <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">✅</span>
          <span class="text-slate-400 text-sm">Tasks Completed</span>
        </div>
        <p class="text-3xl font-bold text-slate-100">
          {summary ? formatNumber(summary.totalTasks) : '0'}
        </p>
      </div>
    </div>

    <!-- Cost Breakdown -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Savings by Agent -->
      <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h2 class="text-lg font-semibold text-slate-100 mb-4">💰 Savings by Agent</h2>
        {#if agents.length === 0}
          <p class="text-slate-400">No agent data available</p>
        {:else}
          <div class="space-y-3">
            {#each agents as agent}
              <div>
                <div class="flex justify-between text-sm mb-1">
                  <span class="text-slate-300">{truncateId(agent.agentId)}</span>
                  <span class="text-green-400">{formatCurrency(agent.savings)}</span>
                </div>
                <div class="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    class="h-full bg-green-500 rounded-full transition-all"
                    style="width: {(agent.savings / maxAgentSavings) * 100}%"
                  ></div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Savings by Project -->
      <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h2 class="text-lg font-semibold text-slate-100 mb-4">📁 Savings by Project</h2>
        {#if projects.length === 0}
          <p class="text-slate-400">No project data available</p>
        {:else}
          <div class="space-y-3">
            {#each projects as project}
              <div>
                <div class="flex justify-between text-sm mb-1">
                  <span class="text-slate-300">{truncateId(project.projectId)}</span>
                  <span class="text-green-400">{formatCurrency(project.savings)}</span>
                </div>
                <div class="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    class="h-full bg-blue-500 rounded-full transition-all"
                    style="width: {(project.savings / maxProjectSavings) * 100}%"
                  ></div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Savings Over Time -->
    <div class="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 class="text-lg font-semibold text-slate-100 mb-4">📈 Savings Over Time (Last 7 Days)</h2>
      {#if timeSeries.length === 0}
        <p class="text-slate-400">No time series data available</p>
      {:else}
        <div class="space-y-3">
          {#each timeSeries as point}
            <div class="flex items-center gap-4">
              <span class="text-slate-400 text-sm w-20">{point.date}</span>
              <div class="flex-1 h-4 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  class="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all"
                  style="width: {(point.savings / maxTimeSavings) * 100}%"
                ></div>
              </div>
              <span class="text-green-400 text-sm w-24 text-right">{formatCurrency(point.savings)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Recent Tasks Table -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-700">
        <h2 class="text-lg font-semibold text-slate-100">📋 Recent Completed Tasks</h2>
      </div>
      {#if recentTasks.length === 0}
        <div class="p-6 text-slate-400">No completed tasks with cost data</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-slate-700/50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Task</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Agent</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Model</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">AI Cost</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Human Cost</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Savings</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Lines</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Runtime</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-700">
              {#each recentTasks as task}
                <tr class="hover:bg-slate-700/30">
                  <td class="px-4 py-3">
                    <span class="text-slate-200 text-sm truncate max-w-xs block">{task.title}</span>
                  </td>
                  <td class="px-4 py-3 text-slate-400 text-sm font-mono">{truncateId(task.agentId)}</td>
                  <td class="px-4 py-3 text-slate-400 text-sm">{task.model || '-'}</td>
                  <td class="px-4 py-3 text-right text-slate-300">{formatCurrency(task.cost)}</td>
                  <td class="px-4 py-3 text-right text-slate-300">{formatCurrency(task.humanCost)}</td>
                  <td class="px-4 py-3 text-right text-green-400 font-medium">{formatCurrency(task.savings)}</td>
                  <td class="px-4 py-3 text-right text-slate-400">
                    {task.linesAdded > 0 ? `+${task.linesAdded}` : ''}
                    {task.linesRemoved > 0 ? ` -{task.linesRemoved}` : ''}
                  </td>
                  <td class="px-4 py-3 text-right text-slate-400">{formatRuntime(task.runtime / 1000)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
