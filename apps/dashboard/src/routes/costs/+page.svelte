<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/stores';

  interface CostSummary {
    totalTasks: number;
    totalLines: number;
    totalAiCost: number;
    totalHumanCost: number;
    totalAiSeconds: number;
    totalHumanMinutes: number;
    netSavings: number;
    hoursSaved: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalTokens: number;
  }

  interface AgentCost {
    agentId: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
    tokensIn: number;
    tokensOut: number;
    totalTokens: number;
    runtimeSeconds: number;
  }

  interface ProjectCost {
    projectId: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
    tokensIn: number;
    tokensOut: number;
    totalTokens: number;
    runtimeSeconds: number;
  }

  interface MilestoneCost {
    milestoneId: string;
    milestoneName: string;
    projectId: string;
    tasks: number;
    aiCost: number;
    humanCost: number;
    savings: number;
    tokensIn: number;
    tokensOut: number;
    totalTokens: number;
    runtimeSeconds: number;
  }

  interface TimeSeriesPoint {
    date: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
    tokensIn: number;
    tokensOut: number;
  }

  interface RecentTask {
    id: string;
    title: string;
    agentId: string;
    projectId: string;
    milestoneId: string | null;
    model: string;
    cost: number;
    runtime: number;
    runtimeSeconds: number | null;
    humanCost: number;
    estimatedHumanMinutes: number;
    linesAdded: number;
    linesRemoved: number;
    linesTotal: number;
    tokensIn: number | null;
    tokensOut: number | null;
    totalTokens: number;
    completedAt: string;
    savings: number;
    estimatedCost: number;
  }

  let summary: CostSummary | null = null;
  let agents: AgentCost[] = [];
  let projects: ProjectCost[] = [];
  let milestones: MilestoneCost[] = [];
  let timeSeries: TimeSeriesPoint[] = [];
  let recentTasks: RecentTask[] = [];
  let loading = true;
  let error = '';

  const REQUEST_TIMEOUT_MS = 8000;

  async function fetchWithTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadData() {
    loading = true;
    error = '';
    try {
      const API_BASE = `http://${window.location.hostname}:3001/api`;

      const results = await Promise.allSettled([
        fetchWithTimeout(`${API_BASE}/costs/summary`),
        fetchWithTimeout(`${API_BASE}/costs/by-agent`),
        fetchWithTimeout(`${API_BASE}/costs/by-project`),
        fetchWithTimeout(`${API_BASE}/costs/by-milestone`),
        fetchWithTimeout(`${API_BASE}/costs/over-time?period=day`),
        fetchWithTimeout(`${API_BASE}/costs/recent?limit=20`),
      ]);

      const [summaryRes, agentsRes, projectsRes, milestonesRes, timeSeriesRes, recentRes] = results.map(result =>
        result.status === 'fulfilled' ? result.value : null
      );

      if (!summaryRes && !agentsRes && !projectsRes && !timeSeriesRes && !recentRes) {
        throw new Error('All cost requests failed');
      }

      if (summaryRes?.ok) summary = await summaryRes.json();
      if (agentsRes?.ok) {
        const data = await agentsRes.json();
        agents = data.agents || [];
      }
      if (projectsRes?.ok) {
        const data = await projectsRes.json();
        projects = data.projects || [];
      }
      if (milestonesRes?.ok) {
        const data = await milestonesRes.json();
        milestones = data.milestones || [];
      }
      if (timeSeriesRes?.ok) {
        const data = await timeSeriesRes.json();
        timeSeries = data.timeSeries || [];
      }
      if (recentRes?.ok) {
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
    // Format kebab-case ids into readable names
    return id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatTokens(total: number): string {
    if (!total) return '—';
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
    if (total >= 1_000) return `${(total / 1_000).toFixed(0)}K`;
    return total.toString();
  }

  // Calculate max savings for bar charts
  $: maxAgentSavings = agents.length > 0 ? Math.max(...agents.map(a => a.savings)) : 1;
  $: maxProjectSavings = projects.length > 0 ? Math.max(...projects.map(p => p.savings)) : 1;
  $: maxTimeSavings = timeSeries.length > 0 ? Math.max(...timeSeries.map(t => t.savings), 1) : 1;

  let lastPath = '';

  // Ensure we always load on route entry (client-side only)
  $: if (typeof window !== 'undefined' && $page.url.pathname === '/costs' && $page.url.pathname !== lastPath) {
    lastPath = $page.url.pathname;
    loadData();
  }

  onMount(() => {
    loadData();
    afterNavigate(() => {
      // Re-load on client-side navigation to avoid stale loading state
      loadData();
    });
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">💰 Cost Dashboard</h1>
    <p class="text-slate-500 dark:text-slate-400">Track AI vs human cost savings</p>
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
      <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">💰</span>
          <span class="text-slate-500 dark:text-slate-400 text-sm">Total Saved</span>
        </div>
        <p class="text-3xl font-bold text-green-400">
          {summary ? formatCurrency(summary.netSavings) : '$0'}
        </p>
      </div>

      <!-- Hours Saved -->
      <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">⏱️</span>
          <span class="text-slate-500 dark:text-slate-400 text-sm">Hours Saved</span>
        </div>
        <p class="text-3xl font-bold text-blue-400">
          {summary ? summary.hoursSaved.toFixed(1) : '0.0'}h
        </p>
      </div>

      <!-- Total Tokens -->
      <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">🧠</span>
          <span class="text-slate-500 dark:text-slate-400 text-sm">Total Tokens</span>
        </div>
        <p class="text-3xl font-bold text-amber-400">
          {summary ? formatTokens(summary.totalTokens) : '—'}
        </p>
        {#if summary && summary.totalTokens > 0}
          <p class="text-xs text-slate-500 mt-1">
            {formatTokens(summary.totalTokensIn)} in · {formatTokens(summary.totalTokensOut)} out
          </p>
        {/if}
      </div>

      <!-- Tasks Completed -->
      <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-2xl">✅</span>
          <span class="text-slate-500 dark:text-slate-400 text-sm">Tasks Completed</span>
        </div>
        <p class="text-3xl font-bold text-slate-900 dark:text-slate-100">
          {summary ? formatNumber(summary.totalTasks) : '0'}
        </p>
        {#if summary}
          <p class="text-xs text-slate-500 mt-1">{formatNumber(summary.totalLines)} lines changed</p>
        {/if}
      </div>
    </div>

    <!-- Cost Breakdown -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Savings by Agent -->
      <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">💰 Savings by Agent</h2>
        {#if agents.length === 0}
          <p class="text-slate-500 dark:text-slate-400">No agent data available</p>
        {:else}
          <div class="space-y-3">
            {#each agents as agent}
              <div>
                <div class="flex justify-between text-sm mb-1">
                  <span class="text-slate-600 dark:text-slate-300">{truncateId(agent.agentId)}</span>
                  <div class="flex items-center gap-3">
                    {#if agent.totalTokens > 0}
                      <span class="text-amber-400 text-xs">🧠 {formatTokens(agent.totalTokens)}</span>
                    {/if}
                    <span class="text-green-400">{formatCurrency(agent.savings)}</span>
                  </div>
                </div>
                <div class="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    class="h-full bg-green-500 rounded-full transition-all"
                    style="width: {(agent.savings / maxAgentSavings) * 100}%"
                  ></div>
                </div>
                <div class="flex gap-4 text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                  <span>{agent.tasks} tasks</span>
                  {#if agent.runtimeSeconds > 0}
                    <span>⏱ {formatRuntime(agent.runtimeSeconds)}</span>
                  {/if}
                  {#if agent.aiCost > 0}
                    <span>AI: {formatCurrency(agent.aiCost)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Savings by Project -->
      <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">📁 Savings by Project</h2>
        {#if projects.length === 0}
          <p class="text-slate-500 dark:text-slate-400">No project data available</p>
        {:else}
          <div class="space-y-3">
            {#each projects as project}
              <div>
                <div class="flex justify-between text-sm mb-1">
                  <span class="text-slate-600 dark:text-slate-300">{truncateId(project.projectId)}</span>
                  <div class="flex items-center gap-3">
                    {#if project.totalTokens > 0}
                      <span class="text-amber-400 text-xs">🧠 {formatTokens(project.totalTokens)}</span>
                    {/if}
                    <span class="text-green-400">{formatCurrency(project.savings)}</span>
                  </div>
                </div>
                <div class="h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    class="h-full bg-blue-500 rounded-full transition-all"
                    style="width: {(project.savings / maxProjectSavings) * 100}%"
                  ></div>
                </div>
                <div class="flex gap-4 text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                  <span>{project.tasks} tasks</span>
                  {#if project.runtimeSeconds > 0}
                    <span>⏱ {formatRuntime(project.runtimeSeconds)}</span>
                  {/if}
                  {#if project.aiCost > 0}
                    <span>AI: {formatCurrency(project.aiCost)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Savings by Milestone -->
    {#if milestones.length > 0}
      <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">🎯 Cost by Milestone</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 uppercase">
                <th class="text-left py-2 pr-4">Milestone</th>
                <th class="text-left py-2 pr-4">Project</th>
                <th class="text-right py-2 pr-4">Tasks</th>
                <th class="text-right py-2 pr-4">Tokens</th>
                <th class="text-right py-2 pr-4">Runtime</th>
                <th class="text-right py-2 pr-4">AI Cost</th>
                <th class="text-right py-2 pr-4">Human Cost</th>
                <th class="text-right py-2">Savings</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-slate-700">
              {#each milestones as m}
                <tr class="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                  <td class="py-2 pr-4 text-slate-700 dark:text-slate-300">🎯 {m.milestoneName}</td>
                  <td class="py-2 pr-4 text-slate-500 dark:text-slate-400">{truncateId(m.projectId)}</td>
                  <td class="py-2 pr-4 text-right text-slate-600 dark:text-slate-300">{m.tasks}</td>
                  <td class="py-2 pr-4 text-right text-amber-400">{m.totalTokens > 0 ? formatTokens(m.totalTokens) : '—'}</td>
                  <td class="py-2 pr-4 text-right text-slate-500 dark:text-slate-400">{m.runtimeSeconds > 0 ? formatRuntime(m.runtimeSeconds) : '—'}</td>
                  <td class="py-2 pr-4 text-right text-slate-600 dark:text-slate-300">{formatCurrency(m.aiCost)}</td>
                  <td class="py-2 pr-4 text-right text-slate-600 dark:text-slate-300">{formatCurrency(m.humanCost)}</td>
                  <td class="py-2 text-right text-green-400 font-medium">{formatCurrency(m.savings)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    <!-- Savings Over Time -->
    <div class="bg-white dark:bg-slate-800 rounded-lg p-6 border border-gray-200 dark:border-slate-700">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">📈 Savings Over Time (Last 7 Days)</h2>
      {#if timeSeries.length === 0}
        <p class="text-slate-500 dark:text-slate-400">No time series data available</p>
      {:else}
        <div class="space-y-3">
          {#each timeSeries as point}
            <div class="flex items-center gap-4">
              <span class="text-slate-500 dark:text-slate-400 text-sm w-20">{point.date}</span>
              <div class="flex-1 h-4 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">📋 Recent Completed Tasks</h2>
      </div>
      {#if recentTasks.length === 0}
        <div class="p-6 text-slate-500 dark:text-slate-400">No completed tasks with cost data</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-gray-100 dark:bg-gray-100/50 dark:bg-slate-700/50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Task</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Agent</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Model</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Completed</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Tokens In</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Tokens Out</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">AI Cost</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Human Cost</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Savings</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Runtime</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-700">
              {#each recentTasks as task}
                <tr class="hover:bg-gray-100 dark:bg-gray-100/50 dark:bg-slate-700/30">
                  <td class="px-4 py-3">
                    <span class="text-slate-200 text-sm truncate max-w-xs block">{task.title}</span>
                    {#if task.milestoneId}
                      <span class="text-xs text-amber-400">🎯 milestone</span>
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-slate-500 dark:text-slate-400 text-sm font-mono">{truncateId(task.agentId)}</td>
                  <td class="px-4 py-3 text-slate-500 dark:text-slate-400 text-sm">{task.model || '-'}</td>
                  <td class="px-4 py-3 text-slate-500 dark:text-slate-400 text-sm" title={task.completedAt}>
                    {new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    <span class="text-slate-500 ml-1">
                      {new Date(task.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right text-amber-400 text-sm">{task.tokensIn != null ? formatTokens(task.tokensIn) : '—'}</td>
                  <td class="px-4 py-3 text-right text-amber-300 text-sm">{task.tokensOut != null ? formatTokens(task.tokensOut) : '—'}</td>
                  <td class="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{formatCurrency(task.cost)}</td>
                  <td class="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{formatCurrency(task.humanCost)}</td>
                  <td class="px-4 py-3 text-right text-green-400 font-medium">{formatCurrency(task.savings)}</td>
                  <td class="px-4 py-3 text-right text-slate-500 dark:text-slate-400">{task.runtimeSeconds != null ? formatRuntime(task.runtimeSeconds) : (task.runtime ? formatRuntime(task.runtime / 1000) : '—')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
