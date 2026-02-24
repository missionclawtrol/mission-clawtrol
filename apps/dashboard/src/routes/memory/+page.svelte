<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';

  interface AgentMemoryHealth {
    agentId: string;
    name: string;
    emoji: string;
    procedural: {
      soulExists: boolean;
      agentsMdExists: boolean;
      activeRulesCount: number;
      healthy: boolean;
    };
    semantic: {
      learnedEntries: number;
      learnedLastUpdated: string | null;
      companyLoaded: boolean;
      healthy: boolean;
    };
    episodic: {
      completedCount: number;
      failedCount: number;
      healthy: boolean;
    };
    shortTerm: {
      sessionStatus: 'active' | 'idle' | 'offline';
      tokenEstimate: number | null;
      healthy: boolean;
    };
    prospective: {
      pendingCount: number;
      scheduledCount: number;
      healthy: boolean;
    };
    learningRate: number;
  }

  interface OverviewResult {
    agents: AgentMemoryHealth[];
    assembledAt: string;
  }

  let agents: AgentMemoryHealth[] = [];
  let assembledAt: string | null = null;
  let loading = true;
  let error: string | null = null;
  let selectedAgentId: string | null = null;

  // Summary stats
  $: totalAgents = agents.length;
  $: activeAgents = agents.filter(a => a.shortTerm.sessionStatus === 'active').length;
  $: totalCompleted = agents.reduce((sum, a) => sum + a.episodic.completedCount, 0);
  $: avgLearningRate = agents.length > 0
    ? Math.round(agents.reduce((sum, a) => sum + a.learningRate, 0) / agents.length)
    : 0;

  // --- Helpers ---

  function statusDotClass(healthy: boolean | null, type?: string): string {
    if (type === 'session') {
      // Use session-specific coloring
      return '';
    }
    if (healthy === null) return 'text-slate-500';
    return healthy ? 'text-green-400' : 'text-red-400';
  }

  function learningRateColor(rate: number): string {
    if (rate >= 50) return 'text-green-400';
    if (rate >= 20) return 'text-yellow-400';
    if (rate > 0) return 'text-orange-400';
    return 'text-slate-500';
  }

  function learningRateBg(rate: number): string {
    if (rate >= 50) return 'bg-green-500';
    if (rate >= 20) return 'bg-yellow-500';
    if (rate > 0) return 'bg-orange-500';
    return 'bg-slate-600';
  }

  function sessionStatusLabel(status: string): string {
    switch (status) {
      case 'active': return '🟡 Active';
      case 'idle': return '🔵 Idle';
      case 'offline': return '⚫ Offline';
      default: return '⚪ Unknown';
    }
  }

  function sessionStatusClass(status: string): string {
    switch (status) {
      case 'active': return 'text-yellow-400';
      case 'idle': return 'text-blue-400';
      case 'offline': return 'text-slate-500';
      default: return 'text-slate-500';
    }
  }

  function formatTimestamp(ts: string | null): string {
    if (!ts) return 'never';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // --- Data Loading ---
  async function loadData() {
    try {
      loading = true;
      error = null;
      const result: OverviewResult = await api.get('/agent/overview');
      agents = result.agents || [];
      assembledAt = result.assembledAt || null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load memory health';
      console.error('Memory dashboard load error:', err);
    } finally {
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
        {#if assembledAt}
          · <span class="text-slate-500">Updated {formatTimestamp(assembledAt)}</span>
        {/if}
      </p>
    </div>
    <button
      on:click={loadData}
      disabled={loading}
      class="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600 disabled:opacity-50"
    >
      {loading ? 'Loading...' : 'Refresh'}
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

  {#if loading && agents.length === 0}
    <div class="flex items-center justify-center py-16">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-3"></div>
        <div class="text-slate-400">Loading memory health data...</div>
      </div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
      <p class="text-sm text-red-400">⚠ {error}</p>
    </div>
  {:else if agents.length === 0}
    <div class="p-8 text-center bg-slate-800/50 rounded-lg">
      <p class="text-slate-400">No agents configured</p>
    </div>
  {:else}
    <!-- Memory Health Overview Table -->
    <div class="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">Memory Health Overview</h2>
          <p class="text-xs text-slate-400 mt-0.5">All agents · Click a row to expand details</p>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="text-xs font-medium text-slate-400 border-b border-slate-700 bg-slate-800/80">
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
            {#each agents as agent (agent.agentId)}
              <tr
                class="border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors
                  {selectedAgentId === agent.agentId ? 'bg-slate-700/40 border-l-2 border-l-blue-500' : ''}"
                on:click={() => toggleAgent(agent.agentId)}
              >
                <!-- Agent -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <span class="text-2xl">{agent.emoji}</span>
                    <div>
                      <div class="font-medium">{agent.name || agent.agentId}</div>
                      <div class="text-xs text-slate-400 font-mono">{agent.agentId}</div>
                    </div>
                    <span class="text-xs text-slate-500 ml-auto">
                      {selectedAgentId === agent.agentId ? '▲' : '▼'}
                    </span>
                  </div>
                </td>

                <!-- Procedural -->
                <td class="px-4 py-4 text-center">
                  <div class="flex flex-col items-center gap-1">
                    <span class="{agent.procedural.healthy ? 'text-green-400' : 'text-red-400'} text-sm font-medium">
                      {agent.procedural.soulExists ? '✓' : '✗'} SOUL
                    </span>
                    <span class="text-xs text-slate-400">
                      {agent.procedural.activeRulesCount} rules
                    </span>
                  </div>
                </td>

                <!-- Semantic -->
                <td class="px-4 py-4 text-center">
                  <div class="flex flex-col items-center gap-1">
                    <span class="{agent.semantic.learnedEntries > 0 ? 'text-blue-400' : 'text-slate-500'} text-sm font-medium">
                      {agent.semantic.learnedEntries} entries
                    </span>
                    <span class="text-xs {agent.semantic.companyLoaded ? 'text-slate-400' : 'text-slate-600'}">
                      {agent.semantic.companyLoaded ? '✓ profile' : '✗ profile'}
                    </span>
                  </div>
                </td>

                <!-- Episodic -->
                <td class="px-4 py-4 text-center">
                  <div class="flex flex-col items-center gap-1">
                    <span class="{agent.episodic.completedCount > 0 ? 'text-green-400' : 'text-slate-500'} text-sm font-medium">
                      {agent.episodic.completedCount} done
                    </span>
                    {#if agent.episodic.failedCount > 0}
                      <span class="text-xs text-red-400">{agent.episodic.failedCount} failed</span>
                    {:else}
                      <span class="text-xs text-slate-600">0 failed</span>
                    {/if}
                  </div>
                </td>

                <!-- Short-term -->
                <td class="px-4 py-4 text-center">
                  <div class="flex flex-col items-center gap-1">
                    <span class="{sessionStatusClass(agent.shortTerm.sessionStatus)} text-sm font-medium">
                      {sessionStatusLabel(agent.shortTerm.sessionStatus)}
                    </span>
                    {#if agent.shortTerm.tokenEstimate}
                      <span class="text-xs text-slate-400">~{agent.shortTerm.tokenEstimate.toLocaleString()} tok</span>
                    {/if}
                  </div>
                </td>

                <!-- Prospective -->
                <td class="px-4 py-4 text-center">
                  <div class="flex flex-col items-center gap-1">
                    {#if agent.prospective.pendingCount > 0}
                      <span class="text-red-400 text-sm font-medium">{agent.prospective.pendingCount} blocked</span>
                    {:else}
                      <span class="text-slate-500 text-sm">0 blocked</span>
                    {/if}
                    {#if agent.prospective.scheduledCount > 0}
                      <span class="text-xs text-purple-400">{agent.prospective.scheduledCount} queued</span>
                    {:else}
                      <span class="text-xs text-slate-600">0 queued</span>
                    {/if}
                  </div>
                </td>

                <!-- Learning Rate -->
                <td class="px-4 py-4 text-center">
                  <div class="flex flex-col items-center gap-1">
                    <span class="{learningRateColor(agent.learningRate)} text-lg font-bold">
                      {agent.learningRate}%
                    </span>
                    <div class="w-16 bg-slate-700 rounded-full h-1.5">
                      <div
                        class="h-1.5 rounded-full {learningRateBg(agent.learningRate)}"
                        style="width: {agent.learningRate}%"
                      ></div>
                    </div>
                  </div>
                </td>
              </tr>

              <!-- Expanded Detail Row -->
              {#if selectedAgentId === agent.agentId}
                <tr>
                  <td colspan="7" class="bg-slate-900/60 border-b border-slate-700">
                    <div class="px-6 py-5 space-y-4">
                      <h3 class="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <span>{agent.emoji}</span>
                        {agent.name || agent.agentId} — Memory Detail
                      </h3>

                      <!-- 5-column memory cards -->
                      <div class="grid grid-cols-5 gap-3">

                        <!-- Procedural Card -->
                        <div class="p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                          <div class="text-orange-400 font-semibold text-sm mb-3 flex items-center gap-1.5">
                            🔧 Procedural
                            <span class="ml-auto text-xs px-1.5 py-0.5 rounded-full {agent.procedural.healthy ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                              {agent.procedural.healthy ? 'healthy' : 'issues'}
                            </span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">SOUL.md</span>
                              <span class="{agent.procedural.soulExists ? 'text-green-400' : 'text-red-400'} font-medium">
                                {agent.procedural.soulExists ? '✓ exists' : '✗ missing'}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">AGENTS.md</span>
                              <span class="{agent.procedural.agentsMdExists ? 'text-green-400' : 'text-yellow-400'} font-medium">
                                {agent.procedural.agentsMdExists ? '✓ exists' : '✗ missing'}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Active rules</span>
                              <span class="text-orange-400 font-medium">{agent.procedural.activeRulesCount}</span>
                            </div>
                          </div>
                        </div>

                        <!-- Semantic Card -->
                        <div class="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                          <div class="text-blue-400 font-semibold text-sm mb-3 flex items-center gap-1.5">
                            📚 Semantic
                            <span class="ml-auto text-xs px-1.5 py-0.5 rounded-full {agent.semantic.healthy ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}">
                              {agent.semantic.learnedEntries > 0 ? 'populated' : 'empty'}
                            </span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">LEARNED.md</span>
                              <span class="{agent.semantic.learnedEntries > 0 ? 'text-blue-400' : 'text-slate-500'} font-medium">
                                {agent.semantic.learnedEntries} entries
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Last updated</span>
                              <span class="text-slate-300">{formatTimestamp(agent.semantic.learnedLastUpdated)}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Company profile</span>
                              <span class="{agent.semantic.companyLoaded ? 'text-green-400' : 'text-slate-500'} font-medium">
                                {agent.semantic.companyLoaded ? '✓ loaded' : '✗ missing'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <!-- Episodic Card -->
                        <div class="p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
                          <div class="text-green-400 font-semibold text-sm mb-3 flex items-center gap-1.5">
                            📖 Episodic
                            <span class="ml-auto text-xs px-1.5 py-0.5 rounded-full {agent.episodic.healthy ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}">
                              {agent.episodic.completedCount > 0 ? 'experienced' : 'new'}
                            </span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">Tasks done</span>
                              <span class="{agent.episodic.completedCount > 0 ? 'text-green-400' : 'text-slate-500'} font-medium">
                                {agent.episodic.completedCount}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Tasks failed</span>
                              <span class="{agent.episodic.failedCount > 0 ? 'text-red-400' : 'text-slate-500'} font-medium">
                                {agent.episodic.failedCount}
                              </span>
                            </div>
                            {#if agent.episodic.completedCount > 0}
                              <div class="flex justify-between">
                                <span class="text-slate-400">Success rate</span>
                                <span class="text-green-400 font-medium">
                                  {Math.round(agent.episodic.completedCount / (agent.episodic.completedCount + agent.episodic.failedCount) * 100)}%
                                </span>
                              </div>
                            {/if}
                          </div>
                        </div>

                        <!-- Short-term Card -->
                        <div class="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
                          <div class="text-yellow-400 font-semibold text-sm mb-3 flex items-center gap-1.5">
                            ⚡ Short-term
                            <span class="ml-auto text-xs px-1.5 py-0.5 rounded-full
                              {agent.shortTerm.sessionStatus === 'active' ? 'bg-yellow-500/20 text-yellow-400' :
                               agent.shortTerm.sessionStatus === 'idle' ? 'bg-blue-500/20 text-blue-400' :
                               'bg-slate-500/20 text-slate-400'}">
                              {agent.shortTerm.sessionStatus}
                            </span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">Session</span>
                              <span class="{sessionStatusClass(agent.shortTerm.sessionStatus)} font-medium">
                                {sessionStatusLabel(agent.shortTerm.sessionStatus)}
                              </span>
                            </div>
                            {#if agent.shortTerm.tokenEstimate}
                              <div class="flex justify-between">
                                <span class="text-slate-400">Token estimate</span>
                                <span class="text-yellow-400">{agent.shortTerm.tokenEstimate.toLocaleString()}</span>
                              </div>
                            {/if}
                            <div class="mt-2 pt-2 border-t border-yellow-500/10 text-slate-500 italic">
                              Ephemeral — cleared between sessions
                            </div>
                          </div>
                        </div>

                        <!-- Prospective Card -->
                        <div class="p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                          <div class="text-purple-400 font-semibold text-sm mb-3 flex items-center gap-1.5">
                            🔮 Prospective
                            <span class="ml-auto text-xs px-1.5 py-0.5 rounded-full {agent.prospective.healthy ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                              {agent.prospective.pendingCount === 0 ? 'clear' : 'blocked'}
                            </span>
                          </div>
                          <div class="space-y-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-slate-400">Blocked tasks</span>
                              <span class="{agent.prospective.pendingCount > 0 ? 'text-red-400' : 'text-slate-500'} font-medium">
                                {agent.prospective.pendingCount}
                              </span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-slate-400">Queued tasks</span>
                              <span class="{agent.prospective.scheduledCount > 0 ? 'text-purple-400' : 'text-slate-500'} font-medium">
                                {agent.prospective.scheduledCount}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <!-- Learning Rate Bar -->
                      <div class="p-4 bg-slate-800 border border-slate-600 rounded-lg">
                        <div class="flex items-center justify-between mb-3">
                          <div>
                            <span class="text-sm font-semibold text-slate-200">📈 Learning Rate</span>
                            <p class="text-xs text-slate-400 mt-0.5">
                              LEARNED.md entries ÷ completed tasks × 100
                            </p>
                          </div>
                          <span class="{learningRateColor(agent.learningRate)} text-3xl font-bold">
                            {agent.learningRate}%
                          </span>
                        </div>
                        <div class="w-full bg-slate-700 rounded-full h-3 mb-3">
                          <div
                            class="h-3 rounded-full transition-all duration-500 {learningRateBg(agent.learningRate)}"
                            style="width: {agent.learningRate}%"
                          ></div>
                        </div>
                        <div class="flex items-center justify-between text-xs text-slate-400">
                          <span>{agent.semantic.learnedEntries} LEARNED.md entries</span>
                          <span>÷</span>
                          <span>{agent.episodic.completedCount} completed tasks</span>
                          <span>=</span>
                          <span class="{learningRateColor(agent.learningRate)} font-medium">{agent.learningRate}%</span>
                        </div>
                        {#if agent.learningRate === 0 && agent.episodic.completedCount > 0}
                          <div class="mt-3 p-2 bg-orange-500/10 border border-orange-500/20 rounded text-xs text-orange-400">
                            ⚠ No learnings recorded — update LEARNED.md after tasks to track knowledge growth
                          </div>
                        {:else if agent.learningRate >= 50}
                          <div class="mt-3 p-2 bg-green-500/10 border border-green-500/20 rounded text-xs text-green-400">
                            ✓ Healthy learning rate — this agent is consistently capturing new knowledge
                          </div>
                        {:else if agent.learningRate > 0 && agent.learningRate < 20}
                          <div class="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-400">
                            ↑ Room to improve — encourage LEARNED.md updates after each task completion
                          </div>
                        {/if}
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Summary Stats Bar -->
    <div class="grid grid-cols-4 gap-4">
      <div class="p-4 bg-slate-800 border border-slate-700 rounded-lg text-center">
        <div class="text-3xl font-bold text-white">{totalAgents}</div>
        <div class="text-sm text-slate-400 mt-1">Total Agents</div>
      </div>
      <div class="p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
        <div class="text-3xl font-bold text-green-400">{activeAgents}</div>
        <div class="text-sm text-green-500 mt-1">Active Now</div>
      </div>
      <div class="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg text-center">
        <div class="text-3xl font-bold text-blue-400">{totalCompleted}</div>
        <div class="text-sm text-blue-500 mt-1">Tasks Completed</div>
      </div>
      <div class="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg text-center">
        <div class="text-3xl font-bold {learningRateColor(avgLearningRate)}">{avgLearningRate}%</div>
        <div class="text-sm text-purple-500 mt-1">Avg Learning Rate</div>
      </div>
    </div>

    <!-- Legend -->
    <div class="p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
      <h3 class="text-sm font-semibold text-slate-300 mb-3">📖 How to Read This Dashboard</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400">
        <div>
          <p class="font-medium text-slate-300 mb-1">Memory Types</p>
          <ul class="space-y-1">
            <li><span class="text-orange-400">🔧 Procedural</span> — Identity (SOUL.md) + operating rules (AGENTS.md) + workflow rules engine</li>
            <li><span class="text-blue-400">📚 Semantic</span> — Accumulated knowledge: LEARNED.md entries, company profile, project docs</li>
            <li><span class="text-green-400">📖 Episodic</span> — Task history: completed work, failures, project experience</li>
            <li><span class="text-yellow-400">⚡ Short-term</span> — Active context window (ephemeral, lost on session end)</li>
            <li><span class="text-purple-400">🔮 Prospective</span> — Future-oriented: blocked tasks, queued work</li>
          </ul>
        </div>
        <div>
          <p class="font-medium text-slate-300 mb-1">Learning Rate</p>
          <p class="mb-2">Learning Rate = LEARNED.md entries ÷ completed tasks × 100</p>
          <ul class="space-y-1">
            <li><span class="text-green-400">≥ 50%</span> — Healthy: agent captures lessons consistently</li>
            <li><span class="text-yellow-400">20–49%</span> — Moderate: some lessons captured</li>
            <li><span class="text-orange-400">1–19%</span> — Low: rarely updates LEARNED.md</li>
            <li><span class="text-slate-500">0%</span> — Empty: no learnings recorded yet</li>
          </ul>
          <p class="mt-2 text-slate-500 italic">Higher = agent gets smarter over time. Target: &gt;50%</p>
        </div>
      </div>
    </div>
  {/if}
</div>
