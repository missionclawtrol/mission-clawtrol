<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';

  interface RosterAgent {
    id: string;
    name: string;
    emoji: string;
    fullName: string;
    status: 'online' | 'idle' | 'offline';
    activeSession: string | null;
  }

  interface AgentMemoryData {
    agentId: string;
    assembledAt: string;
    procedural: {
      role: string | null;
      rules: string;
      activeRules: Array<{ id: string; name: string; trigger: string; enabled: boolean; isBuiltIn: boolean }>;
    };
    semantic: {
      company: { profile: Record<string, unknown> | null; profileMd: string | null };
      project: { context: string | null };
      learned: string | null;
      agentTraining: string | null;
    };
    episodic: {
      myRecentTasks: Array<{ id: string; title: string; status: string; completedAt: string | null }>;
      failures: Array<{ id: string; title: string; status: string }>;
    };
    prospective: {
      pendingDependencies: Array<{ id: string; title: string; status: string }>;
      upcoming: Array<{ id: string; title: string; status: string; priority: string }>;
    };
  }

  interface AgentMemorySummary {
    agent: RosterAgent;
    memory: AgentMemoryData | null;
    completedTaskCount: number;
    failedTaskCount: number;
    loading: boolean;
    error: string | null;
  }

  let agents: RosterAgent[] = [];
  let memorySummaries: AgentMemorySummary[] = [];
  let loading = true;
  let error: string | null = null;
  let selectedAgentId: string | null = null;

  // --- Helpers ---

  function countLearnedEntries(learned: string | null): number {
    if (!learned) return 0;
    // Count ## section headers as entries
    const matches = learned.match(/^##\s+/gm);
    return matches ? matches.length : 0;
  }

  function getLearnedLastUpdated(learned: string | null): string | null {
    if (!learned) return null;
    // Extract dates from ## headers like "## Topic (2026-02-22)"
    const dateMatches = learned.match(/\((\d{4}-\d{2}-\d{2})\)/g);
    if (!dateMatches || dateMatches.length === 0) return null;
    const dates = dateMatches.map(d => d.replace(/[()]/g, ''));
    dates.sort((a, b) => b.localeCompare(a));
    return dates[0];
  }

  function getLearningRate(completedTaskCount: number, learnedEntries: number): number {
    if (completedTaskCount === 0) return 0;
    // Rough ratio: learned entries vs completed tasks
    return Math.min(100, Math.round((learnedEntries / completedTaskCount) * 100));
  }

  function getProceduralStatus(mem: AgentMemoryData): 'healthy' | 'warning' | 'error' {
    if (!mem.procedural.role) return 'error';
    return 'healthy';
  }

  function getSemanticStatus(mem: AgentMemoryData): 'healthy' | 'warning' | 'empty' {
    const entries = countLearnedEntries(mem.semantic.learned);
    if (entries === 0) return 'empty';
    if (entries < 3) return 'warning';
    return 'healthy';
  }

  function getEpisodicStatus(completedCount: number): 'healthy' | 'warning' | 'empty' {
    if (completedCount === 0) return 'empty';
    if (completedCount < 5) return 'warning';
    return 'healthy';
  }

  function getShortTermStatus(agent: RosterAgent): 'active' | 'idle' | 'offline' {
    return agent.status as 'active' | 'idle' | 'offline';
  }

  function getProspectiveStatus(mem: AgentMemoryData): 'pending' | 'empty' {
    if (mem.prospective.pendingDependencies.length > 0 || mem.prospective.upcoming.length > 0) {
      return 'pending';
    }
    return 'empty';
  }

  function statusDot(status: string): string {
    switch (status) {
      case 'healthy': return '🟢';
      case 'warning': return '🟡';
      case 'error': return '🔴';
      case 'empty': return '⚪';
      case 'active': return '🟡';
      case 'idle': return '🔵';
      case 'offline': return '⚫';
      case 'pending': return '🟣';
      default: return '⚪';
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'healthy': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      case 'empty': return 'text-slate-500';
      case 'active': return 'text-yellow-400';
      case 'idle': return 'text-blue-400';
      case 'offline': return 'text-slate-400';
      case 'pending': return 'text-purple-400';
      default: return 'text-slate-500';
    }
  }

  function learningRateColor(rate: number): string {
    if (rate >= 50) return 'text-green-400';
    if (rate >= 20) return 'text-yellow-400';
    if (rate > 0) return 'text-orange-400';
    return 'text-slate-500';
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return 'never';
    return dateStr;
  }

  // --- Data Loading ---

  async function loadData() {
    try {
      loading = true;
      error = null;

      // 1. Get agent roster
      const rosterResult = await api.get('/agents/roster');
      agents = rosterResult.agents || [];

      // 2. Initialize summaries
      memorySummaries = agents.map(agent => ({
        agent,
        memory: null,
        completedTaskCount: 0,
        failedTaskCount: 0,
        loading: true,
        error: null,
      }));

      // 3. Load memory + task counts in parallel per agent
      await Promise.all(memorySummaries.map(async (summary, index) => {
        try {
          const [memResult, doneResult, failedResult] = await Promise.all([
            api.get(`/agent/${summary.agent.id}/memory`).catch(() => null),
            api.get(`/tasks?agentId=${summary.agent.id}&status=done`).catch(() => ({ tasks: [] })),
            api.get(`/tasks?agentId=${summary.agent.id}&status=cancelled`).catch(() => ({ tasks: [] })),
          ]);

          memorySummaries[index] = {
            ...memorySummaries[index],
            memory: memResult,
            completedTaskCount: (doneResult?.tasks || []).length,
            failedTaskCount: (failedResult?.tasks || []).length,
            loading: false,
            error: null,
          };
        } catch (err) {
          memorySummaries[index] = {
            ...memorySummaries[index],
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load',
          };
        }
      }));

      loading = false;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load agents';
      loading = false;
    }
  }

  function toggleAgent(agentId: string) {
    selectedAgentId = selectedAgentId === agentId ? null : agentId;
  }

  onMount(() => {
    loadData();
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <span>🧠</span>
        HICMS Memory Dashboard
      </h1>
      <p class="text-sm text-slate-400 mt-1">
        Human-Inspired Cognitive Memory System — agent memory health across all 5 types
      </p>
    </div>
    <button
      on:click={loadData}
      class="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600"
    >
      Refresh
    </button>
  </div>

  <!-- Memory Type Legend -->
  <div class="grid grid-cols-5 gap-3">
    <div class="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg">
      <div class="text-xs font-medium text-orange-400 mb-1">🔧 Procedural</div>
      <div class="text-xs text-slate-400">Skills &amp; habits — SOUL.md, rules</div>
    </div>
    <div class="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
      <div class="text-xs font-medium text-blue-400 mb-1">📚 Semantic</div>
      <div class="text-xs text-slate-400">Learned facts — LEARNED.md, docs</div>
    </div>
    <div class="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
      <div class="text-xs font-medium text-green-400 mb-1">📖 Episodic</div>
      <div class="text-xs text-slate-400">Experience — completed tasks</div>
    </div>
    <div class="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
      <div class="text-xs font-medium text-yellow-400 mb-1">⚡ Short-term</div>
      <div class="text-xs text-slate-400">Active session — context window</div>
    </div>
    <div class="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
      <div class="text-xs font-medium text-purple-400 mb-1">🔮 Prospective</div>
      <div class="text-xs text-slate-400">Upcoming — dependencies, queue</div>
    </div>
  </div>

  {#if loading && memorySummaries.length === 0}
    <div class="flex items-center justify-center py-12">
      <div class="text-slate-400">Loading memory health data...</div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
      <p class="text-sm text-red-400">{error}</p>
    </div>
  {:else}
    <!-- Memory Health Overview Table -->
    <div class="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-700">
        <h2 class="text-lg font-semibold">Memory Health Overview</h2>
        <p class="text-xs text-slate-400 mt-0.5">All agents · Click a row to expand memory cards</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="text-xs font-medium text-slate-400 border-b border-slate-700">
              <th class="px-6 py-3 text-left">Agent</th>
              <th class="px-4 py-3 text-center text-orange-400">🔧 Procedural</th>
              <th class="px-4 py-3 text-center text-blue-400">📚 Semantic</th>
              <th class="px-4 py-3 text-center text-green-400">📖 Episodic</th>
              <th class="px-4 py-3 text-center text-yellow-400">⚡ Short-term</th>
              <th class="px-4 py-3 text-center text-purple-400">🔮 Prospective</th>
              <th class="px-4 py-3 text-center">📈 Learning Rate</th>
            </tr>
          </thead>
          <tbody>
            {#each memorySummaries as summary}
              {@const mem = summary.memory}
              {@const learnedEntries = mem ? countLearnedEntries(mem.semantic.learned) : 0}
              {@const learningRate = getLearningRate(summary.completedTaskCount, learnedEntries)}

              <tr
                class="border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors
                  {selectedAgentId === summary.agent.id ? 'bg-slate-700/40' : ''}"
                on:click={() => toggleAgent(summary.agent.id)}
              >
                <!-- Agent -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <span class="text-2xl">{summary.agent.emoji}</span>
                    <div>
                      <div class="font-medium">{summary.agent.name}</div>
                      <div class="text-xs text-slate-400">{summary.agent.id}</div>
                    </div>
                    {#if summary.loading}
                      <span class="text-xs text-slate-500 animate-pulse">loading...</span>
                    {/if}
                  </div>
                </td>

                <!-- Procedural -->
                <td class="px-4 py-4 text-center">
                  {#if summary.loading}
                    <span class="text-slate-500">—</span>
                  {:else if !mem}
                    <span class="text-red-400">✗</span>
                  {:else}
                    {@const pStatus = getProceduralStatus(mem)}
                    <div class="flex flex-col items-center gap-1">
                      <span class="{statusClass(pStatus)} text-sm font-medium">
                        {mem.procedural.role ? '✓ SOUL' : '✗ SOUL'}
                      </span>
                      <span class="text-xs text-slate-400">
                        {mem.procedural.activeRules.length} rules
                      </span>
                    </div>
                  {/if}
                </td>

                <!-- Semantic -->
                <td class="px-4 py-4 text-center">
                  {#if summary.loading}
                    <span class="text-slate-500">—</span>
                  {:else if !mem}
                    <span class="text-red-400">✗</span>
                  {:else}
                    <div class="flex flex-col items-center gap-1">
                      <span class="{learnedEntries > 0 ? 'text-blue-400' : 'text-slate-500'} text-sm font-medium">
                        {learnedEntries} entries
                      </span>
                      <span class="text-xs text-slate-400">
                        {mem.semantic.company.profile ? '✓ profile' : '✗ profile'}
                      </span>
                    </div>
                  {/if}
                </td>

                <!-- Episodic -->
                <td class="px-4 py-4 text-center">
                  {#if summary.loading}
                    <span class="text-slate-500">—</span>
                  {:else}
                    <div class="flex flex-col items-center gap-1">
                      <span class="{summary.completedTaskCount > 0 ? 'text-green-400' : 'text-slate-500'} text-sm font-medium">
                        {summary.completedTaskCount} done
                      </span>
                      {#if summary.failedTaskCount > 0}
                        <span class="text-xs text-red-400">
                          {summary.failedTaskCount} failed
                        </span>
                      {:else}
                        <span class="text-xs text-slate-500">0 failed</span>
                      {/if}
                    </div>
                  {/if}
                </td>

                <!-- Short-term -->
                <td class="px-4 py-4 text-center">
                  <div class="flex flex-col items-center gap-1">
                    {#if summary.agent.status === 'online'}
                      <span class="text-yellow-400 text-sm font-medium">🟡 Active</span>
                    {:else if summary.agent.status === 'idle'}
                      <span class="text-blue-400 text-sm font-medium">🔵 Idle</span>
                    {:else}
                      <span class="text-slate-500 text-sm">⚫ Offline</span>
                    {/if}
                    {#if summary.agent.activeSession}
                      <span class="text-xs text-slate-400">session active</span>
                    {/if}
                  </div>
                </td>

                <!-- Prospective -->
                <td class="px-4 py-4 text-center">
                  {#if summary.loading}
                    <span class="text-slate-500">—</span>
                  {:else if !mem}
                    <span class="text-slate-500">—</span>
                  {:else}
                    {@const pendingCount = mem.prospective.pendingDependencies.length}
                    {@const upcomingCount = mem.prospective.upcoming.length}
                    <div class="flex flex-col items-center gap-1">
                      {#if pendingCount > 0}
                        <span class="text-purple-400 text-sm font-medium">{pendingCount} blocked</span>
                      {:else}
                        <span class="text-slate-500 text-sm">0 blocked</span>
                      {/if}
                      {#if upcomingCount > 0}
                        <span class="text-xs text-slate-400">{upcomingCount} upcoming</span>
                      {/if}
                    </div>
                  {/if}
                </td>

                <!-- Learning Rate -->
                <td class="px-4 py-4 text-center">
                  {#if summary.loading}
                    <span class="text-slate-500">—</span>
                  {:else}
                    <div class="flex flex-col items-center gap-1">
                      <span class="{learningRateColor(learningRate)} text-lg font-bold">
                        {learningRate}%
                      </span>
                      <div class="w-16 bg-slate-700 rounded-full h-1.5">
                        <div
                          class="h-1.5 rounded-full {learningRate >= 50 ? 'bg-green-500' : learningRate >= 20 ? 'bg-yellow-500' : learningRate > 0 ? 'bg-orange-500' : 'bg-slate-600'}"
                          style="width: {learningRate}%"
                        ></div>
                      </div>
                    </div>
                  {/if}
                </td>
              </tr>

              <!-- Expanded Memory Card -->
              {#if selectedAgentId === summary.agent.id && mem}
                <tr>
                  <td colspan="7" class="px-6 py-4 bg-slate-900/50">
                    <div class="space-y-4">
                      <h3 class="text-sm font-semibold text-slate-300 flex items-center gap-2">
                        <span>{summary.agent.emoji}</span>
                        {summary.agent.name} — Detailed Memory View
                      </h3>

                      <div class="grid grid-cols-5 gap-3">
                        <!-- Procedural Memory Card -->
                        <div class="p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                          <div class="flex items-center gap-2 mb-3">
                            <span class="text-orange-400 font-semibold text-sm">🔧 Procedural</span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">SOUL.md</span>
                              <span class="{mem.procedural.role ? 'text-green-400' : 'text-red-400'} font-medium">
                                {mem.procedural.role ? '✓' : '✗ missing'}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">AGENTS.md</span>
                              <span class="{mem.procedural.rules ? 'text-green-400' : 'text-red-400'} font-medium">
                                {mem.procedural.rules ? '✓' : '✗ missing'}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Active Rules</span>
                              <span class="text-orange-400 font-medium">{mem.procedural.activeRules.length}</span>
                            </div>
                            {#if mem.procedural.activeRules.length > 0}
                              <div class="mt-2 pt-2 border-t border-orange-500/10">
                                {#each mem.procedural.activeRules.slice(0, 3) as rule}
                                  <div class="text-slate-500 truncate" title={rule.name}>• {rule.name}</div>
                                {/each}
                                {#if mem.procedural.activeRules.length > 3}
                                  <div class="text-slate-600">+{mem.procedural.activeRules.length - 3} more</div>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        </div>

                        <!-- Semantic Memory Card -->
                        <div class="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                          <div class="flex items-center gap-2 mb-3">
                            <span class="text-blue-400 font-semibold text-sm">📚 Semantic</span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">LEARNED.md</span>
                              <span class="{countLearnedEntries(mem.semantic.learned) > 0 ? 'text-blue-400' : 'text-slate-500'} font-medium">
                                {countLearnedEntries(mem.semantic.learned)} entries
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Last updated</span>
                              <span class="text-slate-300">{formatDate(getLearnedLastUpdated(mem.semantic.learned))}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Company profile</span>
                              <span class="{mem.semantic.company.profile ? 'text-green-400' : 'text-slate-500'} font-medium">
                                {mem.semantic.company.profile ? '✓ loaded' : '✗ none'}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Training docs</span>
                              <span class="{mem.semantic.agentTraining ? 'text-green-400' : 'text-slate-500'} font-medium">
                                {mem.semantic.agentTraining ? '✓' : '—'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <!-- Episodic Memory Card -->
                        <div class="p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
                          <div class="flex items-center gap-2 mb-3">
                            <span class="text-green-400 font-semibold text-sm">📖 Episodic</span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">Completed tasks</span>
                              <span class="text-green-400 font-medium">{summary.completedTaskCount}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Failed tasks</span>
                              <span class="{summary.failedTaskCount > 0 ? 'text-red-400' : 'text-slate-500'} font-medium">
                                {summary.failedTaskCount}
                              </span>
                            </div>
                            {#if mem.episodic.myRecentTasks.length > 0}
                              <div class="mt-2 pt-2 border-t border-green-500/10">
                                <div class="text-slate-500 mb-1">Recent:</div>
                                {#each mem.episodic.myRecentTasks.slice(0, 3) as task}
                                  <div class="text-slate-400 truncate" title={task.title}>• {task.title}</div>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        </div>

                        <!-- Short-term Memory Card -->
                        <div class="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
                          <div class="flex items-center gap-2 mb-3">
                            <span class="text-yellow-400 font-semibold text-sm">⚡ Short-term</span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">Status</span>
                              <span class="
                                {summary.agent.status === 'online' ? 'text-yellow-400' : 
                                 summary.agent.status === 'idle' ? 'text-blue-400' : 'text-slate-500'}
                                font-medium capitalize"
                              >
                                {summary.agent.status === 'online' ? 'Active' : 
                                 summary.agent.status === 'idle' ? 'Idle' : 'Offline'}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Session</span>
                              <span class="{summary.agent.activeSession ? 'text-yellow-400' : 'text-slate-500'} font-medium">
                                {summary.agent.activeSession ? 'Active' : 'None'}
                              </span>
                            </div>
                            <div class="mt-2 pt-2 border-t border-yellow-500/10">
                              <div class="text-slate-500 text-xs italic">
                                Context window is ephemeral — cleared between sessions
                              </div>
                            </div>
                          </div>
                        </div>

                        <!-- Prospective Memory Card -->
                        <div class="p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                          <div class="flex items-center gap-2 mb-3">
                            <span class="text-purple-400 font-semibold text-sm">🔮 Prospective</span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">Blocked tasks</span>
                              <span class="{mem.prospective.pendingDependencies.length > 0 ? 'text-purple-400' : 'text-slate-500'} font-medium">
                                {mem.prospective.pendingDependencies.length}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Upcoming</span>
                              <span class="text-slate-300 font-medium">
                                {mem.prospective.upcoming.length}
                              </span>
                            </div>
                            {#if mem.prospective.upcoming.length > 0}
                              <div class="mt-2 pt-2 border-t border-purple-500/10">
                                {#each mem.prospective.upcoming.slice(0, 3) as task}
                                  <div class="text-slate-400 truncate flex items-center gap-1" title={task.title}>
                                    <span class="text-purple-500">[{task.priority}]</span>
                                    <span>{task.title}</span>
                                  </div>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        </div>
                      </div>

                      <!-- Learning Rate Bar -->
                      {#if true}
                        {@const lr = getLearningRate(summary.completedTaskCount, countLearnedEntries(mem.semantic.learned))}
                        <div class="p-4 bg-slate-800 border border-slate-600 rounded-lg">
                          <div class="flex items-center justify-between mb-2">
                            <span class="text-sm font-medium text-slate-300">📈 Learning Rate</span>
                            <span class="{learningRateColor(lr)} text-xl font-bold">{lr}%</span>
                          </div>
                          <div class="w-full bg-slate-700 rounded-full h-2 mb-2">
                            <div
                              class="h-2 rounded-full transition-all {lr >= 50 ? 'bg-green-500' : lr >= 20 ? 'bg-yellow-500' : lr > 0 ? 'bg-orange-500' : 'bg-slate-600'}"
                              style="width: {lr}%"
                            ></div>
                          </div>
                          <p class="text-xs text-slate-400">
                            {countLearnedEntries(mem.semantic.learned)} LEARNED.md entries ÷ {summary.completedTaskCount} completed tasks
                            {#if lr === 0 && summary.completedTaskCount > 0}
                              · <span class="text-orange-400">⚠ No learnings recorded — update LEARNED.md after tasks</span>
                            {:else if lr === 0 && summary.completedTaskCount === 0}
                              · <span class="text-slate-500">No tasks completed yet</span>
                            {:else if lr >= 50}
                              · <span class="text-green-400">✓ Healthy learning rate</span>
                            {:else if lr >= 20}
                              · <span class="text-yellow-400">Could be higher — capture more learnings</span>
                            {/if}
                          </p>
                        </div>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Summary Stats -->
    {#if memorySummaries.length > 0}
      {@const totalDone = memorySummaries.reduce((sum, s) => sum + s.completedTaskCount, 0)}
      {@const activeAgents = memorySummaries.filter(s => s.agent.status === 'online').length}
      {@const healthyProcedural = memorySummaries.filter(s => s.memory?.procedural.role).length}
      {@const avgLearning = memorySummaries.length > 0
        ? Math.round(memorySummaries.reduce((sum, s) => {
            const entries = s.memory ? countLearnedEntries(s.memory.semantic.learned) : 0;
            return sum + getLearningRate(s.completedTaskCount, entries);
          }, 0) / memorySummaries.length)
        : 0}

      <div class="grid grid-cols-4 gap-4">
        <div class="p-4 bg-slate-800 border border-slate-700 rounded-lg">
          <div class="text-2xl font-bold text-white">{memorySummaries.length}</div>
          <div class="text-sm text-slate-400">Total Agents</div>
        </div>
        <div class="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <div class="text-2xl font-bold text-green-400">{activeAgents}</div>
          <div class="text-sm text-green-500">Active Now</div>
        </div>
        <div class="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <div class="text-2xl font-bold text-blue-400">{totalDone}</div>
          <div class="text-sm text-blue-500">Tasks Completed</div>
        </div>
        <div class="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <div class="text-2xl font-bold text-purple-400">{avgLearning}%</div>
          <div class="text-sm text-purple-500">Avg Learning Rate</div>
        </div>
      </div>
    {/if}

    <!-- HICMS Legend -->
    <div class="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
      <h3 class="text-sm font-semibold text-slate-300 mb-3">📊 Status Legend</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div class="flex items-center gap-2">
          <span>🟢</span><span class="text-slate-300">Healthy — all files present, data populated</span>
        </div>
        <div class="flex items-center gap-2">
          <span>🟡</span><span class="text-slate-300">Active / Warning — session running or low data</span>
        </div>
        <div class="flex items-center gap-2">
          <span>🔴</span><span class="text-slate-300">Error — required files missing</span>
        </div>
        <div class="flex items-center gap-2">
          <span>⚪</span><span class="text-slate-300">Empty — no data yet</span>
        </div>
      </div>
      <div class="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-400">
        <strong class="text-slate-300">Learning Rate</strong> = LEARNED.md entries ÷ completed tasks × 100.
        Higher = agent is capturing lessons and getting smarter over time.
        Target: &gt;50% is healthy.
      </div>
    </div>
  {/if}
</div>
