<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchWeeklyReport,
    sendWeeklyReport,
    type WeeklyReport,
    type Project,
  } from '$lib/api';
  import { toasts } from '$lib/stores/toasts';

  // ---- State ----
  let days = 7;
  let selectedProjectId = '';
  let projects: Project[] = [];
  let report: WeeklyReport | null = null;
  let loading = false;
  let error = '';
  let sending = false;

  const dayOptions = [7, 14, 30];

  // ---- Derived ----
  $: selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  $: reportChannel = selectedProject?.reportChannel ?? null;

  // ---- Load projects list ----
  async function loadProjects() {
    try {
      const API_BASE =
        typeof window !== 'undefined'
          ? `http://${window.location.hostname}:3001/api`
          : 'http://localhost:3001/api';
      const res = await fetch(`${API_BASE}/projects`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        projects = data.projects || [];
      }
    } catch (e) {
      console.error('Failed to load projects', e);
    }
  }

  // ---- Load report ----
  async function loadReport() {
    loading = true;
    error = '';
    try {
      report = await fetchWeeklyReport(days, selectedProjectId || undefined);
    } catch (e: any) {
      error = e.message || 'Failed to load report';
      report = null;
    } finally {
      loading = false;
    }
  }

  // ---- Send to Slack ----
  async function handleSend() {
    if (!selectedProjectId) {
      toasts.add({ message: 'Select a project first', type: 'error' });
      return;
    }
    if (!reportChannel) {
      toasts.add({
        message: `No Report Channel set for this project. Add **Report Channel:** C0XXXXXXX to its PROJECT.md.`,
        type: 'error',
        duration: 8000,
      });
      return;
    }

    sending = true;
    try {
      const result = await sendWeeklyReport({ projectId: selectedProjectId, days });
      toasts.add({ message: `Report sent to Slack ✅`, type: 'success' });
    } catch (e: any) {
      toasts.add({ message: e.message || 'Failed to send report', type: 'error', duration: 8000 });
    } finally {
      sending = false;
    }
  }

  let mounted = false;

  onMount(async () => {
    await loadProjects();
    await loadReport();
    mounted = true;
  });

  // Reactively reload when controls change (after initial mount)
  $: if (mounted && (days || selectedProjectId !== undefined)) {
    loadReport();
  }

  // ---- Helpers ----
  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function fmtMoney(n: number) {
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtNumber(n: number) {
    return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  function priorityLabel(p?: number) {
    if (p === undefined || p === null) return '';
    return `P${p}`;
  }

  function progressColor(pct: number) {
    if (pct >= 75) return 'bg-green-500';
    if (pct >= 40) return 'bg-yellow-500';
    return 'bg-blue-500';
  }
</script>

<div class="max-w-5xl mx-auto space-y-6">
  <!-- ── Header ──────────────────────────────────────────────── -->
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-slate-100">📊 Weekly Report</h1>
      {#if report}
        <p class="text-sm text-slate-400 mt-0.5">
          {fmtDate(report.period.from)} – {fmtDate(report.period.to)}
        </p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <!-- Project selector -->
      <select
        bind:value={selectedProjectId}
        class="bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All projects</option>
        {#each projects as p}
          <option value={p.id}>{p.name}{p.reportChannel ? ' 📢' : ''}</option>
        {/each}
      </select>

      <!-- Days selector -->
      <div class="flex rounded-lg overflow-hidden border border-slate-600">
        {#each dayOptions as d}
          <button
            class="px-3 py-2 text-sm font-medium transition-colors
              {days === d
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}"
            on:click={() => (days = d)}
          >
            {d}d
          </button>
        {/each}
      </div>

      <!-- Print -->
      <button
        on:click={() => window.print()}
        class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
        title="Print report"
      >
        🖨️ Print
      </button>

      <!-- Send to Slack -->
      <button
        on:click={handleSend}
        disabled={sending || !selectedProjectId}
        class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
          {!selectedProjectId || sending
            ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
            : 'bg-green-600 hover:bg-green-700 text-white'}"
        title={!selectedProjectId
          ? 'Select a project to send its report'
          : !reportChannel
          ? 'No Report Channel set in PROJECT.md'
          : 'Send to Slack'}
      >
        {#if sending}
          <span class="animate-spin">⏳</span> Sending…
        {:else}
          📤 Send to Slack
        {/if}
      </button>
    </div>
  </div>

  <!-- ── Report Channel helper note ─────────────────────────── -->
  {#if selectedProjectId && !reportChannel}
    <div class="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 text-sm text-yellow-300">
      <span class="font-semibold">No report channel configured for this project.</span>
      To enable Slack delivery, add the following line to
      <code class="bg-yellow-900/50 px-1 rounded">{selectedProjectId}/PROJECT.md</code>:
      <pre class="mt-2 bg-yellow-900/50 rounded p-2 text-yellow-200 text-xs select-all">**Report Channel:** C0XXXXXXX</pre>
      Replace <code>C0XXXXXXX</code> with your Slack channel ID (right-click a channel → "Copy link" → the ID is at the end).
    </div>
  {/if}

  {#if selectedProjectId && reportChannel}
    <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-3 text-sm text-slate-400 flex items-center gap-2">
      <span class="text-green-400">📢</span>
      Reports for <span class="font-semibold text-slate-300">{selectedProject?.name}</span> will post to Slack channel <code class="bg-slate-700 px-1.5 py-0.5 rounded text-slate-200">{reportChannel}</code>
    </div>
  {/if}

  <!-- ── Loading / error ────────────────────────────────────── -->
  {#if loading}
    <div class="flex items-center justify-center py-20 text-slate-400">
      <span class="animate-spin mr-3 text-2xl">⏳</span> Loading report…
    </div>
  {:else if error}
    <div class="bg-red-900/30 border border-red-700/50 rounded-xl p-4 text-red-300">
      ❌ {error}
    </div>
  {:else if report}
    <!-- ── Flags ──────────────────────────────────────────────── -->
    {#if report.flags.length > 0}
      <div class="space-y-2">
        {#each report.flags as flag}
          <div class="flex items-start gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
            <span class="text-lg mt-0.5">🚩</span>
            <span>{flag}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- ── Numbers card ───────────────────────────────────────── -->
    <div class="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 class="text-slate-300 font-semibold mb-4 flex items-center gap-2">💰 Numbers</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="text-center">
          <div class="text-2xl font-bold text-green-400">{report.costs.tasksCompleted}</div>
          <div class="text-xs text-slate-400 mt-1">Tasks Shipped</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-green-400">{fmtNumber(report.costs.hoursSaved)}h</div>
          <div class="text-xs text-slate-400 mt-1">Hours Saved</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-blue-400">{report.costs.roi}</div>
          <div class="text-xs text-slate-400 mt-1">ROI</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-emerald-400">{fmtMoney(report.costs.savings)}</div>
          <div class="text-xs text-slate-400 mt-1">Net Savings</div>
        </div>
      </div>
      {#if report.shipped.length > 0}
        {@const allShipped = report.shipped.flatMap(p => p.tasks)}
        {@const bugs = allShipped.filter(t => t.type === 'bug').length}
        {@const features = allShipped.filter(t => t.type === 'feature').length}
        {#if bugs > 0 || features > 0}
          <div class="mt-3 text-sm text-slate-400">
            {#if features > 0}<span class="text-blue-400">✨ {features} feature{features !== 1 ? 's' : ''}</span>{/if}
            {#if features > 0 && bugs > 0} · {/if}
            {#if bugs > 0}<span class="text-red-400">🐛 {bugs} bug{bugs !== 1 ? 's' : ''} fixed</span>{/if}
          </div>
        {/if}
      {/if}
      <div class="mt-4 pt-4 border-t border-slate-700 flex flex-wrap gap-6 text-sm text-slate-400">
        <span>AI cost: <span class="text-slate-200">{fmtMoney(report.costs.aiCost)}</span></span>
        <span>Human equivalent: <span class="text-slate-200">{fmtMoney(report.costs.humanCost)}</span></span>
      </div>
    </div>

    <!-- ── Shipped ────────────────────────────────────────────── -->
    <div class="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 class="text-slate-300 font-semibold mb-4 flex items-center gap-2">
        ✅ Shipped
        <span class="ml-1 bg-green-900/50 text-green-400 text-xs px-2 py-0.5 rounded-full">
          {report.shipped.reduce((s, g) => s + g.taskCount, 0)} tasks
        </span>
      </h2>
      {#if report.shipped.length === 0}
        <p class="text-slate-500 text-sm">No tasks completed in this period.</p>
      {:else}
        <div class="space-y-4">
          {#each report.shipped as group}
            <div>
              <div class="flex items-center gap-2 mb-2">
                <span class="font-medium text-slate-200">{group.projectName}</span>
                <span class="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                  {group.taskCount} task{group.taskCount !== 1 ? 's' : ''}
                </span>
              </div>
              <ul class="space-y-1 pl-3 border-l border-slate-700">
                {#each group.tasks as task}
                  <li class="text-sm text-slate-300 flex items-start gap-2">
                    <span class="text-green-500 mt-0.5">✓</span>
                    <span>{task.title}</span>
                    {#if task.agentId}
                      <span class="text-slate-500 text-xs ml-auto shrink-0">{task.agentId}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- ── In Progress + In Review ───────────────────────────── -->
    <div class="grid sm:grid-cols-2 gap-4">
      <!-- In Progress -->
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 class="text-slate-300 font-semibold mb-3 flex items-center gap-2">
          🔄 In Progress
          <span class="ml-1 bg-blue-900/50 text-blue-400 text-xs px-2 py-0.5 rounded-full">
            {report.inProgress.length}
          </span>
        </h2>
        {#if report.inProgress.length === 0}
          <p class="text-slate-500 text-sm">Nothing in progress.</p>
        {:else}
          <ul class="space-y-2">
            {#each report.inProgress as task}
              <li class="text-sm flex items-start gap-2">
                <span class="text-blue-400 mt-0.5 shrink-0">›</span>
                <div class="min-w-0">
                  <div class="text-slate-200 truncate">{task.title}</div>
                  {#if task.agentId}
                    <div class="text-xs text-slate-500">{task.agentId}</div>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- In Review -->
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 class="text-slate-300 font-semibold mb-3 flex items-center gap-2">
          👀 In Review
          <span class="ml-1 bg-yellow-900/50 text-yellow-400 text-xs px-2 py-0.5 rounded-full">
            {report.inReview.length}
          </span>
        </h2>
        {#if report.inReview.length === 0}
          <p class="text-slate-500 text-sm">Nothing in review.</p>
        {:else}
          <ul class="space-y-2">
            {#each report.inReview as task}
              <li class="text-sm flex items-start gap-2">
                <span class="text-yellow-400 mt-0.5 shrink-0">›</span>
                <div class="min-w-0">
                  <div class="text-slate-200 truncate">{task.title}</div>
                  {#if task.agentId}
                    <div class="text-xs text-slate-500">{task.agentId}</div>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <!-- ── Milestones ─────────────────────────────────────────── -->
    {#if report.milestones.length > 0}
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 class="text-slate-300 font-semibold mb-4">🎯 Milestones</h2>
        <div class="space-y-4">
          {#each report.milestones as m}
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-slate-200 text-sm font-medium">{m.name}</span>
                <div class="text-xs text-slate-400 flex items-center gap-3">
                  <span>{m.doneTasks}/{m.totalTasks} tasks ({m.progress}%)</span>
                  {#if m.targetDate}
                    <span class="text-slate-500">target {m.targetDate}</span>
                  {/if}
                </div>
              </div>
              <div class="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all {progressColor(m.progress)}"
                  style="width: {m.progress}%"
                ></div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── Up Next ────────────────────────────────────────────── -->
    {#if report.upcoming.length > 0}
      <div class="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <h2 class="text-slate-300 font-semibold mb-3">📋 Up Next</h2>
        <ul class="space-y-2">
          {#each report.upcoming as task}
            <li class="text-sm flex items-center gap-3">
              {#if task.priority !== undefined && task.priority !== null}
                <span class="shrink-0 text-xs font-bold px-1.5 py-0.5 rounded
                  {task.priority === 0 ? 'bg-red-900/60 text-red-400' :
                   task.priority === 1 ? 'bg-orange-900/60 text-orange-400' :
                   task.priority === 2 ? 'bg-yellow-900/60 text-yellow-400' :
                   'bg-slate-700 text-slate-400'}">
                  P{task.priority}
                </span>
              {/if}
              <span class="text-slate-200 flex-1 truncate">{task.title}</span>
              {#if task.projectName}
                <span class="text-xs text-slate-500 shrink-0">{task.projectName}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

  {:else}
    <div class="text-center py-20 text-slate-500">No report data available.</div>
  {/if}
</div>
