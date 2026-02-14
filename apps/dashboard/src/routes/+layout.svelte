<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { wsConnected, connectWebSocket, disconnectWebSocket } from '$lib/websocket';
  import { checkHealth } from '$lib/api';
  
  const tabs = [
    { name: 'Overview', href: '/', icon: '🏠' },
    { name: 'Roster', href: '/roster', icon: '👥' },
    { name: 'Tasks', href: '/tasks', icon: '📋' },
    { name: 'Approvals', href: '/approvals', icon: '✅' },
    { name: 'Projects', href: '/projects', icon: '📁' },
    { name: 'Settings', href: '/settings', icon: '⚙️' },
  ];
  
  import { page } from '$app/stores';
  
  let backendConnected = false;
  
  async function checkBackend() {
    backendConnected = await checkHealth();
  }
  
  onMount(() => {
    checkBackend();
    connectWebSocket();
    
    // Check backend health every 10 seconds
    const interval = setInterval(checkBackend, 10000);
    
    return () => {
      clearInterval(interval);
      disconnectWebSocket();
    };
  });
</script>

<div class="min-h-screen flex flex-col">
  <!-- Header -->
  <header class="bg-slate-800 border-b border-slate-700 px-6 py-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🦞</span>
        <h1 class="text-xl font-semibold">Mission Clawtrol</h1>
      </div>
      <div class="flex items-center gap-6">
        <!-- Backend Status -->
        <div class="flex items-center gap-2">
          <span class="text-sm text-slate-400">Backend</span>
          {#if backendConnected}
            <span class="w-2 h-2 bg-green-500 rounded-full"></span>
          {:else}
            <span class="w-2 h-2 bg-red-500 rounded-full"></span>
          {/if}
        </div>
        <!-- WebSocket Status -->
        <div class="flex items-center gap-2">
          <span class="text-sm text-slate-400">WebSocket</span>
          {#if $wsConnected}
            <span class="w-2 h-2 bg-green-500 rounded-full"></span>
          {:else}
            <span class="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
          {/if}
        </div>
      </div>
    </div>
  </header>
  
  <!-- Tab Navigation -->
  <nav class="bg-slate-800/50 border-b border-slate-700 px-6">
    <div class="flex gap-1">
      {#each tabs as tab}
        <a
          href={tab.href}
          class="px-4 py-3 text-sm font-medium transition-colors relative
            {$page.url.pathname === tab.href 
              ? 'text-blue-400' 
              : 'text-slate-400 hover:text-slate-200'}"
        >
          <span class="mr-2">{tab.icon}</span>
          {tab.name}
          {#if $page.url.pathname === tab.href}
            <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400"></div>
          {/if}
        </a>
      {/each}
    </div>
  </nav>
  
  <!-- Main Content -->
  <main class="flex-1 p-6">
    <slot />
  </main>
</div>
