<!-- Mission Clawtrol - Deliverables Browser -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchDeliverables, fetchProjects, reviewDeliverable, deleteDeliverable, type Deliverable, type DeliverableStatus, type Project } from '$lib/api';

  let deliverables: Deliverable[] = [];
  let projects: Project[] = [];
  let loading = true;

  // Filters
  let filterStatus: DeliverableStatus | '' = '';
  let filterProject = '';
  let filterAgent = '';
  let searchQuery = '';

  // Preview / review state
  let previewDeliverable: Deliverable | null = null;
  let reviewingId: string | null = null;
  let reviewFeedback = '';

  $: uniqueAgents = [...new Set(deliverables.map(d => d.agentId).filter(Boolean))] as string[];

  $: filtered = deliverables.filter(d => {
    if (filterStatus && d.status !== filterStatus) return false;
    if (filterProject && d.projectId !== filterProject) return false;
    if (filterAgent && d.agentId !== filterAgent) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !(d.content || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  $: pendingReview = deliverables.filter(d => d.status === 'review').length;

  async function loadData() {
    loading = true;
    [deliverables, projects] = await Promise.all([
      fetchDeliverables(),
      fetchProjects(),
    ]);
    loading = false;
  }

  async function handleReview(id: string, action: 'approved' | 'rejected' | 'changes_requested') {
    await reviewDeliverable(id, action, reviewFeedback || undefined);
    reviewFeedback = '';
    reviewingId = null;
    if (previewDeliverable?.id === id) {
      // Refresh the preview
      const updated = deliverables.find(d => d.id === id);
      if (updated) previewDeliverable = { ...updated, status: action };
    }
    await loadData();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this deliverable? This cannot be undone.')) return;
    await deleteDeliverable(id);
    if (previewDeliverable?.id === id) previewDeliverable = null;
    await loadData();
  }

  function getStatusBadge(status: DeliverableStatus): { label: string; classes: string } {
    switch (status) {
      case 'draft': return { label: '📝 Draft', classes: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
      case 'review': return { label: '🔍 Review', classes: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
      case 'approved': return { label: '✅ Approved', classes: 'bg-green-500/20 text-green-300 border-green-500/30' };
      case 'rejected': return { label: '❌ Rejected', classes: 'bg-red-500/20 text-red-300 border-red-500/30' };
      case 'changes_requested': return { label: '🔄 Changes', classes: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
    }
  }

  function getTypeIcon(type: Deliverable['type']): string {
    switch (type) {
      case 'markdown': return '📄';
      case 'text': return '📃';
      case 'csv': return '📊';
      case 'html': return '🌐';
      case 'pdf': return '📑';
      default: return '📎';
    }
  }

  function getProjectName(id: string | null): string {
    if (!id) return '—';
    return projects.find(p => p.id === id)?.name || id;
  }

  function renderMarkdown(md: string): string {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-4 mb-1">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-1">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="bg-slate-600 px-1 rounded text-xs font-mono">$1</code>')
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="bg-slate-700 rounded p-3 my-2 text-xs overflow-x-auto whitespace-pre-wrap"><code>$1</code></pre>')
      .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
      .replace(/^---$/gm, '<hr class="border-slate-600 my-3" />')
      .replace(/\n\n+/g, '</p><p class="mb-2">')
      .replace(/\n/g, '<br/>');
  }

  function downloadDeliverable(d: Deliverable) {
    const ext = d.type === 'markdown' ? 'md' : d.type === 'csv' ? 'csv' : 'txt';
    const blob = new Blob([d.content || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.title.replace(/[^a-z0-9_\-]/gi, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  onMount(loadData);
</script>

<div class="space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between gap-4 flex-wrap">
    <div>
      <h1 class="text-2xl font-semibold">📦 Deliverables</h1>
      <p class="text-sm text-slate-400 mt-0.5">Files, reports, and documents produced by agents</p>
    </div>
    {#if pendingReview > 0}
      <div class="px-4 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg text-purple-300 text-sm font-medium">
        🔍 {pendingReview} pending review
      </div>
    {/if}
  </div>

  <!-- Filters -->
  <div class="flex flex-wrap gap-2 items-center">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search deliverables..."
      class="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500 w-56 placeholder-slate-500"
    />

    <select bind:value={filterStatus} class="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500">
      <option value="">All Statuses</option>
      <option value="draft">📝 Draft</option>
      <option value="review">🔍 Review</option>
      <option value="approved">✅ Approved</option>
      <option value="rejected">❌ Rejected</option>
      <option value="changes_requested">🔄 Changes Requested</option>
    </select>

    <select bind:value={filterProject} class="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500">
      <option value="">All Projects</option>
      {#each projects as p}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>

    {#if uniqueAgents.length > 0}
      <select bind:value={filterAgent} class="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500">
        <option value="">All Agents</option>
        {#each uniqueAgents as a}
          <option value={a}>{a}</option>
        {/each}
      </select>
    {/if}

    {#if filterStatus || filterProject || filterAgent || searchQuery}
      <button
        on:click={() => { filterStatus = ''; filterProject = ''; filterAgent = ''; searchQuery = ''; }}
        class="px-3 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-600 rounded transition-colors"
      >✕ Clear</button>
    {/if}
  </div>

  <!-- Main content: list + preview side panel -->
  {#if loading}
    <div class="text-center py-12 text-slate-500">
      <div class="text-3xl mb-2">⏳</div>
      <div>Loading deliverables...</div>
    </div>
  {:else if filtered.length === 0}
    <div class="text-center py-16 text-slate-500">
      <div class="text-4xl mb-3">📦</div>
      <p class="text-lg font-medium">No deliverables yet</p>
      <p class="text-sm mt-1">When agents complete work, their output will appear here.</p>
    </div>
  {:else}
    <div class="flex gap-4">
      <!-- Deliverables list -->
      <div class="flex-1 space-y-2 min-w-0">
        {#each filtered as d (d.id)}
          {@const badge = getStatusBadge(d.status)}
          <div
            class="bg-slate-800 border rounded-lg p-4 cursor-pointer transition-all hover:border-slate-500 {previewDeliverable?.id === d.id ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-slate-600'}"
            on:click={() => { previewDeliverable = previewDeliverable?.id === d.id ? null : d; }}
            role="button"
            tabindex="0"
            on:keydown={(e) => e.key === 'Enter' && (previewDeliverable = previewDeliverable?.id === d.id ? null : d)}
          >
            <div class="flex items-start gap-3">
              <span class="text-xl flex-shrink-0 mt-0.5">{getTypeIcon(d.type)}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-start gap-2 flex-wrap">
                  <p class="font-semibold text-slate-100">{d.title}</p>
                  <span class="text-xs px-2 py-0.5 rounded border {badge.classes} flex-shrink-0">{badge.label}</span>
                </div>
                <div class="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                  {#if d.agentId}<span>🤖 {d.agentId}</span>{/if}
                  {#if d.projectId}<span>📁 {getProjectName(d.projectId)}</span>{/if}
                  <span>{new Date(d.createdAt).toLocaleString()}</span>
                </div>
                {#if d.feedback}
                  <div class="mt-2 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-300">
                    💬 {d.feedback}
                  </div>
                {/if}
              </div>
              <!-- Action buttons -->
              <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
              <div class="flex items-center gap-1 flex-shrink-0" on:click|stopPropagation role="none">
                {#if d.content}
                  <button
                    on:click={() => downloadDeliverable(d)}
                    class="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                    title="Download"
                  >⬇</button>
                {/if}
                {#if d.status === 'review'}
                  <button
                    on:click={() => { reviewingId = reviewingId === d.id ? null : d.id; reviewFeedback = ''; previewDeliverable = d; }}
                    class="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 rounded text-white"
                  >📋 Review</button>
                {/if}
                <button
                  on:click={() => handleDelete(d.id)}
                  class="text-xs px-2 py-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                  title="Delete"
                >✕</button>
              </div>
            </div>

            <!-- Inline review panel -->
            {#if reviewingId === d.id}
              <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
              <div class="mt-3 pt-3 border-t border-slate-600" on:click|stopPropagation role="none">
                <p class="text-xs text-slate-400 mb-2">Review "{d.title}"</p>
                <input
                  type="text"
                  bind:value={reviewFeedback}
                  placeholder="Optional feedback for the agent..."
                  class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 mb-2"
                />
                <div class="flex gap-2 flex-wrap">
                  <button on:click={() => handleReview(d.id, 'approved')} class="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm text-white font-medium">✅ Approve</button>
                  <button on:click={() => handleReview(d.id, 'changes_requested')} class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 rounded text-sm text-white font-medium">🔄 Request Changes</button>
                  <button on:click={() => handleReview(d.id, 'rejected')} class="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm text-white font-medium">❌ Reject</button>
                  <button on:click={() => { reviewingId = null; reviewFeedback = ''; }} class="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-sm">Cancel</button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Preview side panel -->
      {#if previewDeliverable}
        <div class="w-[480px] flex-shrink-0 bg-slate-800 border border-slate-600 rounded-lg flex flex-col max-h-[calc(100vh-200px)] sticky top-4">
          <div class="px-4 py-3 border-b border-slate-600 flex items-center justify-between">
            <div>
              <p class="font-semibold text-slate-100">{previewDeliverable.title}</p>
              <p class="text-xs text-slate-500 capitalize">{previewDeliverable.type} · {new Date(previewDeliverable.createdAt).toLocaleDateString()}</p>
            </div>
            <div class="flex items-center gap-2">
              {#if previewDeliverable.content}
                <button on:click={() => downloadDeliverable(previewDeliverable!)} class="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded">⬇ Download</button>
              {/if}
              <button on:click={() => previewDeliverable = null} class="text-slate-400 hover:text-slate-200 text-lg leading-none">×</button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto p-4">
            {#if previewDeliverable.content}
              {#if previewDeliverable.type === 'markdown'}
                <div class="prose prose-invert prose-sm max-w-none text-slate-200 text-sm leading-relaxed">
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html '<p class="mb-2">' + renderMarkdown(previewDeliverable.content) + '</p>'}
                </div>
              {:else if previewDeliverable.type === 'csv'}
                <div class="overflow-x-auto">
                  <table class="text-xs w-full border-collapse">
                    {#each previewDeliverable.content.trim().split('\n') as row, i}
                      <tr class="{i === 0 ? 'font-semibold bg-slate-600' : 'even:bg-slate-700/40'}">
                        {#each row.split(',') as cell}
                          <td class="border border-slate-600 px-2 py-1 text-slate-200">{cell.trim()}</td>
                        {/each}
                      </tr>
                    {/each}
                  </table>
                </div>
              {:else}
                <pre class="text-sm text-slate-300 whitespace-pre-wrap">{previewDeliverable.content}</pre>
              {/if}
            {:else if previewDeliverable.filePath}
              <p class="text-sm text-slate-400">📂 File: <code class="bg-slate-700 px-2 py-0.5 rounded text-xs">{previewDeliverable.filePath}</code></p>
            {:else}
              <p class="text-slate-500 text-sm italic">No content available for preview.</p>
            {/if}

            {#if previewDeliverable.feedback}
              <div class="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded text-sm text-amber-300">
                <strong>Feedback:</strong> {previewDeliverable.feedback}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
