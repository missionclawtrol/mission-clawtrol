<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  const API_BASE = '/api';

  type Mode = 'loading' | 'login' | 'setup';

  let mode: Mode = 'loading';
  let username = '';
  let password = '';
  let confirmPassword = '';
  let error = '';
  let submitting = false;

  onMount(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`);
      if (res.ok) {
        // Already authenticated — go to dashboard
        window.location.href = '/';
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.setupRequired) {
        mode = 'setup';
      } else {
        mode = 'login';
      }
    } catch {
      mode = 'login';
    }
  });

  async function handleLogin() {
    error = '';
    if (!username || !password) {
      error = 'Username and password are required.';
      return;
    }
    submitting = true;
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        const data = await res.json().catch(() => ({}));
        error = data.error || 'Login failed. Check your credentials.';
      }
    } catch {
      error = 'Network error. Please try again.';
    } finally {
      submitting = false;
    }
  }

  async function handleSetup() {
    error = '';
    if (!username || !password || !confirmPassword) {
      error = 'All fields are required.';
      return;
    }
    if (username.length < 3) {
      error = 'Username must be at least 3 characters.';
      return;
    }
    if (password.length < 8) {
      error = 'Password must be at least 8 characters.';
      return;
    }
    if (password !== confirmPassword) {
      error = 'Passwords do not match.';
      return;
    }
    submitting = true;
    try {
      const res = await fetch(`${API_BASE}/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        const data = await res.json().catch(() => ({}));
        error = data.error || 'Setup failed. Please try again.';
      }
    } catch {
      error = 'Network error. Please try again.';
    } finally {
      submitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (mode === 'login') handleLogin();
      else if (mode === 'setup') handleSetup();
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
  <div class="w-full max-w-md p-8">
    <!-- Logo and Title -->
    <div class="text-center mb-8">
      <div class="text-6xl mb-4">🦞</div>
      <h1 class="text-3xl font-bold text-white">Mission Clawtrol</h1>
      {#if mode === 'setup'}
        <p class="text-slate-400 mt-2">Create your admin account to get started</p>
      {:else}
        <p class="text-slate-400 mt-2">Sign in to access your dashboard</p>
      {/if}
    </div>

    <!-- Card -->
    <div class="bg-white dark:bg-slate-800 rounded-lg p-8 shadow-xl border border-gray-200 dark:border-slate-700">
      {#if mode === 'loading'}
        <div class="flex justify-center py-8">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
        </div>

      {:else if mode === 'setup'}
        <!-- First-time setup form -->
        <h2 class="text-lg font-semibold text-white mb-6">Create Admin Account</h2>

        {#if error}
          <div class="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        {/if}

        <div class="space-y-4">
          <div>
            <label for="setup-username" class="block text-sm font-medium text-slate-300 mb-1">Username</label>
            <input
              id="setup-username"
              type="text"
              bind:value={username}
              on:keydown={handleKeydown}
              placeholder="admin"
              autocomplete="username"
              class="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label for="setup-password" class="block text-sm font-medium text-slate-300 mb-1">Password</label>
            <input
              id="setup-password"
              type="password"
              bind:value={password}
              on:keydown={handleKeydown}
              placeholder="At least 8 characters"
              autocomplete="new-password"
              class="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label for="setup-confirm" class="block text-sm font-medium text-slate-300 mb-1">Confirm Password</label>
            <input
              id="setup-confirm"
              type="password"
              bind:value={confirmPassword}
              on:keydown={handleKeydown}
              placeholder="Repeat password"
              autocomplete="new-password"
              class="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            on:click={handleSetup}
            disabled={submitting}
            class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed
                   text-white font-medium rounded-lg transition-colors"
          >
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>
        </div>

      {:else}
        <!-- Login form -->
        <h2 class="text-lg font-semibold text-white mb-6">Sign In</h2>

        {#if error}
          <div class="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        {/if}

        <div class="space-y-4">
          <div>
            <label for="login-username" class="block text-sm font-medium text-slate-300 mb-1">Username</label>
            <input
              id="login-username"
              type="text"
              bind:value={username}
              on:keydown={handleKeydown}
              placeholder="Enter your username"
              autocomplete="username"
              class="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label for="login-password" class="block text-sm font-medium text-slate-300 mb-1">Password</label>
            <input
              id="login-password"
              type="password"
              bind:value={password}
              on:keydown={handleKeydown}
              placeholder="Enter your password"
              autocomplete="current-password"
              class="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            on:click={handleLogin}
            disabled={submitting}
            class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed
                   text-white font-medium rounded-lg transition-colors"
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <p class="text-center text-slate-500 text-sm mt-6">
      Authentication required to access the dashboard
    </p>
  </div>
</div>
