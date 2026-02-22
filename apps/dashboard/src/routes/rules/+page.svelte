<!-- Mission Clawtrol - Rules Engine Page -->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchRules,
    createRule,
    updateRule,
    deleteRule,
    type Rule,
  } from '$lib/api';

  let rules: Rule[] = [];
  let loading = true;
  let error: string | null = null;
  let saving = false;
  let successMsg: string | null = null;

  // Modal state
  let showModal = false;
  let editingRule: Rule | null = null;

  // Form state
  let formName = '';
  let formTrigger = 'task.status.changed';
  let formEnabled = true;
  let formPriority = 100;
  let formProjectId = '';
  let formConditionsRaw = '{}';
  let formActionsRaw = '[]';
  let formError: string | null = null;

  const TRIGGER_OPTIONS = [
    { value: 'task.status.changed', label: 'Task Status Changed' },
    { value: 'task.created', label: 'Task Created' },
    { value: 'task.assigned', label: 'Task Assigned' },
    { value: 'agent.session.started', label: 'Agent Session Started' },
  ];

  const EXAMPLE_CONDITIONS: Record<string, string> = {
    'task.status.changed': JSON.stringify({ 'task.status.to': 'review', 'task.type': ['development', 'bug'] }, null, 2),
    'task.created': JSON.stringify({ 'task.projectId': 'my-project' }, null, 2),
    'task.assigned': JSON.stringify({}, null, 2),
    'agent.session.started': JSON.stringify({}, null, 2),
  };

  const EXAMPLE_ACTIONS: Record<string, string> = {
    spawn_agent: JSON.stringify([{ type: 'spawn_agent', agentId: 'qa', template: 'qa-review' }], null, 2),
    inject_context: JSON.stringify([{ type: 'inject_context', content: '## Extra Instructions\n- Always check X\n- Never do Y' }], null, 2),
    notify: JSON.stringify([{ type: 'notify', message: 'Task moved to review!' }], null, 2),
  };

  async function loadRules() {
    loading = true;
    error = null;
    try {
      rules = await fetchRules();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load rules';
    } finally {
      loading = false;
    }
  }

  async function toggleEnabled(rule: Rule) {
    try {
      const updated = await updateRule(rule.id, { enabled: !rule.enabled });
      rules = rules.map(r => r.id === rule.id ? updated : r);
      successMsg = `Rule "${rule.name}" ${updated.enabled ? 'enabled' : 'disabled'}`;
      setTimeout(() => successMsg = null, 3000);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to update rule';
    }
  }

  function openCreateModal() {
    editingRule = null;
    formName = '';
    formTrigger = 'task.status.changed';
    formEnabled = true;
    formPriority = 100;
    formProjectId = '';
    formConditionsRaw = '{}';
    formActionsRaw = '[]';
    formError = null;
    showModal = true;
  }

  function openEditModal(rule: Rule) {
    if (rule.isBuiltIn) return; // Can't edit built-ins
    editingRule = rule;
    formName = rule.name;
    formTrigger = rule.trigger;
    formEnabled = rule.enabled;
    formPriority = rule.priority;
    formProjectId = rule.projectId ?? '';
    formConditionsRaw = JSON.stringify(rule.conditions, null, 2);
    formActionsRaw = JSON.stringify(rule.actions, null, 2);
    formError = null;
    showModal = true;
  }

  function closeModal() {
    showModal = false;
    editingRule = null;
    formError = null;
  }

  function applyExampleConditions() {
    formConditionsRaw = EXAMPLE_CONDITIONS[formTrigger] ?? '{}';
  }

  async function saveRule() {
    formError = null;
    saving = true;

    // Validate JSON
    let conditions: Record<string, any>;
    let actions: Array<Record<string, any>>;
    try {
      conditions = JSON.parse(formConditionsRaw);
    } catch {
      formError = 'Conditions must be valid JSON';
      saving = false;
      return;
    }
    try {
      actions = JSON.parse(formActionsRaw);
      if (!Array.isArray(actions)) throw new Error('Actions must be a JSON array');
    } catch (e) {
      formError = 'Actions must be a valid JSON array';
      saving = false;
      return;
    }

    if (!formName.trim()) {
      formError = 'Name is required';
      saving = false;
      return;
    }

    try {
      if (editingRule) {
        const updated = await updateRule(editingRule.id, {
          name: formName.trim(),
          trigger: formTrigger,
          conditions,
          actions,
          enabled: formEnabled,
          priority: formPriority,
          projectId: formProjectId.trim() || null,
        });
        rules = rules.map(r => r.id === editingRule!.id ? updated : r);
        successMsg = `Rule "${updated.name}" saved`;
      } else {
        const created = await createRule({
          name: formName.trim(),
          trigger: formTrigger,
          conditions,
          actions,
          enabled: formEnabled,
          priority: formPriority,
          projectId: formProjectId.trim() || null,
        });
        rules = [...rules, created];
        successMsg = `Rule "${created.name}" created`;
      }
      closeModal();
      setTimeout(() => successMsg = null, 3000);
    } catch (err) {
      formError = err instanceof Error ? err.message : 'Failed to save rule';
    } finally {
      saving = false;
    }
  }

  async function handleDelete(rule: Rule) {
    if (rule.isBuiltIn) {
      error = 'Built-in rules cannot be deleted. Disable them instead.';
      return;
    }
    if (!confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    try {
      await deleteRule(rule.id);
      rules = rules.filter(r => r.id !== rule.id);
      successMsg = `Rule "${rule.name}" deleted`;
      setTimeout(() => successMsg = null, 3000);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete rule';
    }
  }

  function formatConditions(conditions: Record<string, any>): string {
    const parts = Object.entries(conditions).map(([k, v]) => {
      const val = Array.isArray(v) ? v.join(' | ') : String(v);
      return `${k} = ${val}`;
    });
    return parts.length > 0 ? parts.join(', ') : '(any)';
  }

  function formatActions(actions: Array<Record<string, any>>): string {
    return actions.map(a => {
      if (a.type === 'spawn_agent') return `spawn ${a.agentId ?? '?'}`;
      if (a.type === 'inject_context') return 'inject context';
      if (a.type === 'conflict_check') return 'conflict check';
      if (a.type === 'notify') return 'notify';
      return a.type ?? '?';
    }).join(', ');
  }

  function triggerLabel(trigger: string): string {
    return TRIGGER_OPTIONS.find(t => t.value === trigger)?.label ?? trigger;
  }

  onMount(loadRules);
</script>

<svelte:head>
  <title>Rules Engine — Mission Clawtrol</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 text-white p-6">
  <!-- Header -->
  <div class="max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-white flex items-center gap-2">
          ⚡ Rules Engine
        </h1>
        <p class="text-gray-400 text-sm mt-1">
          Automate your team's workflow — define what happens when tasks change.
        </p>
      </div>
      <button
        on:click={openCreateModal}
        class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
      >
        <span>+</span> New Rule
      </button>
    </div>

    <!-- Success / Error toasts -->
    {#if successMsg}
      <div class="mb-4 p-3 bg-green-900/60 border border-green-700 rounded-lg text-green-300 text-sm">
        ✅ {successMsg}
      </div>
    {/if}
    {#if error}
      <div class="mb-4 p-3 bg-red-900/60 border border-red-700 rounded-lg text-red-300 text-sm flex items-start justify-between gap-4">
        <span>❌ {error}</span>
        <button on:click={() => error = null} class="text-red-400 hover:text-red-200 shrink-0">✕</button>
      </div>
    {/if}

    {#if loading}
      <div class="text-gray-500 text-center py-16">Loading rules...</div>
    {:else if rules.length === 0}
      <div class="text-center py-16 text-gray-500">
        <p class="text-4xl mb-3">⚡</p>
        <p class="text-lg">No rules yet</p>
        <p class="text-sm mt-2">Create a rule to automate your workflow.</p>
      </div>
    {:else}
      <!-- Rules list -->
      <div class="space-y-3">
        {#each rules.sort((a, b) => a.priority - b.priority) as rule (rule.id)}
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-4 {rule.enabled ? '' : 'opacity-60'}">
            <!-- Priority badge -->
            <div class="text-xs text-gray-500 font-mono bg-gray-800 px-2 py-1 rounded shrink-0 mt-0.5">
              #{rule.priority}
            </div>

            <!-- Rule info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-white">{rule.name}</span>
                {#if rule.isBuiltIn}
                  <span class="text-xs bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded-full border border-purple-700">built-in</span>
                {/if}
                {#if rule.projectId}
                  <span class="text-xs bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded-full border border-blue-700">{rule.projectId}</span>
                {/if}
                {#if !rule.enabled}
                  <span class="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">disabled</span>
                {/if}
              </div>

              <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-400">
                <span class="flex items-center gap-1">
                  <span class="text-gray-600">WHEN</span>
                  <span class="text-yellow-400 font-mono text-xs">{triggerLabel(rule.trigger)}</span>
                </span>
                <span class="flex items-center gap-1">
                  <span class="text-gray-600">WHERE</span>
                  <span class="text-blue-300 font-mono text-xs">{formatConditions(rule.conditions)}</span>
                </span>
                <span class="flex items-center gap-1">
                  <span class="text-gray-600">THEN</span>
                  <span class="text-green-400 font-mono text-xs">{formatActions(rule.actions)}</span>
                </span>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2 shrink-0">
              <!-- Toggle enabled -->
              <button
                on:click={() => toggleEnabled(rule)}
                class="relative inline-flex items-center cursor-pointer"
                title={rule.enabled ? 'Disable rule' : 'Enable rule'}
              >
                <div class="w-9 h-5 rounded-full transition-colors {rule.enabled ? 'bg-blue-600' : 'bg-gray-700'}">
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform {rule.enabled ? 'translate-x-4' : ''}"></div>
                </div>
              </button>

              <!-- Edit (custom rules only) -->
              {#if !rule.isBuiltIn}
                <button
                  on:click={() => openEditModal(rule)}
                  class="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                  title="Edit rule"
                >
                  ✏️
                </button>
                <!-- Delete (custom rules only) -->
                <button
                  on:click={() => handleDelete(rule)}
                  class="text-gray-400 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                  title="Delete rule"
                >
                  🗑️
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Legend -->
      <div class="mt-6 p-4 bg-gray-900/50 border border-gray-800 rounded-xl text-xs text-gray-500">
        <p class="mb-1 font-medium text-gray-400">How rules work</p>
        <p><span class="text-yellow-400">WHEN</span> an event occurs → <span class="text-blue-300">WHERE</span> conditions match → <span class="text-green-400">THEN</span> actions execute</p>
        <p class="mt-1">Rules run in priority order (lower number = first). Built-in rules can be disabled but not deleted.</p>
      </div>
    {/if}
  </div>
</div>

<!-- Create / Edit Modal -->
{#if showModal}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4"
    on:click|self={closeModal}
    role="dialog"
    aria-modal="true"
    aria-label="Rule editor"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto z-50 shadow-2xl">
      <div class="p-6">
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-lg font-bold text-white">
            {editingRule ? 'Edit Rule' : 'New Rule'}
          </h2>
          <button on:click={closeModal} class="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        {#if formError}
          <div class="mb-4 p-3 bg-red-900/60 border border-red-700 rounded-lg text-red-300 text-sm">
            {formError}
          </div>
        {/if}

        <div class="space-y-4">
          <!-- Name -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1" for="rule-name">
              Rule Name <span class="text-red-400">*</span>
            </label>
            <input
              id="rule-name"
              type="text"
              bind:value={formName}
              placeholder="e.g., QA Review on Review"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <!-- Trigger + Priority row -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1" for="rule-trigger">
                Trigger (WHEN)
              </label>
              <select
                id="rule-trigger"
                bind:value={formTrigger}
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                {#each TRIGGER_OPTIONS as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1" for="rule-priority">
                Priority (lower = first)
              </label>
              <input
                id="rule-priority"
                type="number"
                bind:value={formPriority}
                min="1"
                max="9999"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <!-- Project ID (optional) -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1" for="rule-project">
              Project ID <span class="text-gray-500">(optional — leave blank for global)</span>
            </label>
            <input
              id="rule-project"
              type="text"
              bind:value={formProjectId}
              placeholder="e.g., mission-clawtrol"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <!-- Conditions -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium text-gray-300" for="rule-conditions">
                Conditions (WHERE) — JSON
              </label>
              <button
                on:click={applyExampleConditions}
                class="text-xs text-blue-400 hover:text-blue-300"
              >
                Insert example
              </button>
            </div>
            <textarea
              id="rule-conditions"
              bind:value={formConditionsRaw}
              rows="4"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
              placeholder={"{ \"task.status.to\": \"review\" }"}
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">
              Keys: <code>task.status.to</code>, <code>task.status.from</code>, <code>task.type</code>, <code>task.projectId</code>, <code>task.agentId</code>.
              Use arrays for OR matching: <code>"task.type": ["development", "bug"]</code>
            </p>
          </div>

          <!-- Actions -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-sm font-medium text-gray-300" for="rule-actions">
                Actions (THEN) — JSON array
              </label>
              <div class="flex gap-2">
                {#each Object.keys(EXAMPLE_ACTIONS) as key}
                  <button
                    on:click={() => formActionsRaw = EXAMPLE_ACTIONS[key]}
                    class="text-xs text-blue-400 hover:text-blue-300"
                  >
                    {key}
                  </button>
                {/each}
              </div>
            </div>
            <textarea
              id="rule-actions"
              bind:value={formActionsRaw}
              rows="5"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
              placeholder={"[{ \"type\": \"spawn_agent\", \"agentId\": \"qa\", \"template\": \"qa-review\" }]"}
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">
              Types: <code>spawn_agent</code>, <code>inject_context</code>, <code>notify</code>, <code>warn</code>.
            </p>
          </div>

          <!-- Enabled toggle -->
          <div class="flex items-center gap-3">
            <button
              on:click={() => formEnabled = !formEnabled}
              class="relative inline-flex items-center cursor-pointer"
            >
              <div class="w-9 h-5 rounded-full transition-colors {formEnabled ? 'bg-blue-600' : 'bg-gray-700'}">
                <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform {formEnabled ? 'translate-x-4' : ''}"></div>
              </div>
            </button>
            <span class="text-sm text-gray-300">Rule enabled</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-800">
          <button
            on:click={closeModal}
            class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            on:click={saveRule}
            disabled={saving}
            class="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : editingRule ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
