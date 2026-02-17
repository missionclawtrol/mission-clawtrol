<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { wsConnected, connectWebSocket, disconnectWebSocket } from '$lib/websocket';
  import { checkHealth, fetchCurrentUser, logout, type CurrentUser } from '$lib/api';
  
  const tabs = [
    { name: 'Overview', href: '/', icon: '🏠' },
    { name: 'Roster', href: '/roster', icon: '👥' },
    { name: 'Work Orders', href: '/tasks', icon: '📋' },
    { name: 'Projects', href: '/projects', icon: '📁' },
    { name: 'Costs', href: '/costs', icon: '💰' },
    { name: 'Settings', href: '/settings', icon: '⚙️' },
  ];
  
  let backendConnected = false;
  let currentUser: CurrentUser | null = null;
  let authChecked = false;
  let userMenuOpen = false;

  function toggleUserMenu() {
    userMenuOpen = !userMenuOpen;
  }

  function closeUserMenu() {
    userMenuOpen = false;
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.user-menu-container')) {
      closeUserMenu();
    }
  }

  async function handleLogout() {
    closeUserMenu();
    await logout();
    currentUser = null;
    goto('/login');
  }
  
  async function checkBackend() {
    backendConnected = await checkHealth();
  }

  async function checkAuth() {
    // Skip auth check for login page
    if ($page.url.pathname === '/login') {
      authChecked = true;
      return;
    }
    
    currentUser = await fetchCurrentUser();
    authChecked = true;
    
    // If not authenticated, redirect to login
    if (!currentUser) {
      goto('/login');
    }
  }
  
  let intervalId: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    checkBackend();
    checkAuth();
    connectWebSocket();

    // Check backend health every 10 seconds
    intervalId = window.setInterval(checkBackend, 10000);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      disconnectWebSocket();
    };
  });

  function handleCostsNav(event: MouseEvent) {
    // Force a clean reload with a tiny delay so the route change completes
    event.preventDefault();
    setTimeout(() => {
      window.location.href = '/costs';
    }, 50);
  }

  function handleProjectsNav(event: MouseEvent) {
    event.preventDefault();
    setTimeout(() => {
      window.location.href = '/projects';
    }, 50);
  }
</script>

<!-- Click outside to close user menu -->
<svelte:window on:click={handleClickOutside} />

<!-- Show loading while checking auth (except on login page) -->
{#if !authChecked && $page.url.pathname !== '/login'}
  <div class="min-h-screen flex items-center justify-center bg-slate-900">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
      <p class="text-slate-400">Checking authentication...</p>
    </div>
  </div>
{:else}
  <!-- Show content for login page or authenticated users -->
  <div class="min-h-screen flex flex-col">
    <!-- Header - show for all pages including login (to maintain consistent UI) -->
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
          <!-- User Menu -->
          {#if currentUser}
            <div class="relative pl-4 border-l border-slate-600 user-menu-container">
              <button
                on:click={toggleUserMenu}
                class="flex items-center gap-2 hover:bg-slate-700 rounded-lg px-2 py-1 transition-colors"
              >
                {#if currentUser.avatarUrl}
                  <img 
                    src={currentUser.avatarUrl} 
                    alt={currentUser.name || currentUser.username}
                    class="w-8 h-8 rounded-full"
                  />
                {:else}
                  <div class="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center">
                    <span class="text-sm text-slate-300">{(currentUser.name || currentUser.username).charAt(0).toUpperCase()}</span>
                  </div>
                {/if}
                <span class="text-sm text-slate-300">{currentUser.name || currentUser.username}</span>
                <svg class="w-4 h-4 text-slate-400 transition-transform {userMenuOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {#if userMenuOpen}
                <div class="absolute right-0 top-full mt-2 w-64 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50">
                  <!-- User info -->
                  <div class="px-4 py-3 border-b border-slate-700">
                    <p class="text-sm font-medium text-slate-200">{currentUser.name || currentUser.username}</p>
                    {#if currentUser.email}
                      <p class="text-xs text-slate-400 mt-0.5">{currentUser.email}</p>
                    {/if}
                    {#if currentUser.role}
                      <span class="inline-block mt-2 px-2 py-0.5 text-xs font-medium rounded-full
                        {currentUser.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                         currentUser.role === 'member' ? 'bg-blue-500/20 text-blue-400' :
                         'bg-slate-500/20 text-slate-400'}">
                        {currentUser.role}
                      </span>
                    {/if}
                  </div>
                  <!-- Logout -->
                  <div class="px-2 py-2">
                    <button
                      on:click={handleLogout}
                      class="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-slate-700 rounded-md transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </header>
    
    <!-- Tab Navigation - only show for authenticated users -->
    {#if currentUser}
      <nav class="bg-slate-800/50 border-b border-slate-700 px-6">
        <div class="flex gap-1">
          {#each tabs as tab}
            <a
              href={tab.href}
              on:click={tab.href === '/costs' ? handleCostsNav : tab.href === '/projects' ? handleProjectsNav : undefined}
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
    {/if}
    
    <!-- Main Content -->
    <main class="flex-1 p-6">
      <slot />
    </main>
  </div>
{/if}
