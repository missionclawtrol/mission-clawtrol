<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api';
  
  interface RosterAgent {
    id: string;
    name: string;
    emoji: string;
    fullName: string;
    model: string;
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
  
  // Modal state
  let showDetailsModal = false;
  let showMessageModal = false;
  let selectedAgent: RosterAgent | null = null;
  let messageText = '';
  let sendingMessage = false;
  let messageError: string | null = null;
  let messageSuccess = false;
  
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
  
  function formatTime(timestamp: string | null): string {
    if (!timestamp) return 'Never';
    
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
  
  function getModelShort(model: string): string {
    // Extract short model name (e.g., "anthropic/claude-opus-4-5" -> "opus")
    if (model.includes('opus')) return 'opus';
    if (model.includes('sonnet')) return 'sonnet';
    if (model.includes('haiku')) return 'haiku';
    if (model.includes('qwen')) return 'qwen';
    return model.split('/').pop()?.split('-')[0] || model;
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
      // Use the agent's main session key
      const sessionKey = `agent:${selectedAgent.id}:main`;
      await api.post(`/agents/${encodeURIComponent(sessionKey)}/message`, {
        message: messageText.trim()
      });
      messageSuccess = true;
      messageText = '';
      setTimeout(() => {
        closeMessage();
        loadRoster(); // Refresh to show updated status
      }, 1500);
    } catch (err) {
      messageError = err instanceof Error ? err.message : 'Failed to send message';
    } finally {
      sendingMessage = false;
    }
  }
  
  onMount(() => {
    loadRoster();
    // Refresh every 10 seconds
    refreshInterval = setInterval(loadRoster, 10000) as any;
  });
  
  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-gray-900">Agent Roster</h1>
    <button
      on:click={loadRoster}
      class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
    >
      Refresh
    </button>
  </div>
  
  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="text-gray-500">Loading agents...</div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
      <p class="text-sm text-red-800">{error}</p>
    </div>
  {:else if agents.length === 0}
    <div class="p-8 text-center bg-gray-50 rounded-lg">
      <p class="text-gray-500">No agents configured</p>
    </div>
  {:else}
    <!-- Grid layout for agent cards -->
    <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {#each agents as agent (agent.id)}
        <div class="p-6 bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
          <!-- Header with emoji and status -->
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center space-x-3">
              <span class="text-4xl">{agent.emoji}</span>
              <div>
                <h3 class="text-lg font-semibold text-gray-900">{agent.name}</h3>
                <p class="text-sm text-gray-500">{agent.fullName}</p>
              </div>
            </div>
            <span class={`inline-block w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
          </div>
          
          <!-- Status badge -->
          <div class="mb-3">
            <span class={`inline-block px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(agent.status)}`}>
              {agent.status}
            </span>
          </div>
          
          <!-- Model info -->
          <div class="mb-3">
            <div class="flex items-center space-x-2 text-sm">
              <span class="text-gray-500">🧠</span>
              <span class="font-mono text-gray-700">{getModelShort(agent.model)}</span>
            </div>
          </div>
          
          <!-- Last active -->
          <div class="mb-4 text-sm text-gray-600">
            <span class="font-medium">Last active:</span> {formatTime(agent.lastActive)}
          </div>
          
          <!-- Mention patterns -->
          <div class="pt-3 border-t border-gray-100">
            <div class="text-xs text-gray-500 mb-1">Mentions:</div>
            <div class="flex flex-wrap gap-1">
              {#each agent.mentionPatterns as pattern}
                <span class="inline-block px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-700 rounded">
                  {pattern}
                </span>
              {/each}
            </div>
          </div>
          
          <!-- Actions -->
          <div class="mt-4 pt-4 border-t border-gray-100">
            <div class="flex space-x-2">
              <button
                class="flex-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100"
                on:click={() => openDetails(agent)}
              >
                Details
              </button>
              <button
                class="flex-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded hover:bg-green-100"
                on:click={() => openMessage(agent)}
              >
                Message
              </button>
            </div>
          </div>
          
          <!-- Workspace path (collapsed) -->
          <details class="mt-3">
            <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
              Technical Info
            </summary>
            <div class="mt-2 p-2 bg-gray-50 rounded text-xs font-mono space-y-1">
              <div class="truncate">
                <span class="text-gray-500">ID:</span> {agent.id}
              </div>
              <div class="truncate">
                <span class="text-gray-500">Workspace:</span> {agent.workspace.replace(/^\/home\/[^/]+/, '~')}
              </div>
              {#if agent.activeSession}
                <div class="truncate">
                  <span class="text-gray-500">Session:</span> {agent.activeSession}
                </div>
              {/if}
            </div>
          </details>
        </div>
      {/each}
    </div>
    
    <!-- Summary stats at bottom -->
    <div class="grid grid-cols-3 gap-4 pt-6 border-t border-gray-200">
      <div class="p-4 bg-green-50 rounded-lg">
        <div class="text-2xl font-bold text-green-700">
          {agents.filter(a => a.status === 'online').length}
        </div>
        <div class="text-sm text-green-600">Online</div>
      </div>
      <div class="p-4 bg-yellow-50 rounded-lg">
        <div class="text-2xl font-bold text-yellow-700">
          {agents.filter(a => a.status === 'idle').length}
        </div>
        <div class="text-sm text-yellow-600">Idle</div>
      </div>
      <div class="p-4 bg-gray-50 rounded-lg">
        <div class="text-2xl font-bold text-gray-700">
          {agents.filter(a => a.status === 'offline').length}
        </div>
        <div class="text-sm text-gray-600">Offline</div>
      </div>
    </div>
  {/if}
</div>

<!-- Details Modal -->
{#if showDetailsModal && selectedAgent}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" on:click={closeDetails}>
    <div class="bg-white text-gray-900 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" on:click|stopPropagation>
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <span class="text-4xl">{selectedAgent.emoji}</span>
            <div>
              <h2 class="text-xl font-bold text-gray-900">{selectedAgent.name}</h2>
              <p class="text-sm text-gray-500">{selectedAgent.fullName}</p>
            </div>
          </div>
          <button on:click={closeDetails} class="text-gray-400 hover:text-gray-600">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="p-3 bg-gray-50 rounded-lg">
              <div class="text-xs text-gray-500 mb-1">Status</div>
              <span class={`inline-block px-2 py-1 text-sm font-medium rounded-full ${getStatusBadge(selectedAgent.status)}`}>
                {selectedAgent.status}
              </span>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg">
              <div class="text-xs text-gray-500 mb-1">Model</div>
              <div class="font-mono text-sm text-gray-900">{selectedAgent.model}</div>
            </div>
          </div>
          
          <div class="p-3 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-500 mb-1">Last Active</div>
            <div class="text-sm text-gray-900">{formatTime(selectedAgent.lastActive)}</div>
            {#if selectedAgent.lastActive}
              <div class="text-xs text-gray-500 mt-1">{new Date(selectedAgent.lastActive).toLocaleString()}</div>
            {/if}
          </div>
          
          <div class="p-3 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-500 mb-1">Agent ID</div>
            <div class="font-mono text-sm text-gray-900">{selectedAgent.id}</div>
          </div>
          
          <div class="p-3 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-500 mb-1">Workspace</div>
            <div class="font-mono text-sm text-gray-900 break-all">{selectedAgent.workspace}</div>
          </div>
          
          <div class="p-3 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-500 mb-1">Agent Directory</div>
            <div class="font-mono text-sm text-gray-900 break-all">{selectedAgent.agentDir}</div>
          </div>
          
          {#if selectedAgent.activeSession}
            <div class="p-3 bg-gray-50 rounded-lg">
              <div class="text-xs text-gray-500 mb-1">Active Session</div>
              <div class="font-mono text-sm text-gray-900 break-all">{selectedAgent.activeSession}</div>
            </div>
          {/if}
          
          <div class="p-3 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-500 mb-2">Mention Patterns</div>
            <div class="flex flex-wrap gap-2">
              {#each selectedAgent.mentionPatterns as pattern}
                <span class="inline-block px-2 py-1 text-sm font-mono bg-white text-gray-900 border border-gray-200 rounded">
                  {pattern}
                </span>
              {/each}
            </div>
          </div>
        </div>
        
        <div class="mt-6 flex justify-end gap-3">
          <a
            href="/sessions/{selectedAgent.id}"
            class="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100"
            on:click={closeDetails}
          >
            View Sessions
          </a>
          <button
            on:click={closeDetails}
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
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
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" on:click={closeMessage}>
    <div class="bg-white text-gray-900 rounded-lg shadow-xl max-w-lg w-full mx-4" on:click|stopPropagation>
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <span class="text-2xl">{selectedAgent.emoji}</span>
            <h2 class="text-lg font-bold text-gray-900">Message {selectedAgent.name}</h2>
          </div>
          <button on:click={closeMessage} class="text-gray-400 hover:text-gray-600">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {#if messageSuccess}
          <div class="p-4 bg-green-50 border border-green-200 rounded-lg mb-4">
            <p class="text-sm text-green-800">✓ Message sent successfully!</p>
          </div>
        {/if}
        
        {#if messageError}
          <div class="p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
            <p class="text-sm text-red-800">{messageError}</p>
          </div>
        {/if}
        
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">Message</label>
          <textarea
            bind:value={messageText}
            rows="4"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter your message to the agent..."
            disabled={sendingMessage}
          ></textarea>
        </div>
        
        <div class="flex justify-end space-x-3">
          <button
            on:click={closeMessage}
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
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
