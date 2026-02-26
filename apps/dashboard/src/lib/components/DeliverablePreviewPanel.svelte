<!--
  DeliverablePreviewPanel — Slide-out preview drawer for the deliverables page.

  Props:
    deliverable  – the Deliverable record to preview (null = closed)
    onClose      – called when user closes the panel
    onReview     – called with (action, feedback) when user approves/sends back/rejects
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE, type Deliverable, type DeliverableStatus } from '$lib/api';

  // ── Props ─────────────────────────────────────────────────────────────────
  export let deliverable: Deliverable | null = null;
  export let onClose: () => void = () => {};
  export let onReview: (action: 'approved' | 'rejected' | 'changes_requested', feedback?: string) => void = () => {};

  // ── Internal state ────────────────────────────────────────────────────────
  let loading = false;
  let loadError = '';

  // For CSV
  let csvHeaders: string[] = [];
  let csvAllRows: string[][] = [];
  let csvTruncated = false;
  let sortCol = -1;
  let sortDir: 'asc' | 'desc' = 'asc';

  // For DOCX
  let docxHtml = '';

  // For Markdown/text inline
  let textContent = '';

  // For PDF
  let pdfUrl = '';

  // Action bar
  let sendBackOpen = false;
  let feedback = '';
  let actionBusy = false;

  // Animation
  let visible = false;

  // ── Constants ─────────────────────────────────────────────────────────────
  const MAX_CSV_ROWS = 500;

  // ── Derived: detect rendering mode ───────────────────────────────────────
  function detectRenderMode(d: Deliverable): 'csv' | 'docx' | 'markdown' | 'pdf' | 'image' | 'text' | 'none' {
    // Check filePath extension first (most authoritative)
    if (d.filePath) {
      const ext = d.filePath.split('.').pop()?.toLowerCase() ?? '';
      if (ext === 'csv') return 'csv';
      if (ext === 'docx') return 'docx';
      if (ext === 'pdf') return 'pdf';
      if (ext === 'md' || ext === 'markdown') return 'markdown';
      if (ext === 'txt' || ext === 'text') return 'text';
      if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'image';
    }
    // Fall back to the stored type field
    if (d.type === 'csv') return 'csv';
    if (d.type === 'docx') return 'docx';
    if (d.type === 'pdf') return 'pdf';
    if (d.type === 'markdown') return 'markdown';
    if (d.type === 'text') return 'text';
    // If it has inline content (legacy), at least render it as text
    // (by this point d.type is 'html'|'other' — csv/markdown/etc already handled above)
    if (d.content) return 'text';
    return 'none';
  }

  // ── Load preview when deliverable changes ─────────────────────────────────
  let currentId = '';

  // Plain (non-reactive) snapshot of the current deliverable.
  // Svelte 5 re-wraps props as reactive proxies even when the parent passes a
  // plain object — accessing .filePath or .content through the proxy can return
  // the getter function instead of the string value.  Deep-cloning via
  // JSON.parse(JSON.stringify()) fully escapes the proxy before we use the
  // values in async functions or template expressions.
  let plainDeliverable: Deliverable | null = null;

  $: if (deliverable) {
    if (deliverable.id !== currentId) {
      currentId = deliverable.id;
      resetState();
      plainDeliverable = JSON.parse(JSON.stringify(deliverable)) as Deliverable;
      loadPreview(plainDeliverable);
      // Trigger slide-in animation
      requestAnimationFrame(() => { visible = true; });
    }
  } else {
    visible = false;
    setTimeout(() => {
      resetState();
      currentId = '';
    }, 300); // match transition duration
  }

  function resetState() {
    loading = false;
    loadError = '';
    csvHeaders = [];
    csvAllRows = [];
    csvTruncated = false;
    sortCol = -1;
    sortDir = 'asc';
    docxHtml = '';
    textContent = '';
    pdfUrl = '';
    sendBackOpen = false;
    feedback = '';
    actionBusy = false;
  }

  async function loadPreview(d: Deliverable) {
    const mode = detectRenderMode(d);

    // If content is inline, use it directly for CSV/Markdown/text
    // Guard: ensure content is a plain string (not a Svelte reactive proxy)
    const inlineContent = typeof d.content === 'string' ? d.content : '';
    if (inlineContent && !d.filePath) {
      if (mode === 'csv') { parseCSV(inlineContent); return; }
      if (mode === 'markdown' || mode === 'text') { textContent = inlineContent; return; }
    }

    // For PDF, just set the URL (iframe will fetch it)
    if (mode === 'pdf') {
      pdfUrl = d.filePath ? `${API_BASE}/deliverables/${d.id}/serve` : '';
      return;
    }

    // For image, just use serve URL
    if (mode === 'image') {
      pdfUrl = d.filePath ? `${API_BASE}/deliverables/${d.id}/serve` : '';
      return;
    }

    // All other modes need to fetch the file
    if (!d.filePath) {
      if (d.content) {
        if (mode === 'csv') { parseCSV(d.content); return; }
        textContent = d.content;
      }
      return;
    }

    loading = true;
    loadError = '';
    try {
      if (mode === 'docx') {
        await loadDocx(d);
      } else if (mode === 'csv') {
        const res = await fetch(`${API_BASE}/deliverables/${d.id}/serve`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        parseCSV(text);
      } else if (mode === 'markdown' || mode === 'text') {
        const res = await fetch(`${API_BASE}/deliverables/${d.id}/serve`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        textContent = await res.text();
      }
    } catch (e: any) {
      loadError = e.message || 'Failed to load file';
    } finally {
      loading = false;
    }
  }

  async function loadDocx(d: Deliverable) {
    const res = await fetch(`${API_BASE}/deliverables/${d.id}/serve`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    // Dynamically import mammoth so it only loads when needed
    const mammoth = await import('mammoth');
    const result = await (mammoth as any).default
      ? (mammoth as any).default.convertToHtml({ arrayBuffer: buffer })
      : (mammoth as any).convertToHtml({ arrayBuffer: buffer });
    docxHtml = result.value;
  }

  // ── CSV parsing ───────────────────────────────────────────────────────────
  function parseCSV(text: string) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length === 0) return;

    csvHeaders = parseCSVLine(lines[0]);
    const dataLines = lines.slice(1);
    csvTruncated = dataLines.length > MAX_CSV_ROWS;
    csvAllRows = dataLines.slice(0, MAX_CSV_ROWS).map(parseCSVLine);
  }

  /** Parse a single CSV line handling quoted fields */
  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  // ── CSV sorting ───────────────────────────────────────────────────────────
  $: sortedRows = sortCol >= 0
    ? [...csvAllRows].sort((a, b) => {
        const va = a[sortCol] ?? '';
        const vb = b[sortCol] ?? '';
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb);
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : csvAllRows;

  function toggleSort(col: number) {
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = 'asc';
    }
  }

  // ── Markdown renderer ─────────────────────────────────────────────────────
  function renderMarkdown(md: string): string {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1 text-slate-100">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-4 mb-1 text-slate-100">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-1 text-slate-100">$1</h1>')
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

  // ── Helpers ───────────────────────────────────────────────────────────────
  function downloadDeliverable() {
    if (!deliverable) return;
    if (deliverable.filePath) {
      const a = document.createElement('a');
      a.href = `${API_BASE}/deliverables/${deliverable.id}/download`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else if (deliverable.content) {
      const ext = deliverable.type === 'markdown' ? 'md' : deliverable.type === 'csv' ? 'csv' : 'txt';
      const blob = new Blob([deliverable.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deliverable.title.replace(/[^a-z0-9_\-]/gi, '_')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  function getFileTypeBadge(d: Deliverable): string {
    const mode = detectRenderMode(d);
    const labels: Record<string, string> = {
      csv: '📊 CSV', docx: '📝 DOCX', pdf: '📑 PDF',
      markdown: '📄 Markdown', text: '📃 Text', image: '🖼 Image', none: '📎 File',
    };
    return labels[mode] ?? '📎 File';
  }

  function getStatusBadgeClasses(status: DeliverableStatus): string {
    switch (status) {
      case 'draft': return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
      case 'pending_review': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'review': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'approved': return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'rejected': return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'changes_requested': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      default: return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    }
  }

  function getStatusLabel(status: DeliverableStatus): string {
    switch (status) {
      case 'draft': return '📝 Draft';
      case 'pending_review': return '🔍 Pending Review';
      case 'review': return '🔍 Review';
      case 'approved': return '✅ Approved';
      case 'rejected': return '❌ Rejected';
      case 'changes_requested': return '🔄 Changes Requested';
      default: return '📎 ' + status;
    }
  }

  async function handleAction(action: 'approved' | 'rejected' | 'changes_requested') {
    actionBusy = true;
    try {
      onReview(action, feedback || undefined);
      feedback = '';
      sendBackOpen = false;
    } finally {
      actionBusy = false;
    }
  }

  // ── Keyboard / click-outside handling ────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).dataset.backdrop === 'true') onClose();
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<!-- Backdrop + panel wrapper -->
{#if deliverable}
  <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
  <div
    class="fixed inset-0 z-40 flex justify-end"
    data-backdrop="true"
    on:click={handleBackdropClick}
  >
    <!-- Semi-transparent backdrop -->
    <div
      class="absolute inset-0 bg-black/40 transition-opacity duration-300"
      class:opacity-0={!visible}
      class:opacity-100={visible}
    ></div>

    <!-- Slide-in panel -->
    <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
    <div
      class="relative z-50 flex flex-col bg-slate-900 border-l border-slate-700 shadow-2xl
             w-full sm:w-1/2 xl:w-[48%] max-w-3xl h-full
             transition-transform duration-300 ease-out"
      class:translate-x-full={!visible}
      class:translate-x-0={visible}
      on:click|stopPropagation
    >
      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <div class="flex items-start gap-3 px-5 py-4 border-b border-slate-700 bg-slate-800/60 flex-shrink-0">
        <div class="flex-1 min-w-0">
          <h2 class="font-semibold text-slate-100 text-base leading-tight truncate" title={deliverable.title}>
            {deliverable.title}
          </h2>
          <div class="flex flex-wrap items-center gap-2 mt-1.5">
            {#if deliverable.agentId}
              <span class="text-xs px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded">
                🤖 {deliverable.agentId}
              </span>
            {/if}
            <span class="text-xs px-2 py-0.5 bg-slate-600/60 border border-slate-600 text-slate-300 rounded">
              {getFileTypeBadge(deliverable)}
            </span>
            <span class="text-xs px-2 py-0.5 rounded border {getStatusBadgeClasses(deliverable.status)}">
              {getStatusLabel(deliverable.status)}
            </span>
            <span class="text-xs text-slate-500">
              {new Date(deliverable.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
        <button
          on:click={onClose}
          class="flex-shrink-0 text-slate-400 hover:text-slate-100 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-slate-700 transition-colors"
          title="Close (Esc)"
        >×</button>
      </div>

      <!-- ── Action bar ──────────────────────────────────────────────────── -->
      <div class="px-5 py-3 border-b border-slate-700 bg-slate-800/40 flex-shrink-0">
        <div class="flex flex-wrap items-center gap-2">
          {#if deliverable.status === 'review' || deliverable.status === 'pending_review'}
            <button
              on:click={() => handleAction('approved')}
              disabled={actionBusy}
              class="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm text-white font-medium transition-colors"
            >✅ Approve</button>
            <button
              on:click={() => { sendBackOpen = !sendBackOpen; feedback = ''; }}
              disabled={actionBusy}
              class="px-3 py-1.5 rounded text-sm font-medium transition-colors
                     {sendBackOpen ? 'bg-amber-600 hover:bg-amber-500' : 'bg-amber-600/80 hover:bg-amber-600'} text-white disabled:opacity-50"
            >↩ Send Back</button>
          {/if}
          {#if deliverable.content || deliverable.filePath}
            <button
              on:click={downloadDeliverable}
              class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-200 font-medium transition-colors"
            >⬇ Download</button>
          {/if}
        </div>

        <!-- Send Back feedback textarea — inline expand -->
        {#if sendBackOpen}
          <div class="mt-3">
            <textarea
              bind:value={feedback}
              placeholder="Describe what needs to change…"
              rows="3"
              class="w-full bg-slate-700 border border-amber-500/40 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
            ></textarea>
            <div class="flex gap-2 mt-2">
              <button
                on:click={() => handleAction('changes_requested')}
                disabled={actionBusy}
                class="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-sm text-white font-medium transition-colors"
              >🔄 Request Changes</button>
              <button
                on:click={() => handleAction('rejected')}
                disabled={actionBusy}
                class="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded text-sm text-white font-medium transition-colors"
              >❌ Reject</button>
              <button
                on:click={() => { sendBackOpen = false; feedback = ''; }}
                class="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-sm text-slate-200 transition-colors"
              >Cancel</button>
            </div>
          </div>
        {/if}

        {#if deliverable.feedback}
          <div class="mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded text-sm text-amber-300">
            <span class="font-medium">Feedback:</span> {deliverable.feedback}
          </div>
        {/if}
      </div>

      <!-- ── Body / file renderer ───────────────────────────────────────── -->
      <div class="flex-1 overflow-y-auto">
        {#if loading}
          <div class="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
            <div class="text-4xl animate-pulse">⏳</div>
            <p>Loading preview…</p>
          </div>

        {:else if loadError}
          <div class="flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
            <div class="text-4xl">⚠️</div>
            <p class="text-amber-400 font-medium">Failed to load preview</p>
            <p class="text-xs text-slate-500">{loadError}</p>
            {#if deliverable.filePath}
              <button on:click={downloadDeliverable} class="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm text-white">⬇ Download Instead</button>
            {/if}
          </div>

        {:else}
          {#if detectRenderMode(plainDeliverable ?? deliverable) === 'csv'}
            <!-- CSV renderer -->
            <div class="p-4">
              <div class="mb-2 flex items-center gap-3 text-xs text-slate-500">
                <span>📊 {csvHeaders.length} columns · {csvAllRows.length} rows{csvTruncated ? ` (truncated at ${MAX_CSV_ROWS})` : ''}</span>
                {#if csvTruncated}
                  <span class="text-amber-400">⚠ File has more rows — download to see all</span>
                {/if}
              </div>
              <div class="overflow-auto rounded border border-slate-700" style="max-height: calc(100vh - 280px)">
                <table class="text-xs w-max min-w-full border-collapse">
                  <thead class="sticky top-0 z-10">
                    <tr>
                      {#each csvHeaders as header, i}
                        <th
                          class="bg-slate-700 px-3 py-2 text-left text-slate-200 font-semibold cursor-pointer hover:bg-slate-600 border-b border-slate-600 select-none whitespace-nowrap"
                          on:click={() => toggleSort(i)}
                        >
                          {header}
                          {#if sortCol === i}
                            <span class="ml-1 opacity-70">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          {:else}
                            <span class="ml-1 opacity-20">⇅</span>
                          {/if}
                        </th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each sortedRows as row, ri}
                      <tr class="{ri % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/50'} hover:bg-slate-700/60">
                        {#each csvHeaders as _, ci}
                          <td class="px-3 py-1.5 border-b border-slate-700/60 text-slate-300 whitespace-nowrap max-w-[240px] truncate">
                            {row[ci] ?? ''}
                          </td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>

          {:else if detectRenderMode(plainDeliverable ?? deliverable) === 'docx'}
            <!-- DOCX renderer (mammoth output) -->
            {#if docxHtml}
              <div
                class="px-6 py-4 prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed [&_h1]:text-slate-100 [&_h2]:text-slate-100 [&_h3]:text-slate-100 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-600 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-600 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-700"
              >
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html docxHtml}
              </div>
            {:else}
              <div class="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
                <div class="text-4xl">📝</div>
                <p>No content extracted from DOCX</p>
              </div>
            {/if}

          {:else if detectRenderMode(plainDeliverable ?? deliverable) === 'pdf'}
            <!-- PDF renderer — native browser iframe -->
            {#if pdfUrl}
              <iframe
                src={pdfUrl}
                class="w-full h-full border-0"
                style="min-height: calc(100vh - 220px)"
                title="PDF Preview: {deliverable.title}"
              ></iframe>
            {:else}
              <div class="flex flex-col items-center justify-center gap-4 py-16 text-center px-6">
                <div class="text-5xl">📑</div>
                <p class="text-slate-400">PDF preview not available — no file path on record.</p>
                <button on:click={downloadDeliverable} class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm text-white">⬇ Download PDF</button>
              </div>
            {/if}

          {:else if detectRenderMode(plainDeliverable ?? deliverable) === 'image'}
            <!-- Image renderer -->
            {#if pdfUrl}
              <div class="flex items-start justify-center p-4">
                <img src={pdfUrl} alt={deliverable.title} class="max-w-full rounded shadow-lg" />
              </div>
            {/if}

          {:else if detectRenderMode(plainDeliverable ?? deliverable) === 'markdown'}
            <!-- Markdown renderer -->
            <div class="px-6 py-4 prose prose-invert prose-sm max-w-none text-slate-200 text-sm leading-relaxed">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html '<p class="mb-2">' + renderMarkdown(textContent || (plainDeliverable ?? deliverable).content || '') + '</p>'}
            </div>

          {:else if detectRenderMode(plainDeliverable ?? deliverable) === 'text'}
            <!-- Plain text renderer -->
            <div class="p-6">
              <pre class="text-sm text-slate-300 whitespace-pre-wrap font-mono bg-slate-800/60 rounded p-4 border border-slate-700">{textContent || (plainDeliverable ?? deliverable).content || ''}</pre>
            </div>

          {:else}
            <!-- No preview available -->
            <div class="flex flex-col items-center justify-center gap-4 py-20 text-center px-6">
              <div class="text-5xl">📎</div>
              <div>
                <p class="text-slate-300 font-medium text-lg mb-1">Preview not available</p>
                <p class="text-sm text-slate-500 mb-4">This file type cannot be rendered inline.</p>
                {#if deliverable.filePath || deliverable.content}
                  <button
                    on:click={downloadDeliverable}
                    class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-semibold text-sm transition-colors inline-flex items-center gap-2"
                  >⬇ Download File</button>
                {/if}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}
