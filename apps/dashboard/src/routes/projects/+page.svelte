<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchProjects, fetchProject, createProject, deleteProject, spawnAgent, fetchProjectAgents, sendMessageToAgent, deleteAgent, changeAgentModel, type Project, type AgentAssociation } from '$lib/api';
  
  let projects: Project[] = [];
  let selectedProject: Project | null = null;
  let projectAgents: AgentAssociation[] = [];
  let loading = true;
  let loadingDetail = false;
  
  // Modal states
  let showNewProjectModal = false;
  let showSpawnAgentModal = false;
  let showDeleteConfirm = false;
  let showDeleteAgentConfirm = false;
  let showMessageModal = false;
  let showModelModal = false;
  let selectedAgent: AgentAssociation | null = null;
  let agentToDelete: AgentAssociation | null = null;
  let agentToChangeModel: AgentAssociation | null = null;
  let agentMessage = '';
  let selectedModel = '';
  
  // Form states
  let newProjectName = '';
  let newProjectDescription = '';
  let agentTask = '';
  let agentModel = '';
  let agentTimeout = 300;
  let formError = '';
  let formLoading = false;
  
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
    const [project, agents] = await Promise.all([
      fetchProject(id),
      fetchProjectAgents(id),
    ]);
    selectedProject = project;
    projectAgents = agents;
    loadingDetail = false;
  }
  
  async function handleCreateProject() {
    if (!newProjectName.trim()) {
      formError = 'Project name is required';
      return;
    }
    
    formLoading = true;
    formError = '';
    
    const result = await createProject({
      name: newProjectName.trim(),
      description: newProjectDescription.trim(),
    });
    
    formLoading = false;
    
    if (result.success) {
      showNewProjectModal = false;
      newProjectName = '';
      newProjectDescription = '';
      await loadProjects();
      if (result.project) {
        await selectProject(result.project.id);
      }
    } else {
      formError = result.error || 'Failed to create project';
    }
  }
  
  async function handleDeleteProject() {
    if (!selectedProject) return;
    
    formLoading = true;
    const result = await deleteProject(selectedProject.id);
    formLoading = false;
    
    if (result.success) {
      showDeleteConfirm = false;
      selectedProject = null;
      await loadProjects();
    } else {
      formError = result.error || 'Failed to delete project';
    }
  }
  
  async function handleSpawnAgent() {
    if (!selectedProject) {
      formError = 'No project selected';
      return;
    }
    
    formLoading = true;
    formError = '';
    
    const result = await spawnAgent({
      projectId: selectedProject.id,
    });
    
    formLoading = false;
    
    if (result.success) {
      showSpawnAgentModal = false;
      // Refresh agents list
      projectAgents = await fetchProjectAgents(selectedProject.id);
    } else {
      formError = result.error || 'Failed to create agent';
    }
  }
  
  async function handleSendMessage() {
    if (!selectedAgent || !agentMessage.trim()) {
      formError = 'Message is required';
      return;
    }
    
    formLoading = true;
    formError = '';
    
    const success = await sendMessageToAgent(selectedAgent.sessionKey, agentMessage.trim());
    
    formLoading = false;
    
    if (success) {
      showMessageModal = false;
      agentMessage = '';
      selectedAgent = null;
    } else {
      formError = 'Failed to send message';
    }
  }
  
  function openMessageModal(agent: AgentAssociation) {
    selectedAgent = agent;
    agentMessage = '';
    showMessageModal = true;
  }

  function confirmDeleteAgent(agent: AgentAssociation) {
    agentToDelete = agent;
    showDeleteAgentConfirm = true;
  }

  async function handleDeleteAgent() {
    if (!agentToDelete) return;
    
    formLoading = true;
    formError = '';
    
    const result = await deleteAgent(agentToDelete.sessionKey);
    
    if (result.success) {
      showDeleteAgentConfirm = false;
      agentToDelete = null;
      // Refresh agents list
      if (selectedProject) {
        projectAgents = await fetchProjectAgents(selectedProject.id);
      }
    } else {
      formError = result.error || 'Failed to delete agent';
    }
    
    formLoading = false;
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
  
  function closeModals() {
    showNewProjectModal = false;
    showSpawnAgentModal = false;
    showDeleteConfirm = false;
    showDeleteAgentConfirm = false;
    showMessageModal = false;
    showModelModal = false;
    selectedAgent = null;
    agentToDelete = null;
    agentToChangeModel = null;
    selectedModel = '';
    formError = '';
  }

  function openModelModal(agent: AgentAssociation) {
    agentToChangeModel = agent;
    selectedModel = agent.model || 'claude-opus-4-5';
    showModelModal = true;
  }

  async function handleChangeModel() {
    if (!agentToChangeModel || !selectedModel) return;
    
    formLoading = true;
    formError = '';
    
    const result = await changeAgentModel(agentToChangeModel.sessionKey, selectedModel);
    
    if (result.success) {
      showModelModal = false;
      agentToChangeModel = null;
      selectedModel = '';
      // Refresh agents list
      if (selectedProject) {
        projectAgents = await fetchProjectAgents(selectedProject.id);
      }
    } else {
      formError = result.error || 'Failed to change model';
    }
    
    formLoading = false;
  }
  
  function formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }
  
  function getAgentStatusIcon(status: string): string {
    switch (status) {
      case 'running': return '🔵';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '⚪';
    }
  }
  
  function getShortSessionKey(sessionKey: string): string {
    const parts = sessionKey.split(':');
    const uuid = parts.pop() || '';
    return uuid.slice(0, 8);
  }
  
  onMount(() => {
    loadProjects();
  });
