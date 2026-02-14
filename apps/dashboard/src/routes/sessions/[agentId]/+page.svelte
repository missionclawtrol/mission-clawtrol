<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { page } from '$app/stores';
  
  interface Session {
    id: string;
    agentId: string;
    timestamp: string;
    lastUpdated: string;
    messageCount: number;
    status: 'active' | 'completed' | 'error';
  }
  
  interface Agent {
    id: string;
    name: string;
    emoji: string;
    fullName: string;
  }
  
  let sessions: Session[] = [];
  let agent: Agent | null = null;
  let loading = true;
  let error: string | null = null;
  let agentId: string = '';
  
  $: agentId = $page.params.agentId;
  
  async function loadSessions() {
    if (!agentId) return;
    
    loading = true;
    error = null;
    
    try {
      // Try to fetch agent info from roster
      const agentsRes = await api.get('/agents/roster');
      const allAgents = agentsRes.agents || [];
      const foundAgent = allAgents.find((a: any) => a.id === agentId);
      
      if (foundAgent) {
        agent = {
          id: foundAgent.id,
          name: foundAgent.name,
          emoji: foundAgent.emoji,
          fullName: foundAgent.fullName,
        };
      }
      
      // Fetch sessions for this agent
      const sessionsRes = await api.get(`/sessions/${encodeURIComponent(agentId)}`);
      sessions = sessionsRes.sessions || [];
      
      // Sort by lastUpdated descending
      sessions.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
    } catch (err) {
      console.error('Failed to load sessions:', err);
      error = err instanceof Error ? err.message : 'Failed to load sessions';
    } finally {
      loading = false;
    }
  }
  
  function formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }
  
  function getStatusColor(status: string): string {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }
  
  onMount(() => {
    loadSessions();
  });
</script>

<div class="space-y-6">
  <!-- Breadcrumb -->
  <nav class="flex items-center gap-2 text-sm text-gray-600">
    <a href="/roster" class="hover:text-gray-900">Roster</a>
    <span>/</span>
    {#if agent}
      <span class="text-gray-900 font-medium">{agent.name}</span>
    {:else}
      <span class="text-gray-900 font-medium">{agentId}</span>
    {/if}
    <span>/</span>
    <span class="text-gray-900">Sessions</span>
  </nav>
  
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-4">
      {#if agent}
        <span class="text-4xl">{agent.emoji}</span>
        <div>
          <h1 class="text-2xl font-bold text-gray-900">{agent.name}</h1>
          <p class="text-sm text-gray-600">{agent.fullName}</p>
        </div>
      {:else}
        <h1 class="text-2xl font-bold text-gray-900">Sessions</h1>
      {/if}
    </div>
    <button
      on:click={loadSessions}
      class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
    >
      Refresh
    </button>
  </div>
  
  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="text-gray-500">Loading sessions...</div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
      <p class="text-sm text-red-800">{error}</p>
    </div>
  {:else if sessions.length === 0}
    <div class="p-8 text-center bg-gray-50 rounded-lg">
      <p class="text-gray-500">No sessions yet</p>
    </div>
  {:else}
    <!-- Sessions Table -->
    <div class="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <table class="w-full">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">Session ID</th>
            <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
            <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">Messages</th>
            <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">Last Updated</th>
            <th class="px-6 py-3 text-right text-sm font-semibold text-gray-700">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          {#each sessions as session (session.id)}
            <tr class="hover:bg-gray-50 transition-colors">
              <td class="px-6 py-4 text-sm font-mono text-gray-900">{session.id}</td>
              <td class="px-6 py-4 text-sm">
                <span class={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                  {session.status}
                </span>
              </td>
              <td class="px-6 py-4 text-sm text-gray-600">{session.messageCount}</td>
              <td class="px-6 py-4 text-sm text-gray-600">
                <div>{formatTime(session.lastUpdated)}</div>
                <div class="text-xs text-gray-500">{new Date(session.lastUpdated).toLocaleString()}</div>
              </td>
              <td class="px-6 py-4 text-right">
                <a
                  href="/sessions/{agentId}/{session.id}"
                  class="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                >
                  View
                </a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
