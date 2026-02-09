<script lang="ts">
  import '../app.css';
  
  const tabs = [
    { name: 'Overview', href: '/', icon: '🏠' },
    { name: 'Monitor', href: '/monitor', icon: '📊' },
    { name: 'Approvals', href: '/approvals', icon: '✅' },
    { name: 'Projects', href: '/projects', icon: '📁' },
    { name: 'Settings', href: '/settings', icon: '⚙️' },
  ];
  
  import { page } from '$app/stores';
</script>

<div class="min-h-screen flex flex-col">
  <!-- Header -->
  <header class="bg-slate-800 border-b border-slate-700 px-6 py-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🤖</span>
        <h1 class="text-xl font-semibold">Agent Dashboard</h1>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-slate-400">OpenClaw Connected</span>
        <span class="w-2 h-2 bg-green-500 rounded-full"></span>
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
