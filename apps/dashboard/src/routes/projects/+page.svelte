<script lang="ts">
  // Mock data - will be replaced with API calls
  const projects = [
    {
      id: 'goldie',
      name: 'Goldie Health',
      path: 'goldie/',
      agents: ['Goldie PM', 'Research'],
      status: 'Active',
      statusMd: `## Current Focus
- Patent #1 (Carestream) drafted
- Reviewing with legal

## Next Steps
- [ ] Patent #2 draft
- [ ] Series A deck update

## Blockers
- None`,
      updated: '2 hours ago',
    },
    {
      id: 'dashboard',
      name: 'Agent Dashboard',
      path: 'agent-dashboard/',
      agents: ['Jarvis'],
      status: 'Active',
      statusMd: `## Current Phase
Phase 1: Foundation

## Progress
- [x] Project structure created
- [x] SvelteKit scaffold
- [ ] Backend scaffold
- [ ] WebSocket connection`,
      updated: 'Just now',
    },
    {
      id: 'nonprofit',
      name: 'PT/OT Nonprofit',
      path: 'nonprofit/',
      agents: ['Jarvis'],
      status: 'Idle',
      statusMd: `## Status
Grant research completed.

## Top Recommendation
Bob Woodruff Foundation`,
      updated: '3 days ago',
    },
  ];
  
  let selectedProject = projects[0];
  
  const statusColors: Record<string, string> = {
    Active: 'bg-green-500/20 text-green-400',
    Idle: 'bg-slate-500/20 text-slate-400',
    Blocked: 'bg-red-500/20 text-red-400',
  };
</script>

<div class="grid grid-cols-3 gap-6 h-[calc(100vh-180px)]">
  <!-- Project List -->
  <div class="bg-slate-800 rounded-lg border border-slate-700 flex flex-col">
    <div class="px-4 py-3 border-b border-slate-700">
      <h2 class="font-semibold">Projects</h2>
    </div>
    <div class="p-4 space-y-2 overflow-y-auto flex-1">
      {#each projects as project}
        <button
          on:click={() => selectedProject = project}
          class="w-full text-left p-3 rounded-lg transition-colors
            {selectedProject.id === project.id ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-slate-700/50 hover:bg-slate-700 border border-transparent'}"
        >
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <span>📁</span>
              <span class="font-medium">{project.name}</span>
            </div>
            <span class="text-xs px-2 py-0.5 rounded {statusColors[project.status]}">{project.status}</span>
          </div>
          <div class="text-xs text-slate-500">{project.path}</div>
          <div class="text-xs text-slate-500 mt-1">Updated {project.updated}</div>
        </button>
      {/each}
    </div>
  </div>
  
  <!-- Project Detail -->
  <div class="col-span-2 bg-slate-800 rounded-lg border border-slate-700 flex flex-col">
    <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-xl">📁</span>
        <div>
          <h2 class="font-semibold">{selectedProject.name}</h2>
          <div class="text-xs text-slate-500">{selectedProject.path}</div>
        </div>
      </div>
      <span class="text-xs px-2 py-0.5 rounded {statusColors[selectedProject.status]}">{selectedProject.status}</span>
    </div>
    
    <div class="p-4 overflow-y-auto flex-1">
      <!-- Assigned Agents -->
      <div class="mb-6">
        <h3 class="text-sm text-slate-400 mb-2 font-medium">ASSIGNED AGENTS</h3>
        <div class="flex gap-2">
          {#each selectedProject.agents as agent}
            <span class="px-3 py-1 bg-slate-700 rounded text-sm">{agent}</span>
          {/each}
        </div>
      </div>
      
      <!-- STATUS.md -->
      <div class="mb-6">
        <h3 class="text-sm text-slate-400 mb-2 font-medium">STATUS.MD</h3>
        <div class="p-4 bg-slate-900 rounded-lg font-mono text-sm whitespace-pre-wrap">
          {selectedProject.statusMd}
        </div>
      </div>
      
      <!-- Quick Actions -->
      <div>
        <h3 class="text-sm text-slate-400 mb-2 font-medium">ACTIONS</h3>
        <div class="flex gap-2">
          <button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors">
            Message Agents
          </button>
          <button class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors">
            View Files
          </button>
          <button class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors">
            Open in Editor
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
