<script lang="ts">
  import { onMount } from 'svelte';
  import { api, fetchCurrentUser, type CurrentUser } from '$lib/api';

  interface TeamUser {
    id: string;
    githubLogin: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    role: 'admin' | 'member' | 'viewer';
  }

  let users: TeamUser[] = [];
  let currentUser: CurrentUser | null = null;
  let loading = true;
  let error: string | null = null;
  let saving: string | null = null; // userId being saved

  const isAdmin = () => currentUser?.role === 'admin';

  async function loadData() {
    try {
      const [usersRes, me] = await Promise.all([
        api.get('/users'),
        fetchCurrentUser(),
      ]);
      users = usersRes.users || [];
      currentUser = me;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load team';
    } finally {
      loading = false;
    }
  }

  async function changeRole(userId: string, newRole: string) {
    if (!isAdmin()) return;
    saving = userId;
    try {
      await api.patch(`/users/${userId}`, { role: newRole });
      // Update local state
      users = users.map(u => u.id === userId ? { ...u, role: newRole as TeamUser['role'] } : u);
      error = null;
    } catch (err: any) {
      error = err?.message || 'Failed to update role';
    } finally {
      saving = null;
    }
  }

  async function removeUser(userId: string) {
    if (!isAdmin()) return;
    if (!confirm('Remove this user from the team?')) return;
    try {
      await api.delete(`/users/${userId}`);
      users = users.filter(u => u.id !== userId);
    } catch (err: any) {
      error = err?.message || 'Failed to remove user';
    }
  }

  function roleBadge(role: string): string {
    switch (role) {
      case 'admin': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'member': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'viewer': return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      default: return 'bg-slate-500/20 text-slate-400';
    }
  }

  onMount(loadData);
</script>

<div class="max-w-4xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold text-slate-100">Team Management</h1>
    <span class="text-sm text-slate-400">{users.length} member{users.length !== 1 ? 's' : ''}</span>
  </div>

  {#if error}
    <div class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
      {error}
      <button class="ml-2 underline" on:click={() => error = null}>dismiss</button>
    </div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-12 text-slate-400">Loading team...</div>
  {:else if users.length === 0}
    <div class="p-8 text-center bg-slate-800/50 rounded-lg border border-slate-700">
      <p class="text-slate-400">No team members yet. Users are added when they log in via GitHub OAuth.</p>
    </div>
  {:else}
    <!-- Role legend -->
    <div class="flex gap-4 text-xs text-slate-400">
      <span><strong class="text-red-400">Admin</strong> — Full access, manage users</span>
      <span><strong class="text-blue-400">Member</strong> — Create & edit own tasks</span>
      <span><strong class="text-slate-300">Viewer</strong> — Read-only</span>
    </div>

    <div class="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-slate-700 text-left text-xs text-slate-400 uppercase">
            <th class="px-4 py-3">User</th>
            <th class="px-4 py-3">Role</th>
            {#if isAdmin()}
              <th class="px-4 py-3 text-right">Actions</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each users as user (user.id)}
            <tr class="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  {#if user.avatarUrl}
                    <img src={user.avatarUrl} alt="" class="w-8 h-8 rounded-full" />
                  {:else}
                    <div class="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-sm text-slate-300">
                      {(user.name || user.githubLogin).charAt(0).toUpperCase()}
                    </div>
                  {/if}
                  <div>
                    <div class="text-sm font-medium text-slate-200">{user.name || user.githubLogin}</div>
                    <div class="text-xs text-slate-400">@{user.githubLogin}</div>
                  </div>
                  {#if user.id === currentUser?.id}
                    <span class="text-xs text-slate-500">(you)</span>
                  {/if}
                </div>
              </td>
              <td class="px-4 py-3">
                {#if isAdmin() && user.id !== currentUser?.id}
                  <select
                    value={user.role}
                    on:change={(e) => changeRole(user.id, e.currentTarget.value)}
                    disabled={saving === user.id}
                    class="bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                {:else}
                  <span class={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${roleBadge(user.role)}`}>
                    {user.role}
                  </span>
                {/if}
              </td>
              {#if isAdmin()}
                <td class="px-4 py-3 text-right">
                  {#if user.id !== currentUser?.id}
                    <button
                      on:click={() => removeUser(user.id)}
                      class="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
