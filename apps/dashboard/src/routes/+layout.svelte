<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { wsConnected, connectWebSocket, disconnectWebSocket } from '$lib/websocket';
  import { checkHealth, fetchCurrentUser, logout, type CurrentUser } from '$lib/api';
  import { initTaskWebSocket, setCurrentUserId } from '$lib/taskWebSocket';
  import Toast from '$lib/components/Toast.svelte';
  import SlidePanel from '$lib/components/SlidePanel.svelte';
  import { panel } from '$lib/stores/panel';
  import { fetchSetupStatus, createFirstProject, type SetupStatus } from '$lib/api';

  const tabs = [
    { name: 'Overview', href: '/', icon: '🏠' },
    { name: 'Tasks', href: '/tasks', icon: '📋' },
    { name: 'Deliverables', href: '/deliverables', icon: '📦' },
    { name: 'Projects', href: '/projects', icon: '📁' },
    { name: 'Milestones', href: '/milestones', icon: '🎯' },
    { name: 'Roster', href: '/roster', icon: '👥' },
    { name: 'Reports', href: '/reports', icon: '📊' },
    { name: 'Costs', href: '/costs', icon: '💰' },
    { name: 'Team', href: '/team', icon: '🔐' },
    // { name: 'Webhooks', href: '/webhooks', icon: '🔔' }, // Hidden
    { name: 'Memory', href: '/memory', icon: '🧠' },
    { name: 'Rules', href: '/rules', icon: '⚡' },
    { name: 'Onboarding', href: '/onboarding', icon: '📚' },
    { name: 'Settings', href: '/settings', icon: '⚙️' },
  ];
  
  let backendConnected = false;
  let currentUser: CurrentUser | null = null;
  let authChecked = false;
  let userMenuOpen = false;
  let theme: 'dark' | 'light' = 'dark';

  // Setup banner
  let setupStatus: SetupStatus | null = null;
  let showSetupBanner = true;
  let creatingFirstProject = false;

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
    } else {
      // Set current user ID for task notifications
      setCurrentUserId(currentUser.id);
    }
  }
  
  async function loadSetupStatus() {
    try {
      setupStatus = await fetchSetupStatus();
      // Auto-dismiss if complete
      if (setupStatus.complete) {
        showSetupBanner = false;
      }
    } catch {
      // Silently ignore setup status errors
    }
  }

  function dismissSetup() {
    showSetupBanner = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('setupBannerDismissed', 'true');
    }
  }

  async function handleCreateFirstProject() {
    creatingFirstProject = true;
    try {
      await createFirstProject();
      await loadSetupStatus();
    } catch (err) {
      console.error('Failed to create first project:', err);
    } finally {
      creatingFirstProject = false;
    }
  }

  let intervalId: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    loadTheme();
    checkBackend();
    checkAuth();
    connectWebSocket();
    initTaskWebSocket(); // Initialize task WebSocket listener

    // Load setup banner dismiss state
    if (typeof localStorage !== 'undefined') {
      const dismissed = localStorage.getItem('setupBannerDismissed');
      if (dismissed === 'true') showSetupBanner = false;
    }

    // Load setup status (non-blocking)
    loadSetupStatus();

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

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveTheme();
  }

  function applyTheme() {
    if (typeof document !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }

  function saveTheme() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('theme', theme);
    }
    // Also save to settings API
    if (currentUser) {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      }).catch(err => console.error('Failed to save theme to API:', err));
    }
  }

  function loadTheme() {
    if (typeof localStorage !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      theme = (savedTheme === 'light' ? 'light' : 'dark') as 'dark' | 'light';
    }
    applyTheme();
  }
</script>

<!-- Click outside to close user menu -->
<svelte:window on:click={handleClickOutside} />

