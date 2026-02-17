<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchWebhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    testWebhook,
    fetchCurrentUser,
    type Webhook,
    type CurrentUser
  } from '$lib/api';

  let webhooks: Webhook[] = [];
  let currentUser: CurrentUser | null = null;
  let loading = true;
  let error: string | null = null;
  let saving = false;
  let showAddForm = false;
  let editingId: string | null = null;

  // Form state
  let formUrl = '';
  let formEvents: { [key: string]: boolean } = {
    'task.created': false,
    'task.status_changed': false,
    'task.assigned': false,
    'task.comment_added': false,
  };
  let formEnabled = true;

  const eventTypes = [
    { id: 'task.created', label: 'Task Created', desc: 'Triggered when a new task is created' },
    { id: 'task.status_changed', label: 'Task Status Changed', desc: 'Triggered when a task status changes' },
    { id: 'task.assigned', label: 'Task Assigned', desc: 'Triggered when a task is assigned to someone' },
    { id: 'task.comment_added', label: 'Comment Added', desc: 'Triggered when a comment is added to a task' },
  ];

  const isAdmin = () => currentUser?.role === 'admin';

  async function loadData() {
    try {
      const [webhooksData, me] = await Promise.all([
        fetchWebhooks(),
        fetchCurrentUser(),
      ]);
      webhooks = webhooksData;
      currentUser = me;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load webhooks';
    } finally {
      loading = false;
    }
  }

  function resetForm() {
    formUrl = '';
    formEvents = {
      'task.created': false,
      'task.status_changed': false,
      'task.assigned': false,
      'task.comment_added': false,
    };
    formEnabled = true;
    showAddForm = false;
    editingId = null;
    error = null;
  }

  function startEdit(webhook: Webhook) {
    editingId = webhook.id;
    formUrl = webhook.url;
    formEvents = {
      'task.created': webhook.events.includes('task.created'),
      'task.status_changed': webhook.events.includes('task.status_changed'),
      'task.assigned': webhook.events.includes('task.assigned'),
      'task.comment_added': webhook.events.includes('task.comment_added'),
    };
    formEnabled = webhook.enabled;
    showAddForm = true;
  }

  async function handleSubmit() {
    if (!isAdmin()) return;
    
    const selectedEvents = Object.entries(formEvents)
      .filter(([_, selected]) => selected)
      .map(([event, _]) => event);

    if (!formUrl || selectedEvents.length === 0) {
      error = 'URL and at least one event type are required';
      return;
    }

    // Validate URL format
    try {
      new URL(formUrl);
    } catch {
      error = 'Invalid URL format';
      return;
    }

    saving = true;
    try {
      if (editingId) {
        // Update existing webhook
        const updated = await updateWebhook(editingId, {
          url: formUrl,
          events: selectedEvents,
          enabled: formEnabled,
        });
        webhooks = webhooks.map(w => w.id === editingId ? updated : w);
      } else {
        // Create new webhook
        const created = await createWebhook({
          url: formUrl,
          events: selectedEvents,
          enabled: formEnabled,
        });
        webhooks = [...webhooks, created];
      }
      resetForm();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to save webhook';
    } finally {
      saving = false;
    }
  }

  async function handleDelete(id: string) {
    if (!isAdmin()) return;
    if (!confirm('Are you sure you want to delete this webhook?')) return;

    try {
      await deleteWebhook(id);
      webhooks = webhooks.filter(w => w.id !== id);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete webhook';
    }
  }

  async function handleToggle(webhook: Webhook) {
    if (!isAdmin()) return;

    try {
      const updated = await updateWebhook(webhook.id, {
        enabled: !webhook.enabled,
      });
      webhooks = webhooks.map(w => w.id === webhook.id ? updated : w);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to toggle webhook';
    }
  }

  async function handleTest(id: string) {
    if (!isAdmin()) return;

    try {
      await testWebhook(id);
      error = null;
      alert('Test payload sent successfully! Check your webhook endpoint.');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to test webhook';
    }
  }

  function copySecret(secret: string) {
    navigator.clipboard.writeText(secret);
    alert('Secret copied to clipboard!');
  }

  onMount(loadData);
</script>

