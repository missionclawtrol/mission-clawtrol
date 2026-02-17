<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { fetchCurrentUser, type CurrentUser } from '$lib/api';

  let loading = true;
  let currentUser: CurrentUser | null = null;

  onMount(async () => {
    // Check if user is already authenticated
    currentUser = await fetchCurrentUser();
    loading = false;

    // If already authenticated, redirect to home
    if (currentUser) {
      goto('/');
      return;
    }
  });
</script>

<div class="min-h-screen flex items-center justify-center bg-slate-900">
  <div class="w-full max-w-md p-8">
    <!-- Logo and Title -->
    <div class="text-center mb-8">
      <div class="text-6xl mb-4">🦞</div>
      <h1 class="text-3xl font-bold text-white">Mission Clawtrol</h1>
      <p class="text-slate-400 mt-2">Sign in to access your dashboard</p>
    </div>

    <!-- Login Card -->
    <div class="bg-slate-800 rounded-lg p-8 shadow-xl border border-slate-700">
      {#if loading}
        <div class="flex justify-center py-8">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
        </div>
      {:else}
        <a
          href="/api/auth/login"
          class="flex items-center justify-center gap-3 w-full py-3 px-4 bg-slate-700 hover:bg-slate-600 
                 text-white font-medium rounded-lg transition-colors border border-slate-600
                 hover:border-slate-500"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          Sign in with GitHub
        </a>
      {/if}
    </div>

    <!-- Footer -->
    <p class="text-center text-slate-500 text-sm mt-6">
      Authentication required to access the dashboard
    </p>
  </div>
</div>