<!-- Show loading while checking auth (except on login page) -->
{#if !authChecked && $page.url.pathname !== '/login'}
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
      <p class="text-slate-600 dark:text-slate-400">Checking authentication...</p>
    </div>
  </div>
{:else}
  <!-- Show content for login page or authenticated users -->
  <div class="min-h-screen flex flex-col">
    <!-- Header - show for all pages including login (to maintain consistent UI) -->
    <header class="bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4">
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
          <!-- Theme Toggle -->
          <button
            on:click={toggleTheme}
            class="p-2 hover:bg-slate-700/50 dark:hover:bg-slate-700 rounded-lg transition-colors"
            title="Toggle {theme === 'dark' ? 'light' : 'dark'} mode"
          >
            {#if theme === 'dark'}
              <span class="text-xl">☀️</span>
            {:else}
              <span class="text-xl">🌙</span>
            {/if}
          </button>
          <!-- Panel Toggle -->
          <button
            on:click={() => panel.toggle()}
            class="p-2 hover:bg-slate-700/50 dark:hover:bg-slate-700 rounded-lg transition-colors"
            title="Toggle chat / terminal panel"
          >
            <span class="text-xl">💬</span>
          </button>
          <!-- User Menu -->
          {#if currentUser}
            <div class="relative pl-4 border-l border-gray-300 dark:border-slate-600 user-menu-container">
              <button
                on:click={toggleUserMenu}
                class="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg px-2 py-1 transition-colors"
              >
                {#if currentUser.avatarUrl}
                  <img 
                    src={currentUser.avatarUrl} 
                    alt={currentUser.name || currentUser.username}
                    class="w-8 h-8 rounded-full"
                  />
                {:else}
                  <div class="w-8 h-8 rounded-full bg-gray-300 dark:bg-slate-600 flex items-center justify-center">
                    <span class="text-sm text-slate-700 dark:text-slate-300">{(currentUser.name || currentUser.username).charAt(0).toUpperCase()}</span>
                  </div>
                {/if}
                <span class="text-sm text-slate-700 dark:text-slate-300">{currentUser.name || currentUser.username}</span>
                <svg class="w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform {userMenuOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {#if userMenuOpen}
                <div class="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg shadow-xl z-50">
                  <!-- User info -->
                  <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
                    <p class="text-sm font-medium text-slate-900 dark:text-slate-200">{currentUser.name || currentUser.username}</p>
                    {#if currentUser.email}
                      <p class="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{currentUser.email}</p>
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
                      class="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md transition-colors"
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
    
    <!-- Setup Banner - show when setup incomplete and not dismissed -->
    {#if showSetupBanner && setupStatus && !setupStatus.complete && currentUser}
      <div class="bg-blue-600/10 border-b border-blue-500/20 px-6 py-3 flex items-center gap-6">
        <span class="text-blue-400 font-medium">🚀 Getting started</span>
        <div class="flex items-center gap-4 text-sm flex-1 flex-wrap">
          <span class={setupStatus.gatewayConnected ? 'text-green-400' : 'text-slate-500'}>
            {setupStatus.gatewayConnected ? '✅' : '⬜'} Gateway connected
          </span>
          <span class={setupStatus.partialAgents >= setupStatus.totalAgents ? 'text-green-400' : 'text-amber-400'}>
            {setupStatus.partialAgents >= setupStatus.totalAgents ? '✅' : '⬜'} Team ready ({setupStatus.partialAgents}/{setupStatus.totalAgents})
            {#if setupStatus.partialAgents < setupStatus.totalAgents}
              <a href="/roster" class="ml-1 underline text-blue-400">→ Create</a>
            {/if}
          </span>
          <span class={setupStatus.hasProjects ? 'text-green-400' : 'text-amber-400'}>
            {setupStatus.hasProjects ? '✅' : '⬜'} First project
            {#if !setupStatus.hasProjects}
              <button
                on:click={handleCreateFirstProject}
                disabled={creatingFirstProject}
                class="ml-1 underline text-blue-400 disabled:opacity-50"
              >
                {creatingFirstProject ? 'Creating...' : '→ Create'}
              </button>
            {/if}
          </span>
        </div>
        <button on:click={dismissSetup} class="text-slate-500 hover:text-white text-sm flex-shrink-0">Dismiss</button>
      </div>
    {/if}

    <!-- Tab Navigation - only show for authenticated users -->
    {#if currentUser}
      <nav class="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700 px-6">
        <div class="flex gap-1">
          {#each tabs as tab}
            <a
              href={tab.href}
              on:click={tab.href === '/costs' ? handleCostsNav : tab.href === '/projects' ? handleProjectsNav : undefined}
              class="px-4 py-3 text-sm font-medium transition-colors relative
                {$page.url.pathname === tab.href 
                  ? 'text-blue-600 dark:text-blue-400' 
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}"
            >
              <span class="mr-2">{tab.icon}</span>
              {tab.name}
              {#if $page.url.pathname === tab.href}
                <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"></div>
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
    
    <!-- Toast Notifications -->
    <Toast />

    <!-- Slide-out Chat + Terminal Panel -->
    <SlidePanel />
  </div>
{/if}
