<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { page } from '$app/stores';
  
  interface TranscriptMessage {
    id: string;
    role: 'user' | 'assistant';
    timestamp: string;
    content: string;
    toolCalls?: ToolCall[];
  }
  
  interface ToolCall {
    id: string;
    name: string;
    args?: any;
    result?: any;
    error?: string;
    status: 'pending' | 'executing' | 'completed' | 'failed';
  }
  
  interface Agent {
    id: string;
    name: string;
    emoji: string;
  }
  
  interface Session {
    id: string;
    agentId: string;
    startTime: string;
    lastUpdated: string;
    status: 'active' | 'completed' | 'error';
  }
  
  let messages: TranscriptMessage[] = [];
  let agent: Agent | null = null;
  let session: Session | null = null;
  let loading = true;
  let error: string | null = null;
  let agentId: string = '';
  let sessionId: string = '';
  let scrollContainer: HTMLDivElement;
  
  $: agentId = $page.params.agentId;
  $: sessionId = $page.params.sessionId;
  
  async function loadTranscript() {
    if (!agentId || !sessionId) return;
    
    loading = true;
    error = null;
    
    try {
      // Fetch agent info
      const agentsRes = await api.get('/agents/roster');
      const allAgents = agentsRes.agents || [];
      const foundAgent = allAgents.find((a: any) => a.id === agentId);
      
      if (foundAgent) {
        agent = {
          id: foundAgent.id,
          name: foundAgent.name,
          emoji: foundAgent.emoji,
        };
      }
      
      // Fetch transcript
      const transcriptRes = await api.get(`/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}/transcript`);
      messages = transcriptRes.messages || [];
      
      if (transcriptRes.session) {
        session = transcriptRes.session;
      }
      
      // Scroll to bottom after loading
      setTimeout(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }, 100);
    } catch (err) {
      console.error('Failed to load transcript:', err);
      error = err instanceof Error ? err.message : 'Failed to load transcript';
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
  
  function formatAbsoluteTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  function getToolStatusColor(status: string): string {
    switch (status) {
      case 'pending': return 'bg-yellow-50 border-yellow-200 text-yellow-700';
      case 'executing': return 'bg-blue-50 border-blue-200 text-blue-700';
      case 'completed': return 'bg-green-50 border-green-200 text-green-700';
      case 'failed': return 'bg-red-50 border-red-200 text-red-700';
      default: return 'bg-gray-50 border-gray-200 text-gray-700';
    }
  }
  
  function getToolStatusBadge(status: string): string {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'executing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }
  
  onMount(() => {
    loadTranscript();
  });
</script>

<div class="flex flex-col h-[calc(100vh-180px)] space-y-4">
  <!-- Breadcrumb & Header -->
  <div class="space-y-4">
    <!-- Breadcrumb -->
    <nav class="flex items-center gap-2 text-sm text-gray-600">
      <a href="/roster" class="hover:text-gray-900">Roster</a>
      <span>/</span>
      {#if agent}
        <a href="/sessions/{agentId}" class="hover:text-gray-900">{agent.name}</a>
      {:else}
        <a href="/sessions/{agentId}" class="hover:text-gray-900">{agentId}</a>
      {/if}
      <span>/</span>
      <span class="text-gray-900">Session {sessionId.slice(0, 8)}</span>
    </nav>
    
    <!-- Header with session info -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        {#if agent}
          <span class="text-3xl">{agent.emoji}</span>
          <div>
            <h1 class="text-2xl font-bold text-gray-900">{agent.name}</h1>
            <p class="text-sm text-gray-600">Session {sessionId.slice(0, 12)}...</p>
          </div>
        {:else}
          <h1 class="text-2xl font-bold text-gray-900">Session</h1>
        {/if}
      </div>
      
      {#if session}
        <div class="space-y-1 text-right">
          <div class="flex items-center gap-2 justify-end">
            <span class={`inline-block w-2 h-2 rounded-full ${
              session.status === 'active' ? 'bg-blue-500' : session.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
            }`}></span>
            <span class="text-sm font-medium text-gray-600">{session.status}</span>
          </div>
          <div class="text-xs text-gray-500">{formatTime(session.lastUpdated)}</div>
        </div>
      {/if}
    </div>
  </div>
  
  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-gray-500">Loading transcript...</div>
    </div>
  {:else if error}
    <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
      <p class="text-sm text-red-800">{error}</p>
    </div>
  {:else if messages.length === 0}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-gray-500">No messages yet</div>
    </div>
  {:else}
    <!-- Chat Container -->
    <div
      bind:this={scrollContainer}
      class="flex-1 overflow-y-auto pr-4 space-y-4"
    >
      {#each messages as message (message.id)}
        <div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <!-- Message -->
          <div class={`max-w-xl ${message.role === 'user' ? 'bg-blue-500 text-white rounded-2xl rounded-tr-md' : 'bg-gray-200 text-gray-900 rounded-2xl rounded-tl-md'} px-4 py-3 shadow-sm`}>
            <!-- Role & Time -->
            <div class={`text-xs font-medium mb-1 ${message.role === 'user' ? 'text-blue-100' : 'text-gray-600'}`}>
              <span>{message.role === 'user' ? 'You' : 'Assistant'}</span>
              <span class="mx-1">•</span>
              <span title={new Date(message.timestamp).toLocaleString()}>
                {formatAbsoluteTime(message.timestamp)}
              </span>
            </div>
            
            <!-- Content -->
            <div class={`text-sm ${message.role === 'user' ? 'text-white' : 'text-gray-900'} whitespace-pre-wrap break-words`}>
              {message.content}
            </div>
          </div>
        </div>
        
        <!-- Tool Calls -->
        {#if message.toolCalls && message.toolCalls.length > 0}
          <div class="flex justify-start">
            <div class="space-y-2 max-w-2xl w-full">
              {#each message.toolCalls as toolCall (toolCall.id)}
                <details class="group">
                  <summary class={`cursor-pointer px-3 py-2 rounded-lg border ${getToolStatusColor(toolCall.status)} font-mono text-sm font-medium`}>
                    <span class="inline-block mr-2 group-open:rotate-90 transition-transform">▶</span>
                    {toolCall.name}
                    <span class={`ml-2 px-2 py-0.5 rounded text-xs font-semibold ${getToolStatusBadge(toolCall.status)}`}>
                      {toolCall.status}
                    </span>
                  </summary>
                  
                  <div class="mt-2 space-y-2">
                    {#if toolCall.args}
                      <div class="p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div class="text-xs font-semibold text-gray-600 mb-2">Arguments:</div>
                        <pre class="font-mono text-xs text-gray-700 overflow-x-auto"><code>{JSON.stringify(toolCall.args, null, 2)}</code></pre>
                      </div>
                    {/if}
                    
                    {#if toolCall.result}
                      <div class="p-3 bg-green-50 rounded-lg border border-green-200">
                        <div class="text-xs font-semibold text-green-700 mb-2">Result:</div>
                        <pre class="font-mono text-xs text-green-800 overflow-x-auto max-h-48"><code>{JSON.stringify(toolCall.result, null, 2)}</code></pre>
                      </div>
                    {/if}
                    
                    {#if toolCall.error}
                      <div class="p-3 bg-red-50 rounded-lg border border-red-200">
                        <div class="text-xs font-semibold text-red-700 mb-2">Error:</div>
                        <pre class="font-mono text-xs text-red-800 overflow-x-auto"><code>{toolCall.error}</code></pre>
                      </div>
                    {/if}
                  </div>
                </details>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
  
  <!-- Refresh button -->
  <div class="flex justify-center pt-4 border-t border-gray-200">
    <button
      on:click={loadTranscript}
      class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
    >
      Refresh
    </button>
  </div>
</div>
