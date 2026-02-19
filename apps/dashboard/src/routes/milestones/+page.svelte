<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { fetchAllMilestones, type Milestone } from '$lib/api';

  let milestones: (Milestone & { projectName?: string })[] = [];
  let loading = true;

  async function load() {
    loading = true;
    try {
      milestones = await fetchAllMilestones();
    } catch (e) {
      console.error('Failed to load milestones:', e);
    } finally {
      loading = false;
    }
  }

  function formatTargetDate(dateStr?: string): string {
    if (!dateStr) return 'No target date';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getProgress(m: Milestone): number {
    if (!m.totalTasks) return 0;
    return Math.round((m.doneTasks / m.totalTasks) * 100);
  }

  function isOverdue(dateStr?: string): boolean {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  }

  onMount(load);
</script>

<div class="max-w-6xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold">🎯 Milestones</h1>
      <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Open milestones across all projects</p>
    </div>
    <button on:click={load} class="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">↻ Refresh</button>
  </div>

  {#if loading}
    <div class="text-center py-16 text-slate-500">Loading milestones...</div>
  {:else}
    {@const open = milestones.filter(m => m.status === 'open')}
    {#if open.length === 0}
      <div class="text-center py-16">
        <div class="text-4xl mb-4">🎯</div>
        <h2 class="text-lg font-medium text-slate-600 dark:text-slate-300 mb-2">No open milestones</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">Create milestones from the Projects page to group tasks into releases.</p>
        <button
          on:click={() => goto('/projects')}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
        >
          Go to Projects →
        </button>
      </div>
    {:else}
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {#each open as milestone}
          {@const progress = getProgress(milestone)}
          {@const overdue = isOverdue(milestone.targetDate)}
          <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4 hover:border-blue-500/50 transition-colors">
            <!-- Header -->
            <div class="flex items-start justify-between mb-3">
              <div class="flex-1 min-w-0">
                <div class="text-xs text-slate-500 dark:text-slate-400 mb-1">📁 {milestone.projectName || milestone.projectId}</div>
                <h3 class="font-semibold text-gray-900 dark:text-slate-100 truncate">{milestone.name}</h3>
                {#if milestone.description}
                  <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{milestone.description}</p>
                {/if}
              </div>
              <span class="ml-2 flex-shrink-0 px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400">open</span>
            </div>

            <!-- Target date -->
            <div class="flex items-center gap-1 mb-3 text-xs {overdue ? 'text-red-400' : 'text-slate-500 dark:text-slate-400'}">
              {#if overdue}
                <span>⚠️</span>
              {:else}
                <span>📅</span>
              {/if}
              <span>{formatTargetDate(milestone.targetDate)}</span>
            </div>

            <!-- Progress bar -->
            <div class="mb-2">
              <div class="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span>Progress</span>
                <span>{milestone.doneTasks}/{milestone.totalTasks} tasks</span>
              </div>
              <div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                <div
                  class="bg-blue-500 h-2 rounded-full transition-all"
                  style="width: {progress}%"
                ></div>
              </div>
              <div class="text-right text-xs text-slate-500 dark:text-slate-400 mt-0.5">{progress}%</div>
            </div>

            <!-- View Tasks link -->
            <button
              on:click={() => goto(`/tasks?milestone=${milestone.id}`)}
              class="w-full mt-3 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/10 rounded transition-colors text-center"
            >
              View Tasks →
            </button>
          </div>
        {/each}
      </div>

      {#if milestones.some(m => m.status === 'closed')}
        <div class="mt-8">
          <h2 class="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">Closed Milestones</h2>
          <div class="space-y-2">
            {#each milestones.filter(m => m.status === 'closed') as milestone}
              <div class="flex items-center gap-4 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700/50 opacity-60">
                <span class="text-sm font-medium text-slate-600 dark:text-slate-300">{milestone.name}</span>
                <span class="text-xs text-slate-500">📁 {milestone.projectName || milestone.projectId}</span>
                <span class="text-xs text-slate-500">{milestone.doneTasks}/{milestone.totalTasks} tasks</span>
                <button
                  on:click={() => goto(`/tasks?milestone=${milestone.id}`)}
                  class="ml-auto text-xs text-slate-500 hover:text-blue-400"
                >
                  View →
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</div>
