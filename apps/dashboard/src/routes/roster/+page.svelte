<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, fetchSetupStatus, createMinimumAgents, fetchAgentsConfig, createAgentConfig, updateAgentConfig, deleteAgentConfig, type SetupStatus } from '$lib/api';

  interface RosterAgent {
    id: string;
    name: string;
    emoji: string;
    fullName: string;
    model: string | { primary?: string };
    workspace: string;
    agentDir: string;
    status: 'online' | 'idle' | 'offline';
    lastActive: string | null;
    activeSession: string | null;
    mentionPatterns: string[];
  }

  let agents: RosterAgent[] = [];
  let loading = true;
  let error: string | null = null;
  let refreshInterval: number;

  // Setup / onboarding state
  let setupStatus: SetupStatus | null = null;
  let creatingMinimumAgents = false;
  let minAgentsError: string | null = null;

  // Modal state — Details & Message
  let showDetailsModal = false;
  let showMessageModal = false;
  let selectedAgent: RosterAgent | null = null;
  let messageText = '';
  let sendingMessage = false;
  let messageError: string | null = null;
  let messageSuccess = false;

  // Add / Edit agent modal
  let showAgentModal = false;
  let agentModalMode: 'add' | 'edit' = 'add';
  let agentForm = { id: '', name: '', model: '', workspace: '' };
  let agentModalError: string | null = null;
  let savingAgent = false;

  // Delete confirm
  let showDeleteConfirm = false;
  let deletingAgentId: string | null = null;
  let deletingAgentName: string = '';
  let deleting = false;

  const AVAILABLE_MODELS = [
    'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-haiku-4-5',
    'anthropic/claude-haiku-3-5',
    'minimax/MiniMax-M2.5',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
  ];

  async function loadRoster() {
    try {
      const result = await api.get('/agents/roster');
      agents = result.agents || [];
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load roster';
      console.error('Failed to load roster:', err);
    } finally {
      loading = false;
    }
  }

  async function loadSetupStatus() {
    setupStatus = await fetchSetupStatus();
  }

  async function handleCreateMinimumAgents() {
    creatingMinimumAgents = true;
    minAgentsError = null;
    try {
      await createMinimumAgents();
      await Promise.all([loadRoster(), loadSetupStatus()]);
    } catch (err) {
      minAgentsError = err instanceof Error ? err.message : 'Failed to create agents';
    } finally {
      creatingMinimumAgents = false;
    }
  }

  function openAddModal() {
    agentModalMode = 'add';
    agentForm = { id: '', name: '', model: 'anthropic/claude-haiku-4-5', workspace: '' };
    agentModalError = null;
    showAgentModal = true;
  }

  function openEditModal(agent: RosterAgent) {
    agentModalMode = 'edit';
    agentForm = {
      id: agent.id,
      name: agent.name || '',
      model: (typeof agent.model === 'object' ? agent.model?.primary : agent.model) || '',
      workspace: agent.workspace || '',
    };
    agentModalError = null;
    showAgentModal = true;
  }

  function closeAgentModal() {
    showAgentModal = false;
    agentModalError = null;
  }

  async function saveAgent() {
    agentModalError = null;
    if (!agentForm.id.trim()) { agentModalError = 'Agent ID is required'; return; }
    if (!agentForm.model.trim()) { agentModalError = 'Model is required'; return; }
    if (!agentForm.workspace.trim()) { agentModalError = 'Workspace path is required'; return; }

    savingAgent = true;
    try {
      if (agentModalMode === 'add') {
        await createAgentConfig({
          id: agentForm.id.trim(),
          name: agentForm.name.trim() || undefined,
          model: agentForm.model.trim(),
          workspace: agentForm.workspace.trim(),
        });
      } else {
        await updateAgentConfig(agentForm.id, {
          name: agentForm.name.trim() || undefined,
          model: agentForm.model.trim(),
          workspace: agentForm.workspace.trim(),
        });
      }
      closeAgentModal();
      await Promise.all([loadRoster(), loadSetupStatus()]);
    } catch (err) {
      agentModalError = err instanceof Error ? err.message : 'Failed to save agent';
    } finally {
      savingAgent = false;
    }
  }

  function confirmDelete(agent: RosterAgent) {
    deletingAgentId = agent.id;
    deletingAgentName = agent.name || agent.id;
    showDeleteConfirm = true;
  }

  function cancelDelete() {
    showDeleteConfirm = false;
    deletingAgentId = null;
  }

  async function doDelete() {
    if (!deletingAgentId) return;
    deleting = true;
    try {
      await deleteAgentConfig(deletingAgentId);
      showDeleteConfirm = false;
      deletingAgentId = null;
      await Promise.all([loadRoster(), loadSetupStatus()]);
    } catch (err) {
      console.error('Failed to delete agent:', err);
    } finally {
      deleting = false;
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'idle': return 'text-yellow-500';
      case 'offline': return 'text-gray-400';
      default: return 'text-gray-400';
    }
  }

  function getStatusBadge(status: string): string {
    switch (status) {
      case 'online': return 'bg-green-100 text-green-800';
      case 'idle': return 'bg-yellow-100 text-yellow-800';
      case 'offline': return 'bg-gray-100 text-gray-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  function formatStatusLabel(status: string): string {
    switch (status) {
      case 'online': return 'Active';
      case 'idle': return 'Idle';
      case 'offline': return 'Inactive';
      default: return status;
    }
  }

  function formatTime(timestamp: string | null, status?: string): string {
    if (status === 'online') return 'Active now';
    if (!timestamp) return 'No completed tasks yet';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }

  function formatModelName(model: string | { primary?: string } | undefined): string {
    const m = typeof model === 'object' && model ? (model.primary || '') : (model || '');
    if (!m) return 'Unknown';
    const lowerModel = m.toLowerCase();
    if (lowerModel.includes('opus')) { const v = m.match(/[\d.]+/)?.[0] || ''; return v ? `Opus ${v}` : 'Opus'; }
    if (lowerModel.includes('sonnet')) { const v = m.match(/[\d.]+/)?.[0] || ''; return v ? `Sonnet ${v}` : 'Sonnet'; }
    if (lowerModel.includes('haiku')) { const v = m.match(/[\d.]+/)?.[0] || ''; return v ? `Haiku ${v}` : 'Haiku'; }
    if (lowerModel.includes('minimax')) return 'MiniMax M2.5';
    if (lowerModel.includes('gpt-4')) return 'GPT-4';
    if (lowerModel.includes('qwen')) { const v = m.match(/[\d.]+/)?.[0] || ''; return v ? `Qwen ${v}` : 'Qwen'; }
    return m.split('/').pop() || m;
  }

  function openDetails(agent: RosterAgent) {
    selectedAgent = agent;
    showDetailsModal = true;
  }

  function closeDetails() {
    showDetailsModal = false;
    selectedAgent = null;
  }

  function openMessage(agent: RosterAgent) {
    selectedAgent = agent;
    messageText = '';
    messageError = null;
    messageSuccess = false;
    showMessageModal = true;
  }

  function closeMessage() {
    showMessageModal = false;
    selectedAgent = null;
    messageText = '';
  }

  async function sendMessage() {
    if (!selectedAgent || !messageText.trim()) return;
    sendingMessage = true;
    messageError = null;
    messageSuccess = false;
    try {
      const sessionKey = `agent:${selectedAgent.id}:main`;
      await api.post(`/agents/${encodeURIComponent(sessionKey)}/message`, {
        message: messageText.trim()
      });
      messageSuccess = true;
      messageText = '';
      setTimeout(() => {
        closeMessage();
        loadRoster();
      }, 1500);
    } catch (err) {
      messageError = err instanceof Error ? err.message : 'Failed to send message';
    } finally {
      sendingMessage = false;
    }
  }

  onMount(() => {
    loadRoster();
    loadSetupStatus();
    refreshInterval = setInterval(loadRoster, 10000) as any;
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Agent Roster</h1>
    <div class="flex gap-3">
      <button
        on:click={loadRoster}
        class="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600"
      >
        Refresh
      </button>
      <button
        on:click={openAddModal}
        class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
      >
        + Add Agent
      </button>
    </div>
  </div>

  <!-- Minimum Agents Banner -->
  {#if setupStatus && setupStatus.partialAgents < setupStatus.totalAgents}
    <div class="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between gap-4">
      <div>
        <p class="font-medium text-amber-400">⚠️ Missing team members</p>
        <p class="text-sm text-slate-400 mt-1">
          Your team is incomplete ({setupStatus.partialAgents}/{setupStatus.totalAgents} agents). Click "Create Team" to set up the full roster.
        </p>
        {#if minAgentsError}
          <p class="text-sm text-red-400 mt-1">{minAgentsError}</p>
        {/if}
      </div>
      <button
        on:click={handleCreateMinimumAgents}
        disabled={creatingMinimumAgents}
        class="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex-shrink-0"
      >
        {creatingMinimumAgents ? 'Creating...' : 'Create Minimum Agents'}
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="text-slate-400">Loading agents...</div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
      <p class="text-sm text-red-400">{error}</p>
    </div>
  {:else if agents.length === 0}
    <div class="p-8 text-center bg-slate-800/50 rounded-lg">
      <p class="text-slate-400">No agents configured</p>
      <button on:click={openAddModal} class="mt-3 px-4 py-2 text-sm text-blue-400 underline">Add your first agent</button>
    </div>
  {:else}
    <!-- Grid layout for agent cards -->
    <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {#each agents as agent (agent.id)}
        <div class="p-6 bg-slate-800 border border-slate-700 rounded-lg shadow-sm hover:shadow-md hover:border-slate-600 transition-all">
          <!-- Header with emoji and status -->
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center space-x-3">
              <span class="text-4xl">{agent.emoji}</span>
              <div>
                <h3 class="text-lg font-semibold">{agent.name}</h3>
                <p class="text-sm text-slate-400">{agent.fullName}</p>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <!-- Edit button -->
              <button
                title="Edit agent"
                on:click={() => openEditModal(agent)}
                class="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
              >
                ✎
              </button>
              <!-- Delete button -->
              <button
                title="Delete agent"
                on:click={() => confirmDelete(agent)}
                class="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
              >
                🗑
              </button>
              <span class={`inline-block w-3 h-3 rounded-full ml-1 ${getStatusColor(agent.status)}`}></span>
            </div>
          </div>

          <!-- Status badge -->
          <div class="mb-3">
            <span class={`inline-block px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(agent.status)}`}>
              {formatStatusLabel(agent.status)}
            </span>
          </div>

          <!-- Model info -->
          <div class="mb-3">
            <div class="flex items-center space-x-2 text-xs text-slate-400">
              <span>🧠</span>
              <span>{formatModelName(agent.model)}</span>
            </div>
          </div>

          <!-- Last active -->
          <div class="mb-4 text-sm text-slate-400">
            <span class="font-medium">Last active:</span> {formatTime(agent.lastActive, agent.status)}
          </div>

          <!-- Mention patterns -->
          <div class="pt-3 border-t border-slate-700">
            <div class="text-xs text-slate-500 mb-1">Mentions:</div>
            <div class="flex flex-wrap gap-1">
              {#each agent.mentionPatterns as pattern}
                <span class="inline-block px-2 py-0.5 text-xs font-mono bg-slate-700 text-slate-300 rounded">
                  {pattern}
                </span>
              {/each}
            </div>
          </div>

          <!-- Actions -->
          <div class="mt-4 pt-4 border-t border-slate-700">
            <div class="flex space-x-2">
              <button
                class="flex-1 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 rounded hover:bg-blue-500/20"
                on:click={() => openDetails(agent)}
              >
                Details
              </button>
              <button
                class="flex-1 px-3 py-1.5 text-xs font-medium text-green-400 bg-green-500/10 rounded hover:bg-green-500/20"
                on:click={() => openMessage(agent)}
              >
                Message
              </button>
            </div>
          </div>

          <!-- Workspace path (collapsed) -->
          <details class="mt-3">
            <summary class="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
              Technical Info
            </summary>
            <div class="mt-2 p-2 bg-slate-900 rounded text-xs font-mono space-y-1">
              <div class="truncate">
                <span class="text-slate-500">ID:</span> {agent.id}
              </div>
              <div class="truncate">
                <span class="text-slate-500">Workspace:</span> {agent.workspace.replace(/^\/home\/[^/]+/, '~')}
              </div>
              {#if agent.activeSession}
                <div class="truncate">
                  <span class="text-slate-500">Session:</span> {agent.activeSession}
                </div>
              {/if}
            </div>
          </details>
        </div>
      {/each}
    </div>

    <!-- Summary stats at bottom -->
    <div class="grid grid-cols-3 gap-4 pt-6 border-t border-slate-700">
      <div class="p-4 bg-green-500/10 rounded-lg">
        <div class="text-2xl font-bold text-green-400">
          {agents.filter(a => a.status === 'online').length}
        </div>
        <div class="text-sm text-green-500">Active</div>
      </div>
      <div class="p-4 bg-yellow-500/10 rounded-lg">
        <div class="text-2xl font-bold text-yellow-400">
          {agents.filter(a => a.status === 'idle').length}
        </div>
        <div class="text-sm text-yellow-500">Idle</div>
      </div>
      <div class="p-4 bg-slate-700/50 rounded-lg">
        <div class="text-2xl font-bold text-slate-400">
          {agents.filter(a => a.status === 'offline').length}
        </div>
        <div class="text-sm text-slate-500">Inactive</div>
      </div>
    </div>
  {/if}
</div>

<!-- Add / Edit Agent Modal -->
{#if showAgentModal}
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" on:click={closeAgentModal}>
    <div class="bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-w-md w-full mx-4" on:click|stopPropagation>
      <div class="p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-lg font-bold">{agentModalMode === 'add' ? 'Add Agent' : 'Edit Agent'}</h2>
          <button on:click={closeAgentModal} class="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {#if agentModalError}
          <div class="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
            {agentModalError}
          </div>
        {/if}

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">Agent ID <span class="text-red-400">*</span></label>
            <input
              bind:value={agentForm.id}
              disabled={agentModalMode === 'edit'}
              type="text"
              placeholder="e.g. builder, researcher, writer"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">Display Name</label>
            <input
              bind:value={agentForm.name}
              type="text"
              placeholder="e.g. QA Reviewer"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">Model <span class="text-red-400">*</span></label>
            <select
              bind:value={agentForm.model}
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {#each AVAILABLE_MODELS as m}
                <option value={m}>{m}</option>
              {/each}
              {#if agentForm.model && !AVAILABLE_MODELS.includes(agentForm.model)}
                <option value={agentForm.model}>{agentForm.model}</option>
              {/if}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">Workspace Path <span class="text-red-400">*</span></label>
            <input
              bind:value={agentForm.workspace}
              type="text"
              placeholder="e.g. /home/user/.openclaw/workspace-builder"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
            />
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            on:click={closeAgentModal}
            class="px-4 py-2 text-sm text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600"
            disabled={savingAgent}
          >
            Cancel
          </button>
          <button
            on:click={saveAgent}
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            disabled={savingAgent}
          >
            {savingAgent ? 'Saving...' : agentModalMode === 'add' ? 'Add Agent' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Confirm Modal -->
{#if showDeleteConfirm}
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" on:click={cancelDelete}>
    <div class="bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-w-sm w-full mx-4 p-6" on:click|stopPropagation>
      <h2 class="text-lg font-bold mb-2">Delete Agent?</h2>
      <p class="text-sm text-slate-400 mb-5">
        Remove <span class="font-medium text-white">{deletingAgentName}</span> from the agent roster? This removes it from the config but does not delete workspace files.
      </p>
      <div class="flex justify-end gap-3">
        <button on:click={cancelDelete} class="px-4 py-2 text-sm text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600" disabled={deleting}>
          Cancel
        </button>
        <button on:click={doDelete} class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50" disabled={deleting}>
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Details Modal -->
{#if showDetailsModal && selectedAgent}
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" on:click={closeDetails}>
    <div class="bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" on:click|stopPropagation>
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <span class="text-4xl">{selectedAgent.emoji}</span>
            <div>
              <h2 class="text-xl font-bold">{selectedAgent.name}</h2>
              <p class="text-sm text-slate-400">{selectedAgent.fullName}</p>
            </div>
          </div>
          <button on:click={closeDetails} class="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="p-3 bg-slate-900 rounded-lg">
              <div class="text-xs text-slate-500 mb-1">Status</div>
              <span class={`inline-block px-2 py-1 text-sm font-medium rounded-full ${getStatusBadge(selectedAgent.status)}`}>
                {formatStatusLabel(selectedAgent.status)}
              </span>
            </div>
            <div class="p-3 bg-slate-900 rounded-lg">
              <div class="text-xs text-slate-500 mb-1">AI Model</div>
              <div class="text-sm font-medium">{formatModelName(selectedAgent.model)}</div>
              <div class="text-xs text-slate-400 mt-1 font-mono">{selectedAgent.model}</div>
            </div>
          </div>

          <div class="p-3 bg-slate-900 rounded-lg">
            <div class="text-xs text-slate-500 mb-1">Last Active</div>
            <div class="text-sm">{formatTime(selectedAgent.lastActive, selectedAgent.status)}</div>
            {#if selectedAgent.lastActive}
              <div class="text-xs text-slate-500 mt-1">{new Date(selectedAgent.lastActive).toLocaleString()}</div>
            {/if}
          </div>

          <div class="p-3 bg-slate-900 rounded-lg">
            <div class="text-xs text-slate-500 mb-1">Agent ID</div>
            <div class="font-mono text-sm">{selectedAgent.id}</div>
          </div>

          <div class="p-3 bg-slate-900 rounded-lg">
            <div class="text-xs text-slate-500 mb-1">Workspace</div>
            <div class="font-mono text-sm break-all">{selectedAgent.workspace}</div>
          </div>

          <div class="p-3 bg-slate-900 rounded-lg">
            <div class="text-xs text-slate-500 mb-1">Agent Directory</div>
            <div class="font-mono text-sm break-all">{selectedAgent.agentDir}</div>
          </div>

          {#if selectedAgent.activeSession}
            <div class="p-3 bg-slate-900 rounded-lg">
              <div class="text-xs text-slate-500 mb-1">Active Session</div>
              <div class="font-mono text-sm break-all">{selectedAgent.activeSession}</div>
            </div>
          {/if}

          <div class="p-3 bg-slate-900 rounded-lg">
            <div class="text-xs text-slate-500 mb-2">Mention Patterns</div>
            <div class="flex flex-wrap gap-2">
              {#each selectedAgent.mentionPatterns as pattern}
                <span class="inline-block px-2 py-1 text-sm font-mono bg-slate-700 rounded">{pattern}</span>
              {/each}
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-3">
          <a
            href="/sessions/{selectedAgent.id}"
            class="px-4 py-2 text-sm font-medium text-blue-400 bg-blue-500/10 rounded-lg hover:bg-blue-500/20"
            on:click={closeDetails}
          >
            View Sessions
          </a>
          <button
            on:click={() => { openEditModal(selectedAgent!); closeDetails(); }}
            class="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600"
          >
            Edit
          </button>
          <button
            on:click={closeDetails}
            class="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Message Modal -->
{#if showMessageModal && selectedAgent}
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" on:click={closeMessage}>
    <div class="bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-w-lg w-full mx-4" on:click|stopPropagation>
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <span class="text-2xl">{selectedAgent.emoji}</span>
            <h2 class="text-lg font-bold">Message {selectedAgent.name}</h2>
          </div>
          <button on:click={closeMessage} class="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {#if messageSuccess}
          <div class="p-4 bg-green-500/10 border border-green-500/30 rounded-lg mb-4">
            <p class="text-sm text-green-400">✓ Message sent successfully!</p>
          </div>
        {/if}

        {#if messageError}
          <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
            <p class="text-sm text-red-400">{messageError}</p>
          </div>
        {/if}

        <div class="mb-4">
          <label class="block text-sm font-medium text-slate-300 mb-2">Message</label>
          <textarea
            bind:value={messageText}
            rows="4"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter your message to the agent..."
            disabled={sendingMessage}
          ></textarea>
        </div>

        <div class="flex justify-end space-x-3">
          <button
            on:click={closeMessage}
            class="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600"
            disabled={sendingMessage}
          >
            Cancel
          </button>
          <button
            on:click={sendMessage}
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            disabled={sendingMessage || !messageText.trim()}
          >
            {sendingMessage ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
