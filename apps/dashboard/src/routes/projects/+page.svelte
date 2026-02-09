<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchProjects, fetchProject, type Project } from '$lib/api';
  
  let projects: Project[] = [];
  let selectedProject: Project | null = null;
  let loading = true;
  let loadingDetail = false;
  
  async function loadProjects() {
    loading = true;
    projects = await fetchProjects();
    
    // Select first project by default
    if (projects.length > 0 && !selectedProject) {
      await selectProject(projects[0].id);
    }
    loading = false;
  }
  
  async function selectProject(id: string) {
    loadingDetail = true;
    selectedProject = await fetchProject(id);
    loadingDetail = false;
  }
  
  function formatRelativeTime(timestamp: string): string {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }
  
  onMount(() => {
    loadProjects();
  });
</script>

<div class="grid grid-cols-3 gap-6 h-[calc(100vh-180px)]">
  <!-- Project List -->
  <div class="bg-slate-800 rounded-lg border border-slate-700 flex flex-col">
    <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
      <h2 class="font-semibold">Projects</h2>
      <button on:click={loadProjects} class="text-xs text-slate-500 hover:text-slate-300">Refresh</button>
    </div>
    <div class="p-4 space-y-2 overflow-y-auto flex-1">
      {#if loading}
        <div class="text-center py-8 text-slate-500">Loading projects...</div>
      {:else if projects.length === 0}
        <div class="text-center py-8 text-slate-500">No projects found</div>
      {:else}
        {#each projects as project}
          <button
            on:click={() => selectProject(project.id)}
            class="w-full text-left p-3 rounded-lg transition-colors
              {selectedProject?.id === project.id ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-slate-700/50 hover:bg-slate-700 border border-transparent'}"
          >
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span>📁</span>
                <span class="font-medium">{project.name}</span>
              </div>
              <div class="flex gap-1">
                {#if project.hasStatusMd}
                  <span class="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">S</span>
                {/if}
                {#if project.hasProjectMd}
                  <span class="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">P</span>
                {/if}
                {#if project.hasHandoffMd}
                  <span class="text-xs px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">H</span>
                {/if}
              </div>
            </div>
            <div class="text-xs text-slate-500">{project.path}</div>
            {#if project.updated}
              <div class="text-xs text-slate-500 mt-1">Updated {formatRelativeTime(project.updated)}</div>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
    <div class="px-4 py-2 border-t border-slate-700 text-xs text-slate-500">
      <span class="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded mr-1">S</span> STATUS.md
      <span class="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded mx-1">P</span> PROJECT.md
      <span class="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded ml-1">H</span> HANDOFF.md
    </div>
  </div>
  
  <!-- Project Detail -->
  <div class="col-span-2 bg-slate-800 rounded-lg border border-slate-700 flex flex-col">
    {#if !selectedProject}
      <div class="flex-1 flex items-center justify-center text-slate-500">
        Select a project to view details
      </div>
    {:else if loadingDetail}
      <div class="flex-1 flex items-center justify-center text-slate-500">
        Loading project details...
      </div>
    {:else}
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-xl">📁</span>
          <div>
            <h2 class="font-semibold">{selectedProject.name}</h2>
            <div class="text-xs text-slate-500">{selectedProject.path}</div>
          </div>
        </div>
        {#if selectedProject.updated}
          <span class="text-xs text-slate-500">Updated {formatRelativeTime(selectedProject.updated)}</span>
        {/if}
      </div>
      
      <div class="p-4 overflow-y-auto flex-1 space-y-6">
        <!-- Files -->
        {#if selectedProject.files && selectedProject.files.length > 0}
          <div>
            <h3 class="text-sm text-slate-400 mb-2 font-medium">FILES</h3>
            <div class="flex flex-wrap gap-2">
              {#each selectedProject.files as file}
                <span class="px-2 py-1 bg-slate-700 rounded text-sm font-mono">
                  {file.endsWith('/') ? '📁' : '📄'} {file}
                </span>
              {/each}
            </div>
          </div>
        {/if}
        
        <!-- STATUS.md -->
        {#if selectedProject.statusMd}
          <div>
            <h3 class="text-sm text-slate-400 mb-2 font-medium">STATUS.MD</h3>
            <div class="p-4 bg-slate-900 rounded-lg font-mono text-sm whitespace-pre-wrap overflow-x-auto">
              {selectedProject.statusMd}
            </div>
          </div>
        {/if}
        
        <!-- HANDOFF.md -->
        {#if selectedProject.handoffMd}
          <div>
            <h3 class="text-sm text-slate-400 mb-2 font-medium">HANDOFF.MD</h3>
            <div class="p-4 bg-slate-900 rounded-lg font-mono text-sm whitespace-pre-wrap overflow-x-auto">
              {selectedProject.handoffMd}
            </div>
          </div>
        {/if}
        
        <!-- PROJECT.md -->
        {#if selectedProject.projectMd}
          <div>
            <h3 class="text-sm text-slate-400 mb-2 font-medium">PROJECT.MD</h3>
            <div class="p-4 bg-slate-900 rounded-lg font-mono text-sm whitespace-pre-wrap overflow-x-auto max-h-96">
              {selectedProject.projectMd}
            </div>
          </div>
        {/if}
        
        <!-- Actions -->
        <div>
          <h3 class="text-sm text-slate-400 mb-2 font-medium">ACTIONS</h3>
          <div class="flex gap-2">
            <button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors">
              Message Agents
            </button>
            <button class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors">
              Open in Terminal
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