<div class="max-w-6xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-slate-100">Webhook Notifications</h1>
      <p class="text-sm text-slate-400 mt-1">Receive real-time notifications for task events</p>
    </div>
    {#if isAdmin() && !showAddForm}
      <button
        on:click={() => showAddForm = true}
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
      >
        + Add Webhook
      </button>
    {/if}
  </div>

  {#if !isAdmin()}
    <div class="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-400">
      Only administrators can manage webhooks.
    </div>
  {/if}

  {#if error}
    <div class="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
      {error}
      <button class="ml-2 underline" on:click={() => error = null}>dismiss</button>
    </div>
  {/if}

  <!-- Add/Edit Form -->
  {#if showAddForm && isAdmin()}
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-100">
          {editingId ? 'Edit Webhook' : 'Add New Webhook'}
        </h2>
        <button
          on:click={resetForm}
          class="text-slate-400 hover:text-slate-300 text-sm"
        >
          Cancel
        </button>
      </div>

      <div class="space-y-4">
        <!-- URL Input -->
        <div>
          <label class="block text-sm font-medium text-slate-300 mb-2">
            Webhook URL *
          </label>
          <input
            type="url"
            bind:value={formUrl}
            placeholder="https://your-domain.com/webhook"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <p class="text-xs text-slate-400 mt-1">The endpoint that will receive POST requests</p>
        </div>

        <!-- Event Types -->
        <div>
          <label class="block text-sm font-medium text-slate-300 mb-2">
            Event Types *
          </label>
          <div class="space-y-2">
            {#each eventTypes as eventType}
              <label class="flex items-start gap-3 p-3 bg-slate-900/50 rounded border border-slate-700/50 hover:border-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  bind:checked={formEvents[eventType.id]}
                  class="mt-0.5 w-4 h-4 text-blue-600 bg-slate-800 border-slate-600 rounded focus:ring-blue-500 focus:ring-offset-slate-900"
                />
                <div class="flex-1">
                  <div class="text-sm font-medium text-slate-200">{eventType.label}</div>
                  <div class="text-xs text-slate-400">{eventType.desc}</div>
                </div>
              </label>
            {/each}
          </div>
        </div>

        <!-- Enabled Toggle -->
        <div class="flex items-center gap-3">
          <input
            type="checkbox"
            bind:checked={formEnabled}
            id="enabled-toggle"
            class="w-4 h-4 text-blue-600 bg-slate-800 border-slate-600 rounded focus:ring-blue-500 focus:ring-offset-slate-900"
          />
          <label for="enabled-toggle" class="text-sm text-slate-300">
            Enable webhook immediately
          </label>
        </div>

        <!-- Submit Button -->
        <div class="flex gap-3 pt-2">
          <button
            on:click={handleSubmit}
            disabled={saving}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Saving...' : editingId ? 'Update Webhook' : 'Create Webhook'}
          </button>
          <button
            on:click={resetForm}
            class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Webhooks List -->
  {#if loading}
    <div class="flex justify-center py-12 text-slate-400">Loading webhooks...</div>
  {:else if webhooks.length === 0}
    <div class="p-8 text-center bg-slate-800/50 rounded-lg border border-slate-700">
      <p class="text-slate-400">No webhooks configured yet.</p>
      {#if isAdmin()}
        <p class="text-sm text-slate-500 mt-2">Add your first webhook to start receiving task event notifications.</p>
      {/if}
    </div>
  {:else}
    <div class="space-y-4">
      {#each webhooks as webhook (webhook.id)}
        <div class="bg-slate-800 border border-slate-700 rounded-lg p-5 space-y-3">
          <!-- Header -->
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3">
                <span class="text-sm font-mono text-slate-100 break-all">{webhook.url}</span>
                <span class={`px-2 py-0.5 text-xs font-medium rounded border ${webhook.enabled ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                  {webhook.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div class="text-xs text-slate-400 mt-1">
                Created {new Date(webhook.createdAt).toLocaleDateString()}
              </div>
            </div>

            {#if isAdmin()}
              <div class="flex items-center gap-2">
                <!-- Toggle -->
                <button
                  on:click={() => handleToggle(webhook)}
                  class="px-3 py-1.5 text-xs font-medium rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                  title={webhook.enabled ? 'Disable' : 'Enable'}
                >
                  {webhook.enabled ? '⏸️' : '▶️'}
                </button>

                <!-- Test -->
                <button
                  on:click={() => handleTest(webhook.id)}
                  class="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  title="Send test payload"
                >
                  🧪 Test
                </button>

                <!-- Edit -->
                <button
                  on:click={() => startEdit(webhook)}
                  class="px-3 py-1.5 text-xs font-medium rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  ✏️ Edit
                </button>

                <!-- Delete -->
                <button
                  on:click={() => handleDelete(webhook.id)}
                  class="px-3 py-1.5 text-xs font-medium rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  🗑️
                </button>
              </div>
            {/if}
          </div>

          <!-- Events -->
          <div class="flex flex-wrap gap-2">
            {#each webhook.events as event}
              <span class="px-2 py-1 text-xs font-medium rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {event}
              </span>
            {/each}
          </div>

          <!-- Secret (collapsible) -->
          <details class="text-sm">
            <summary class="cursor-pointer text-slate-400 hover:text-slate-300 select-none">
              Show signing secret
            </summary>
            <div class="mt-2 p-3 bg-slate-900 rounded border border-slate-700 font-mono text-xs text-slate-300 break-all flex items-center justify-between gap-2">
              <span>{webhook.secret}</span>
              <button
                on:click={() => copySecret(webhook.secret)}
                class="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded shrink-0"
                title="Copy to clipboard"
              >
                📋
              </button>
            </div>
            <p class="text-xs text-slate-500 mt-1">
              Use this secret to verify webhook signatures (X-Webhook-Signature header with HMAC-SHA256)
            </p>
          </details>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Documentation -->
  <div class="bg-slate-800/50 border border-slate-700 rounded-lg p-5 space-y-3">
    <h3 class="text-sm font-semibold text-slate-200">📖 Webhook Documentation</h3>
    <div class="text-xs text-slate-400 space-y-2">
      <p><strong class="text-slate-300">Payload Format:</strong> All webhooks receive a JSON POST request with <code class="bg-slate-900 px-1 py-0.5 rounded">event</code>, <code class="bg-slate-900 px-1 py-0.5 rounded">data</code>, and <code class="bg-slate-900 px-1 py-0.5 rounded">timestamp</code> fields.</p>
      <p><strong class="text-slate-300">Signature Verification:</strong> The <code class="bg-slate-900 px-1 py-0.5 rounded">X-Webhook-Signature</code> header contains an HMAC-SHA256 signature of the request body using your webhook secret.</p>
      <p><strong class="text-slate-300">Timeout:</strong> Webhook requests timeout after 5 seconds.</p>
      <p><strong class="text-slate-300">Event Types:</strong> Subscribe to specific events or select multiple to receive all relevant notifications.</p>
    </div>
  </div>
</div>