</script>

<!-- Modal Backdrop -->
{#if showNewProjectModal || showSpawnAgentModal || showDeleteConfirm || showDeleteAgentConfirm || showModelModal}
  <button 
    class="fixed inset-0 bg-black/50 z-40 cursor-default"
    on:click={closeModals}
    on:keydown={(e) => e.key === 'Escape' && closeModals()}
    aria-label="Close modal"
  ></button>
{/if}

<!-- New Project Modal -->
{#if showNewProjectModal}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="new-project-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="new-project-title" class="font-semibold">New Project</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        <div>
          <label for="new-project-name" class="block text-sm text-slate-400 mb-1">Project Name</label>
          <input 
            id="new-project-name"
            type="text" 
            bind:value={newProjectName}
            placeholder="My New Project"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label for="new-project-description" class="block text-sm text-slate-400 mb-1">Description (optional)</label>
          <textarea 
            id="new-project-description"
            bind:value={newProjectDescription}
            placeholder="Brief description of the project..."
            rows="3"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
          ></textarea>
        </div>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleCreateProject}
          disabled={formLoading}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Creating...' : 'Create Project'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Spawn Agent Modal -->
{#if showSpawnAgentModal}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-lg" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="spawn-agent-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="spawn-agent-title" class="font-semibold">🚀 Spawn Agent</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm whitespace-pre-wrap">{formError}</div>
        {/if}
        
        {#if selectedProject}
          <div class="p-3 bg-blue-500/10 border border-blue-500/30 rounded text-sm">
            <span class="text-blue-400">📁 Project:</span> {selectedProject.name}
          </div>
        {/if}
        
        <p class="text-slate-400 text-sm">
          Create a new agent for this project. You can message it and change its model after creation.
        </p>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleSpawnAgent}
          disabled={formLoading}
          class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Creating...' : '➕ Create Agent'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Message Agent Modal -->
{#if showMessageModal && selectedAgent}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="message-agent-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="message-agent-title" class="font-semibold">💬 Message Agent</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        
        <div class="p-3 bg-slate-700/50 rounded text-sm">
          <div class="flex items-center gap-2 mb-1">
            <span>{getAgentStatusIcon(selectedAgent.status)}</span>
            <span class="font-medium">{selectedAgent.label || getShortSessionKey(selectedAgent.sessionKey)}</span>
          </div>
          <div class="text-xs text-slate-400 truncate">{selectedAgent.task}</div>
        </div>
        
        <div>
          <label for="agent-message" class="block text-sm text-slate-400 mb-1">Message</label>
          <textarea 
            id="agent-message"
            bind:value={agentMessage}
            placeholder="Send a message to this agent..."
            rows="3"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
          ></textarea>
        </div>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleSendMessage}
          disabled={formLoading}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Confirm Modal -->
{#if showDeleteConfirm}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-sm" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700">
        <h2 id="delete-confirm-title" class="font-semibold text-red-400">⚠️ Delete Project</h2>
      </div>
      <div class="p-4">
        <p class="text-slate-300">Are you sure you want to delete <strong>{selectedProject?.name}</strong>?</p>
        <p class="text-sm text-slate-400 mt-2">The project will be moved to trash and can be recovered.</p>
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleDeleteProject}
          disabled={formLoading}
          class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Agent Confirm Modal -->
{#if showDeleteAgentConfirm}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-sm" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="delete-agent-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700">
        <h2 id="delete-agent-title" class="font-semibold text-red-400">🗑️ Delete Agent</h2>
      </div>
      <div class="p-4">
        <p class="text-slate-300">Are you sure you want to delete agent <strong>{agentToDelete?.label || 'this agent'}</strong>?</p>
        <p class="text-sm text-slate-400 mt-2">This will permanently delete the agent session and its history.</p>
        {#if formError}
          <p class="text-sm text-red-400 mt-2">{formError}</p>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleDeleteAgent}
          disabled={formLoading}
          class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Change Model Modal -->
{#if showModelModal && agentToChangeModel}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-sm" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="model-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700">
        <h2 id="model-title" class="font-semibold text-purple-400">⚙️ Change Model</h2>
      </div>
      <div class="p-4 space-y-4">
        <p class="text-slate-300 text-sm">Select model for <strong>{agentToChangeModel.label || 'agent'}</strong>:</p>
        <select 
          bind:value={selectedModel}
          class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-purple-500 focus:outline-none"
        >
          <option value="claude-opus-4-5">Claude Opus 4.5</option>
          <option value="anthropic/claude-sonnet-4-20250514">Claude Sonnet 4</option>
          <option value="ollama/qwen3-coder">Qwen3 Coder (Local)</option>
        </select>
        {#if formError}
          <p class="text-sm text-red-400">{formError}</p>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleChangeModel}
          disabled={formLoading}
          class="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}

<div class="grid grid-cols-3 gap-6 h-[calc(100vh-180px)]">
  <!-- Project List -->
  <div class="bg-slate-800 rounded-lg border border-slate-700 flex flex-col">
    <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
      <h2 class="font-semibold">Projects</h2>
      <div class="flex items-center gap-2">
        <button 
          on:click={() => showNewProjectModal = true}
          class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
        >
          + New
        </button>
        <button on:click={loadProjects} class="text-xs text-slate-500 hover:text-slate-300">↻</button>
      </div>
    </div>
    <div class="p-4 space-y-2 overflow-y-auto flex-1">
      {#if loading}
        <div class="text-center py-8 text-slate-500">Loading projects...</div>
      {:else if projects.length === 0}
        <div class="text-center py-8 text-slate-500">
          <div class="text-2xl mb-2">📁</div>
          <div>No projects yet</div>
          <button 
            on:click={() => showNewProjectModal = true}
            class="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
          >
            Create First Project
          </button>
        </div>
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
        <div class="flex items-center gap-2">
          {#if selectedProject.updated}
            <span class="text-xs text-slate-500">Updated {formatRelativeTime(selectedProject.updated)}</span>
          {/if}
          <button 
            on:click={() => showDeleteConfirm = true}
            class="px-2 py-1 text-red-400 hover:bg-red-500/20 rounded text-xs transition-colors"
          >
            🗑️
          </button>
        </div>
      </div>
      
      <div class="p-4 overflow-y-auto flex-1 space-y-6">
        <!-- Actions -->
        <div>
          <h3 class="text-sm text-slate-400 mb-2 font-medium">ACTIONS</h3>
          <div class="flex gap-2 flex-wrap">
            <button 
              on:click={() => showSpawnAgentModal = true}
              class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
            >
              🚀 Spawn Agent
            </button>
            <button class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors">
              📂 Open in Terminal
            </button>
          </div>
        </div>
        
        <!-- Project Agents -->
        <div>
          <h3 class="text-sm text-slate-400 mb-2 font-medium flex items-center justify-between">
            <span>AGENTS ({projectAgents.length})</span>
            {#if projectAgents.length > 0}
              <button 
                on:click={() => selectedProject && selectProject(selectedProject.id)}
                class="text-xs text-slate-500 hover:text-slate-300"
              >
                ↻ Refresh
              </button>
            {/if}
          </h3>
          
          {#if projectAgents.length === 0}
            <div class="p-4 bg-slate-700/30 rounded-lg text-center text-slate-500 text-sm">
              No agents spawned for this project yet.
              <button 
                on:click={() => showSpawnAgentModal = true}
                class="block mt-2 mx-auto text-blue-400 hover:text-blue-300"
              >
                Spawn your first agent →
              </button>
            </div>
          {:else}
            <div class="space-y-2">
              {#each projectAgents as agent}
                <div class="p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors">
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2">
                      <span>{getAgentStatusIcon(agent.status)}</span>
                      <span class="font-medium text-sm">{agent.label || getShortSessionKey(agent.sessionKey)}</span>
                      <span class="text-xs px-1.5 py-0.5 bg-slate-600 rounded text-slate-400">{agent.status}</span>
                    </div>
                    <span class="text-xs text-slate-500">{formatTimeAgo(agent.spawnedAt)}</span>
                  </div>
                  <div class="text-xs text-slate-400 mb-2 line-clamp-2">{agent.task}</div>
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-slate-500 font-mono">{getShortSessionKey(agent.sessionKey)}</span>
                    <div class="flex gap-2">
                      {#if agent.status === 'running'}
                        <button 
                          on:click={() => openMessageModal(agent)}
                          class="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-xs transition-colors"
                        >
                          💬 Message
                        </button>
                      {/if}
                      <button 
                        on:click={() => openModelModal(agent)}
                        class="px-2 py-1 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 rounded text-xs transition-colors"
                      >
                        ⚙️ Model
                      </button>
                      <button 
                        on:click={() => confirmDeleteAgent(agent)}
                        class="px-2 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs transition-colors"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        
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
      </div>
    {/if}
  </div>
</div>
