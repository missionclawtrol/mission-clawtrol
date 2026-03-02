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

  // Filter state: 'all' | 'event' | 'scheduled'
  let activeFilter: 'all' | 'event' | 'scheduled' = 'all';

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
  let formSchedule = '';
  let formError: string | null = null;

  const EVENT_TRIGGERS = [
    { value: 'task.status.changed', label: 'Task Status Changed' },
    { value: 'task.created', label: 'Task Created' },
    { value: 'task.assigned', label: 'Task Assigned' },
    { value: 'agent.session.started', label: 'Agent Session Started' },
  ];

  const TRIGGER_OPTIONS = [
    ...EVENT_TRIGGERS,
    { value: 'cron', label: '⏱ Scheduled (Cron)' },
  ];

  const EXAMPLE_CONDITIONS: Record<string, string> = {
    'task.status.changed': JSON.stringify({ 'task.status.to': 'review', 'task.type': ['development', 'bug'] }, null, 2),
    'task.created': JSON.stringify({ 'task.projectId': 'my-project' }, null, 2),
    'task.assigned': JSON.stringify({}, null, 2),
    'agent.session.started': JSON.stringify({}, null, 2),
    'cron': JSON.stringify({}, null, 2),
  };

  const EXAMPLE_ACTIONS: Record<string, string> = {
    spawn_agent: JSON.stringify([{ type: 'spawn_agent', agentId: 'qa', template: 'qa-review' }], null, 2),
    inject_context: JSON.stringify([{ type: 'inject_context', content: '## Extra Instructions\n- Always check X\n- Never do Y' }], null, 2),
    notify: JSON.stringify([{ type: 'notify', message: 'Task moved to review!' }], null, 2),
  };

  const CRON_EXAMPLES = [
    { label: 'Every day at 8PM', value: '0 20 * * *' },
    { label: 'Every day at 5PM', value: '0 17 * * *' },
    { label: 'Every Mon at 9AM', value: '0 9 * * 1' },
    { label: 'Every hour', value: '0 * * * *' },
  ];

  // ── Derived ──────────────────────────────────────────────────

  $: filteredRules = (() => {
    switch (activeFilter) {
      case 'event':
        return rules.filter(r => r.trigger !== 'cron');
      case 'scheduled':
        return rules.filter(r => r.trigger === 'cron');
      default:
        return rules;
    }
  })();

  $: eventCount = rules.filter(r => r.trigger !== 'cron').length;
  $: scheduledCount = rules.filter(r => r.trigger === 'cron').length;

  $: isCronTrigger = formTrigger === 'cron';

  // ── Helpers ──────────────────────────────────────────────────

  function relativeTime(iso: string | null | undefined): string {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // Basic client-side cron validation (5-field standard format)
  function validateCronExpression(expr: string): boolean {
    if (!expr.trim()) return false;
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    // Very basic: each field is non-empty
    return parts.every(p => p.length > 0);
  }

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
    formSchedule = '';
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
    formSchedule = rule.schedule ?? '';
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

    // Validate schedule for cron rules
    if (formTrigger === 'cron') {
      if (!formSchedule.trim()) {
        formError = 'Schedule (cron expression) is required for scheduled rules';
        saving = false;
        return;
      }
      if (!validateCronExpression(formSchedule)) {
        formError = 'Invalid cron expression. Use 5-field format: minute hour day month weekday (e.g. 0 20 * * *)';
        saving = false;
        return;
      }
    }

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
          schedule: formTrigger === 'cron' ? formSchedule.trim() : null,
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
          schedule: formTrigger === 'cron' ? formSchedule.trim() : null,
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

  function formatConditionValue(k: string, v: any): string {
    // Handle $in / $nin operator objects: { $in: [...] } or { $nin: [...] }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v && Array.isArray(v.$in)) {
        return `${k} in ${v.$in.join(', ')}`;
      }
      if ('$nin' in v && Array.isArray(v.$nin)) {
        return `${k} not in ${v.$nin.join(', ')}`;
      }
      // Unknown operator object — show as JSON
      return `${k} = ${JSON.stringify(v)}`;
    }
    // Plain array — treat as OR / "in" shorthand
    if (Array.isArray(v)) {
      return `${k} in ${v.join(' | ')}`;
    }
    return `${k} = ${String(v)}`;
  }

  function formatConditions(conditions: Record<string, any>): string {
    const parts = Object.entries(conditions).map(([k, v]) => formatConditionValue(k, v));
    return parts.length > 0 ? parts.join(', ') : '(any)';
  }

  function formatActions(actions: Array<Record<string, any>>): string {
    return actions.map(a => {
      if (a.type === 'spawn_agent') return `spawn ${a.agentId ?? '?'}`;
      if (a.type === 'inject_context') return 'inject context';
      if (a.type === 'conflict_check') return 'conflict check';
      if (a.type === 'notify') return 'notify';
      if (a.type === 'word_count_cost') return 'word-count cost';
      if (a.type === 'post_comment') return 'post comment';
      return a.type ?? '?';
    }).join(', ');
  }

  function triggerLabel(trigger: string): string {
    if (trigger === 'cron') return 'Scheduled (Cron)';
    return EVENT_TRIGGERS.find(t => t.value === trigger)?.label ?? trigger;
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
          Automate your team's workflow — event-based and scheduled rules in one engine.
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

    <!-- Filter tabs -->
    {#if !loading && rules.length > 0}
      <div class="flex gap-1 mb-5 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit">
        <button
          on:click={() => activeFilter = 'all'}
          class="px-4 py-1.5 text-sm rounded-lg transition-colors font-medium {activeFilter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}"
        >
          All <span class="ml-1 text-xs text-gray-500">{rules.length}</span>
        </button>
        <button
          on:click={() => activeFilter = 'event'}
          class="px-4 py-1.5 text-sm rounded-lg transition-colors font-medium {activeFilter === 'event' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}"
        >
          ⚡ Event <span class="ml-1 text-xs text-gray-500">{eventCount}</span>
        </button>
        <button
          on:click={() => activeFilter = 'scheduled'}
          class="px-4 py-1.5 text-sm rounded-lg transition-colors font-medium {activeFilter === 'scheduled' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}"
        >
          ⏱ Scheduled <span class="ml-1 text-xs text-gray-500">{scheduledCount}</span>
        </button>
      </div>
    {/if}

    {#if loading}
      <div class="text-gray-500 text-center py-16">Loading rules...</div>
    {:else if filteredRules.length === 0}
      <div class="text-center py-16 text-gray-500">
        <p class="text-4xl mb-3">{activeFilter === 'scheduled' ? '⏱' : '⚡'}</p>
        <p class="text-lg">No {activeFilter === 'all' ? '' : activeFilter + ' '}rules yet</p>
        {#if activeFilter === 'all'}
          <p class="text-sm mt-2">Create a rule to automate your workflow.</p>
        {:else}
          <button on:click={() => activeFilter = 'all'} class="mt-3 text-sm text-blue-400 hover:text-blue-300">
            Show all rules →
          </button>
        {/if}
      </div>
    {:else}
      <!-- Rules list -->
      <div class="space-y-3">
        {#each filteredRules.sort((a, b) => a.priority - b.priority) as rule (rule.id)}
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-4 {rule.enabled ? '' : 'opacity-60'}">
            <!-- Priority badge -->
            <div class="text-xs text-gray-500 font-mono bg-gray-800 px-2 py-1 rounded shrink-0 mt-0.5">
              #{rule.priority}
            </div>

            <!-- Rule info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-white">{rule.name}</span>

                <!-- Trigger type badge -->
                {#if rule.trigger === 'cron'}
                  <span class="text-xs bg-orange-900/60 text-orange-300 px-2 py-0.5 rounded-full border border-orange-700 flex items-center gap-1">
                    ⏱ Scheduled
                  </span>
                {:else}
                  <span class="text-xs bg-yellow-900/40 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-800 flex items-center gap-1">
                    ⚡ Event
                  </span>
                {/if}

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
                {#if rule.trigger === 'cron'}
                  <!-- Cron rule: show schedule + lastRunAt -->
                  <span class="flex items-center gap-1">
                    <span class="text-gray-600">SCHEDULE</span>
                    <span class="text-orange-300 font-mono text-xs">{rule.schedule ?? '(none)'}</span>
                  </span>
                  <span class="flex items-center gap-1">
                    <span class="text-gray-600">LAST RUN</span>
                    <span class="text-gray-400 text-xs">{relativeTime(rule.lastRunAt)}</span>
                  </span>
                {:else}
                  <!-- Event rule: show trigger + conditions -->
                  <span class="flex items-center gap-1">
                    <span class="text-gray-600">WHEN</span>
                    <span class="text-yellow-400 font-mono text-xs">{triggerLabel(rule.trigger)}</span>
                  </span>
                  <span class="flex items-center gap-1">
                    <span class="text-gray-600">WHERE</span>
                    <span class="text-blue-300 font-mono text-xs">{formatConditions(rule.conditions)}</span>
                  </span>
                {/if}
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
        <p>
          <span class="text-yellow-400">⚡ Event rules</span>: WHEN trigger fires → WHERE conditions match → THEN actions execute
        </p>
        <p class="mt-1">
          <span class="text-orange-300">⏱ Scheduled rules</span>: Fire on cron schedule → THEN actions execute (agent spawns)
        </p>
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

          <!-- Trigger type selector -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Trigger Type
            </label>
            <div class="flex gap-2 mb-3">
              <button
                type="button"
                on:click={() => { formTrigger = 'task.status.changed'; formSchedule = ''; }}
                class="flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors {formTrigger !== 'cron' ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}"
              >
                ⚡ Event-based
              </button>
              <button
                type="button"
                on:click={() => { formTrigger = 'cron'; formConditionsRaw = '{}'; }}
                class="flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors {formTrigger === 'cron' ? 'bg-orange-900/40 border-orange-700 text-orange-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}"
              >
                ⏱ Scheduled (Cron)
              </button>
            </div>
          </div>

          <!-- Event trigger selector (only when not cron) -->
          {#if !isCronTrigger}
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-1" for="rule-trigger">
                  Event (WHEN)
                </label>
                <select
                  id="rule-trigger"
                  bind:value={formTrigger}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {#each EVENT_TRIGGERS as opt}
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
          {:else}
            <!-- Priority (when cron, full width) -->
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1" for="rule-priority-cron">
                Priority (lower = first)
              </label>
              <input
                id="rule-priority-cron"
                type="number"
                bind:value={formPriority}
                min="1"
                max="9999"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          {/if}

          <!-- Cron schedule input (only for cron trigger) -->
          {#if isCronTrigger}
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1" for="rule-schedule">
                Cron Schedule <span class="text-red-400">*</span>
              </label>
              <input
                id="rule-schedule"
                type="text"
                bind:value={formSchedule}
                placeholder="e.g. 0 20 * * *"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-orange-500"
              />
              <div class="flex flex-wrap gap-2 mt-2">
                {#each CRON_EXAMPLES as ex}
                  <button
                    type="button"
                    on:click={() => formSchedule = ex.value}
                    class="text-xs bg-gray-800 text-orange-300 px-2 py-1 rounded border border-gray-700 hover:border-orange-700 transition-colors"
                  >
                    {ex.label} <code class="ml-1 opacity-70">{ex.value}</code>
                  </button>
                {/each}
              </div>
              <p class="text-xs text-gray-500 mt-1">
                5-field cron: <code>minute hour day-of-month month day-of-week</code>.
                Powered by node-cron.
              </p>
            </div>
          {/if}

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

          <!-- Conditions (hidden for cron rules since they're time-driven) -->
          {#if !isCronTrigger}
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
          {/if}

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
              placeholder={"[{ \"type\": \"spawn_agent\", \"agentId\": \"cso\", \"template\": \"daily-summary\", \"prompt\": \"Summarize today's work...\" }]"}
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">
              {#if isCronTrigger}
                For scheduled rules: use <code>spawn_agent</code> with a <code>prompt</code> field. Example: <code>[{`{"type":"spawn_agent","agentId":"cso","prompt":"Do the thing..."}`}]</code>
              {:else}
                Types: <code>spawn_agent</code>, <code>inject_context</code>, <code>notify</code>, <code>warn</code>.
              {/if}
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
