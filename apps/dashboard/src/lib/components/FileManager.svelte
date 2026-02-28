<script lang="ts">
  import { onMount } from 'svelte';
  import { getApiBase } from '$lib/config';

  export let projectId: string;

  interface WorkspaceFile {
    name: string;
    isDirectory: boolean;
    size: number;
    modified: string;
  }

  let files: WorkspaceFile[] = [];
  let loading = false;
  let uploading = false;
  let uploadError = '';
  let uploadSuccess = '';
  let isDragOver = false;
  let extractZip = true;

  // File to confirm deletion
  let fileToDelete: WorkspaceFile | null = null;
  let deleting = false;

  $: apiBase = getApiBase();

  async function loadFiles() {
    loading = true;
    try {
      const res = await fetch(`${apiBase}/projects/${projectId}/files`);
      if (res.ok) {
        const data = await res.json();
        files = data.files || [];
      } else {
        uploadError = 'Failed to load files';
      }
    } catch (e) {
      uploadError = 'Failed to load files';
    } finally {
      loading = false;
    }
  }

  async function uploadFiles(fileList: FileList | File[]) {
    const toUpload = Array.from(fileList);
    if (toUpload.length === 0) return;

    uploading = true;
    uploadError = '';
    uploadSuccess = '';

    const form = new FormData();
    for (const file of toUpload) {
      form.append('files', file);
    }

    try {
      const url = `${apiBase}/projects/${projectId}/files${extractZip ? '?extract=true' : ''}`;
      const res = await fetch(url, { method: 'POST', body: form });
      const data = await res.json();

      if (res.ok) {
        const names = (data.uploaded || []).map((f: any) => {
          return f.extracted ? `${f.name} (extracted)` : f.name;
        });
        uploadSuccess = `Uploaded: ${names.join(', ')}`;
        await loadFiles();
      } else {
        uploadError = data.error || 'Upload failed';
      }
    } catch (e) {
      uploadError = 'Upload failed — check the console';
    } finally {
      uploading = false;
    }
  }

  async function deleteFile(file: WorkspaceFile) {
    deleting = true;
    uploadError = '';
    uploadSuccess = '';
    try {
      const res = await fetch(
        `${apiBase}/projects/${projectId}/files/${encodeURIComponent(file.name)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        uploadSuccess = `Deleted: ${file.name}`;
        fileToDelete = null;
        await loadFiles();
      } else {
        const data = await res.json();
        uploadError = data.error || 'Delete failed';
      }
    } catch (e) {
      uploadError = 'Delete failed';
    } finally {
      deleting = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    if (!e.dataTransfer?.files.length) return;
    uploadFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave() {
    isDragOver = false;
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) {
      uploadFiles(input.files);
      // Reset the input so the same file can be re-uploaded if needed
      input.value = '';
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function getFileIcon(file: WorkspaceFile): string {
    if (file.isDirectory) return '📁';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const icons: Record<string, string> = {
      md: '📝', txt: '📄', pdf: '📕', doc: '📘', docx: '📘',
      csv: '📊', xlsx: '📊', xls: '📊', json: '⚙️', yaml: '⚙️', yml: '⚙️',
      ts: '💻', js: '💻', py: '💻', sh: '💻', rb: '💻', go: '💻', rs: '💻',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
      zip: '🗜️', tar: '🗜️', gz: '🗜️',
      mp4: '🎬', mp3: '🎵', wav: '🎵',
    };
    return icons[ext] || '📄';
  }

  function clearMessages() {
    uploadError = '';
    uploadSuccess = '';
  }

  onMount(() => {
    loadFiles();
  });
</script>

<div class="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
  <!-- Header -->
  <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
    <h2 class="font-semibold text-sm flex items-center gap-2">
      <span>📂</span>
      <span>WORKSPACE FILES</span>
      <span class="text-slate-500 font-normal">({files.length})</span>
    </h2>
    <button
      on:click={loadFiles}
      class="text-xs text-slate-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-slate-700"
      title="Refresh file list"
    >
      ↻ Refresh
    </button>
  </div>

  <!-- Upload Area -->
  <div class="p-4 border-b border-slate-700">
    <!-- Drop Zone -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="border-2 border-dashed rounded-lg p-6 text-center transition-all duration-150 cursor-pointer
        {isDragOver
          ? 'border-blue-400 bg-blue-500/10 text-blue-300'
          : 'border-slate-600 hover:border-slate-500 text-slate-400 hover:text-slate-300'}"
      on:drop={handleDrop}
      on:dragover={handleDragOver}
      on:dragleave={handleDragLeave}
      on:click={() => document.getElementById(`file-input-${projectId}`)?.click()}
      on:keydown={(e) => e.key === 'Enter' && document.getElementById(`file-input-${projectId}`)?.click()}
      role="button"
      tabindex="0"
      aria-label="Upload files — drag & drop or click to browse"
    >
      <input
        id="file-input-{projectId}"
        type="file"
        multiple
        class="hidden"
        on:change={handleFileInput}
        aria-label="Choose files to upload"
      />

      {#if uploading}
        <div class="text-blue-400">
          <div class="text-2xl mb-1 animate-pulse">⬆️</div>
          <div class="text-sm font-medium">Uploading...</div>
        </div>
      {:else}
        <div class="text-2xl mb-2">{isDragOver ? '📥' : '☁️'}</div>
        <div class="text-sm font-medium mb-1">
          {isDragOver ? 'Drop files here' : 'Drag & drop files here'}
        </div>
        <div class="text-xs">or <span class="text-blue-400 underline">browse to upload</span></div>
        <div class="text-xs mt-2 text-slate-500">Supports any file type · Max 100 MB per file</div>
      {/if}
    </div>

    <!-- ZIP extract option -->
    <label class="flex items-center gap-2 mt-3 text-sm text-slate-400 cursor-pointer select-none w-fit">
      <input
        type="checkbox"
        bind:checked={extractZip}
        class="accent-blue-500 w-4 h-4"
      />
      <span>Auto-extract ZIP files after upload</span>
    </label>

    <!-- Status messages -->
    {#if uploadSuccess}
      <div class="mt-3 px-3 py-2 bg-green-500/20 border border-green-500/50 rounded text-green-400 text-sm flex items-start gap-2">
        <span>✅</span>
        <span class="flex-1">{uploadSuccess}</span>
        <button on:click={clearMessages} class="text-green-300 hover:text-white text-xs">✕</button>
      </div>
    {/if}
    {#if uploadError}
      <div class="mt-3 px-3 py-2 bg-red-500/20 border border-red-500/50 rounded text-red-400 text-sm flex items-start gap-2">
        <span>⚠️</span>
        <span class="flex-1">{uploadError}</span>
        <button on:click={clearMessages} class="text-red-300 hover:text-white text-xs">✕</button>
      </div>
    {/if}
  </div>

  <!-- File List -->
  <div class="overflow-y-auto max-h-96">
    {#if loading}
      <div class="px-4 py-6 text-center text-slate-500 text-sm">Loading files...</div>
    {:else if files.length === 0}
      <div class="px-4 py-8 text-center text-slate-500">
        <div class="text-2xl mb-2">📭</div>
        <div class="text-sm">Workspace is empty</div>
        <div class="text-xs text-slate-600 mt-1">Upload files above to get started</div>
      </div>
    {:else}
      <table class="w-full text-sm">
        <thead>
          <tr class="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-700/50">
            <th class="px-4 py-2 text-left font-medium">Name</th>
            <th class="px-4 py-2 text-right font-medium hidden sm:table-cell">Size</th>
            <th class="px-4 py-2 text-right font-medium hidden md:table-cell">Modified</th>
            <th class="px-4 py-2 text-right font-medium w-16"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-700/30">
          {#each files as file (file.name)}
            <tr class="hover:bg-slate-700/30 transition-colors group">
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="flex-shrink-0">{getFileIcon(file)}</span>
                  <span
                    class="truncate {file.isDirectory ? 'text-blue-300' : 'text-slate-200'}"
                    title={file.name}
                  >{file.name}</span>
                </div>
              </td>
              <td class="px-4 py-2.5 text-right text-slate-500 text-xs hidden sm:table-cell whitespace-nowrap">
                {file.isDirectory ? '—' : formatBytes(file.size)}
              </td>
              <td class="px-4 py-2.5 text-right text-slate-500 text-xs hidden md:table-cell whitespace-nowrap">
                {formatDate(file.modified)}
              </td>
              <td class="px-4 py-2.5 text-right">
                {#if !file.isDirectory}
                  <button
                    on:click={() => fileToDelete = file}
                    class="text-xs text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded"
                    title="Delete {file.name}"
                  >
                    🗑️
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<!-- Delete Confirm Overlay -->
{#if fileToDelete}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
    on:click={() => fileToDelete = null}
    on:keydown={(e) => e.key === 'Escape' && (fileToDelete = null)}
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-file-title"
  >
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="bg-slate-800 border border-slate-700 rounded-lg p-5 w-full max-w-sm"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <h3 id="delete-file-title" class="font-semibold text-red-400 mb-2">🗑️ Delete File</h3>
      <p class="text-sm text-slate-300 mb-1">
        Are you sure you want to delete <strong class="text-white">{fileToDelete.name}</strong>?
      </p>
      <p class="text-xs text-slate-500 mb-4">This cannot be undone.</p>
      <div class="flex justify-end gap-2">
        <button
          on:click={() => fileToDelete = null}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >Cancel</button>
        <button
          on:click={() => fileToDelete && deleteFile(fileToDelete)}
          disabled={deleting}
          class="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
        >{deleting ? 'Deleting...' : 'Delete'}</button>
      </div>
    </div>
  </div>
{/if}
