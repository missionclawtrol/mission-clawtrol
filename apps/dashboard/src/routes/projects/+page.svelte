<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { fetchProjects, fetchProject, createProject, deleteProject, spawnAgent, fetchProjectAgents, fetchProjectAgentSummary, sendMessageToAgent, deleteAgent, changeAgentModel, fetchTasks, fetchImportableFolders, importProject, fetchMilestones, createMilestone, updateMilestone, deleteMilestone, type Project, type AgentAssociation, type AgentSummary, type Task, type ImportableFolder, type Milestone } from '$lib/api';
  import { getApiBase } from '$lib/config';
  
  let projects: Project[] = [];
  let selectedProject: Project | null = null;
  let projectAgents: AgentAssociation[] = [];
  let agentSummary: AgentSummary[] = [];
  let allTasks: Task[] = [];
  let loading = true;
  let loadingDetail = false;
  
  // Milestone state
  let milestones: Milestone[] = [];
  let showNewMilestoneForm = false;
  let newMilestoneName = '';
  let newMilestoneDescription = '';
  let newMilestoneTargetDate = '';
  let milestoneFormLoading = false;
  let milestoneFormError = '';
  // Edit state
  let editingMilestoneId: string | null = null;
  let editMilestoneName = '';
  let editMilestoneDescription = '';
  let editMilestoneTargetDate = '';
  let editMilestoneLoading = false;

  // Cost data
  interface ProjectCost {
    projectId: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
  }
  let projectCost: ProjectCost | null = null;
  let humanHourlyRate = 100;
  
  // Modal states
  let showNewProjectModal = false;
  let showImportModal = false;
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
  
  // Import modal states
  let importableFolders: ImportableFolder[] = [];
  let selectedFolderId = '';
  let importDescription = '';
  let loadingImportable = false;
  
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
    try {
      // Fetch hourly rate from settings
      try {
        const settingsRes = await fetch(`${getApiBase()}/settings`);
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          humanHourlyRate = settings.humanHourlyRate || 100;
        }
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }

      projects = await fetchProjects();
      allTasks = await fetchTasks();
      
      // Select first project by default
      if (projects.length > 0 && !selectedProject) {
        await selectProject(projects[0].id);
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      loading = false;
    }
  }
  
  function getProjectStats(projectId: string) {
    const projectTasks = allTasks.filter(t => t.projectId === projectId);
    const total = projectTasks.length;
    const completed = projectTasks.filter(t => t.status === 'done').length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
    return { total, completed, percentage };
  }
  
  async function selectProject(id: string) {
    loadingDetail = true;
    projectCost = null;
    milestones = [];
    showNewMilestoneForm = false;
    try {
      const [project, agents, summary, ms] = await Promise.all([
        fetchProject(id),
        fetchProjectAgents(id),
        fetchProjectAgentSummary(id),
        fetchMilestones(id),
      ]);
      milestones = ms;
      selectedProject = project;
      projectAgents = agents;
      agentSummary = summary;
      // Fetch cost data for this project
      try {
        const costRes = await fetch(`${getApiBase()}/costs/by-project`);
        if (costRes.ok) {
          const costData = await costRes.json();
          projectCost = (costData.projects || []).find((p: ProjectCost) => p.projectId === id) || null;
        }
      } catch (e) {
        console.warn('Failed to load cost data:', e);
      }
    } catch (err) {
      console.error('Failed to load project details:', err);
    } finally {
      loadingDetail = false;
    }
  }
  
  function formatCostCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: value >= 100 ? 0 : 2,
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
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
  
  async function openImportModal() {
    showImportModal = true;
    selectedFolderId = '';
    importDescription = '';
    formError = '';
    
    loadingImportable = true;
    importableFolders = await fetchImportableFolders();
    loadingImportable = false;
  }
  
  async function handleImportProject() {
    if (!selectedFolderId) {
      formError = 'Please select a folder to import';
      return;
    }
    
    formLoading = true;
    formError = '';
    
    const result = await importProject({
      folderId: selectedFolderId,
      description: importDescription.trim(),
    });
    
    formLoading = false;
    
    if (result.success) {
      showImportModal = false;
      selectedFolderId = '';
      importDescription = '';
      await loadProjects();
      if (result.project) {
        await selectProject(result.project.id);
      }
    } else {
      formError = result.error || 'Failed to import project';
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
    
    // Send a message to the main agent asking it to spawn a subagent
    // This uses sessions_spawn internally which properly creates isolated subagents
    const spawnMessage = agentTask.trim()
      ? `Create a subagent for the project at ${selectedProject.path}. Task: ${agentTask.trim()}`
      : `Create a subagent for the project at ${selectedProject.path}. The agent should read the project files and await further instructions.`;
    
    const success = await sendMessageToAgent('agent:main:main', spawnMessage);
    
    formLoading = false;
    
    if (success) {
      showSpawnAgentModal = false;
      agentTask = ''; // Reset task field
      // Note: Agent list won't update immediately - the main agent needs to spawn first
      // Could add a small delay and refresh, or use websocket for real-time updates
      setTimeout(async () => {
        if (selectedProject) {
          projectAgents = await fetchProjectAgents(selectedProject.id);
        }
      }, 3000);
    } else {
      formError = 'Failed to send spawn request to main agent. Make sure OpenClaw gateway is running.';
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
    showImportModal = false;
    showSpawnAgentModal = false;
    showDeleteConfirm = false;
    showDeleteAgentConfirm = false;
    showMessageModal = false;
    showModelModal = false;
    selectedAgent = null;
    agentToDelete = null;
    agentToChangeModel = null;
    selectedModel = '';
    agentTask = '';
    selectedFolderId = '';
    importDescription = '';
    formError = '';
  }

  function openModelModal(agent: AgentAssociation) {
    agentToChangeModel = agent;
    selectedModel = agent.model || 'anthropic/claude-sonnet-4-6';
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
  
  function formatMilestoneDate(dateStr?: string): string {
    if (!dateStr) return 'No date';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getMilestoneProgress(m: Milestone): number {
    if (!m.totalTasks) return 0;
    return Math.round((m.doneTasks / m.totalTasks) * 100);
  }

  function isMilestoneOverdue(m: Milestone): boolean {
    if (!m.targetDate || m.status === 'closed') return false;
    return new Date(m.targetDate) < new Date();
  }

  async function handleCreateMilestone() {
    if (!selectedProject || !newMilestoneName.trim()) {
      milestoneFormError = 'Milestone name is required';
      return;
    }
    milestoneFormLoading = true;
    milestoneFormError = '';
    try {
      const m = await createMilestone({
        projectId: selectedProject.id,
        name: newMilestoneName.trim(),
        description: newMilestoneDescription.trim() || undefined,
        targetDate: newMilestoneTargetDate || undefined,
      });
      milestones = [...milestones, m];
      showNewMilestoneForm = false;
      newMilestoneName = '';
      newMilestoneDescription = '';
      newMilestoneTargetDate = '';
    } catch (e: any) {
      milestoneFormError = e.message || 'Failed to create milestone';
    } finally {
      milestoneFormLoading = false;
    }
  }

  async function handleToggleMilestoneStatus(m: Milestone) {
    try {
      const updated = await updateMilestone(m.id, {
        status: m.status === 'open' ? 'closed' : 'open',
      });
      milestones = milestones.map(x => x.id === m.id ? updated : x);
    } catch (e: any) {
      console.error('Failed to toggle milestone status:', e);
    }
  }

  function startEditMilestone(m: Milestone) {
    editingMilestoneId = m.id;
    editMilestoneName = m.name;
    editMilestoneDescription = m.description || '';
    editMilestoneTargetDate = m.targetDate ? m.targetDate.slice(0, 10) : '';
  }

  async function handleSaveEditMilestone() {
    if (!editingMilestoneId || !editMilestoneName.trim()) return;
    editMilestoneLoading = true;
    try {
      const updated = await updateMilestone(editingMilestoneId, {
        name: editMilestoneName.trim(),
        description: editMilestoneDescription.trim() || undefined,
        targetDate: editMilestoneTargetDate || undefined,
      });
      milestones = milestones.map(x => x.id === updated.id ? updated : x);
      editingMilestoneId = null;
    } catch (e: any) {
      console.error('Failed to update milestone:', e);
    } finally {
      editMilestoneLoading = false;
    }
  }

  async function handleDeleteMilestone(m: Milestone) {
    if (!confirm(`Delete milestone "${m.name}"?`)) return;
    try {
      await deleteMilestone(m.id);
      milestones = milestones.filter(x => x.id !== m.id);
    } catch (e: any) {
      alert(e.message || 'Failed to delete milestone');
    }
  }

  onMount(() => {
    loadProjects();
  });
</script>

<!-- Modal Backdrop -->
{#if showNewProjectModal || showImportModal || showSpawnAgentModal || showDeleteConfirm || showDeleteAgentConfirm || showModelModal}
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="new-project-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
        <h2 id="new-project-title" class="font-semibold">New Project</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        <div>
          <label for="new-project-name" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Project Name</label>
          <input 
            id="new-project-name"
            type="text" 
            bind:value={newProjectName}
            placeholder="My New Project"
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label for="new-project-description" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Description (optional)</label>
          <textarea 
            id="new-project-description"
            bind:value={newProjectDescription}
            placeholder="Brief description of the project..."
            rows="3"
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
          ></textarea>
        </div>
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
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

<!-- Import Project Modal -->
{#if showImportModal}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="import-project-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
        <h2 id="import-project-title" class="font-semibold">📥 Import Existing Folder</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        
        {#if loadingImportable}
          <div class="text-center py-8 text-slate-500">Loading folders...</div>
        {:else if importableFolders.length === 0}
          <div class="p-4 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-blue-400">
            No importable folders found. All workspace folders already have PROJECT.md.
          </div>
        {:else}
          <div>
            <label for="import-folder-select" class="block text-sm text-slate-500 dark:text-slate-400 mb-2">Select Folder</label>
            <div class="space-y-2 max-h-64 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded p-2">
              {#each importableFolders as folder}
                <button
                  on:click={() => selectedFolderId = folder.id}
                  class="w-full text-left p-3 rounded transition-colors
                    {selectedFolderId === folder.id ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-gray-100 dark:bg-slate-700/50 hover:bg-slate-700 border border-transparent'}"
                >
                  <div class="flex items-center gap-2">
                    <span>📁</span>
                    <div class="flex-1">
                      <div class="font-medium text-sm">{folder.name}</div>
                      <div class="text-xs text-slate-500">{folder.path}</div>
                    </div>
                    {#if selectedFolderId === folder.id}
                      <span class="text-blue-400">✓</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          </div>
          
          <div>
            <label for="import-description" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Description (optional)</label>
            <textarea 
              id="import-description"
              bind:value={importDescription}
              placeholder="Brief description of the project..."
              rows="3"
              class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
            ></textarea>
          </div>
          
          <p class="text-xs text-slate-500">
            This will create PROJECT.md in the selected folder if it doesn't exist.
          </p>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleImportProject}
          disabled={formLoading || !selectedFolderId || loadingImportable}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Importing...' : 'Import Project'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Spawn Agent Modal -->
{#if showSpawnAgentModal}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-lg" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="spawn-agent-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
        <h2 id="spawn-agent-title" class="font-semibold">🚀 Spawn Agent</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm whitespace-pre-wrap">{formError}</div>
        {/if}
        
        {#if selectedProject}
          <div class="p-3 bg-blue-500/10 border border-blue-500/30 rounded text-sm">
            <span class="text-blue-400">📁 Project:</span> {selectedProject.name}
            <div class="text-xs text-slate-500 mt-1">{selectedProject.path}</div>
          </div>
        {/if}
        
        <div>
          <label for="agent-task" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Task (optional)</label>
          <textarea 
            id="agent-task"
            bind:value={agentTask}
            placeholder="What should this agent work on? Leave empty for a general-purpose project agent."
            rows="3"
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-green-500 focus:outline-none resize-none"
          ></textarea>
        </div>
        
        <p class="text-slate-500 text-xs">
          This will ask the primary agent to spawn a subagent for this project. The subagent runs in isolation and reports back when complete.
        </p>
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          Cancel
        </button>
        <button 
          on:click={handleSpawnAgent}
          disabled={formLoading}
          class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Spawning...' : '🚀 Spawn Agent'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Message Agent Modal -->
{#if showMessageModal && selectedAgent}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="message-agent-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
        <h2 id="message-agent-title" class="font-semibold">💬 Message Agent</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        
        <div class="p-3 bg-gray-100 dark:bg-gray-100/50 dark:bg-slate-700/50 rounded text-sm">
          <div class="flex items-center gap-2 mb-1">
            <span>{getAgentStatusIcon(selectedAgent.status)}</span>
            <span class="font-medium">{selectedAgent.label || getShortSessionKey(selectedAgent.sessionKey)}</span>
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{selectedAgent.task}</div>
        </div>
        
        <div>
          <label for="agent-message" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Message</label>
          <textarea 
            id="agent-message"
            bind:value={agentMessage}
            placeholder="Send a message to this agent..."
            rows="3"
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
          ></textarea>
        </div>
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-sm" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <h2 id="delete-confirm-title" class="font-semibold text-red-400">⚠️ Delete Project</h2>
      </div>
      <div class="p-4">
        <p class="text-slate-600 dark:text-slate-300">Are you sure you want to delete <strong>{selectedProject?.name}</strong>?</p>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-2">The project will be moved to trash and can be recovered.</p>
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-sm" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="delete-agent-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <h2 id="delete-agent-title" class="font-semibold text-red-400">🗑️ Delete Agent</h2>
      </div>
      <div class="p-4">
        <p class="text-slate-600 dark:text-slate-300">Are you sure you want to delete agent <strong>{agentToDelete?.label || 'this agent'}</strong>?</p>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-2">This will permanently delete the agent session and its history.</p>
        {#if formError}
          <p class="text-sm text-red-400 mt-2">{formError}</p>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-sm" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="model-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
        <h2 id="model-title" class="font-semibold text-purple-400">⚙️ Change Model</h2>
      </div>
      <div class="p-4 space-y-4">
        <p class="text-slate-600 dark:text-slate-300 text-sm">Select model for <strong>{agentToChangeModel.label || 'agent'}</strong>:</p>
        <select 
          bind:value={selectedModel}
          class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-purple-500 focus:outline-none"
        >
          <option value="anthropic/claude-opus-4-6">Claude Opus 4</option>
          <option value="anthropic/claude-sonnet-4-6">Claude Sonnet 4</option>
          <option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5</option>
        </select>
        {#if formError}
          <p class="text-sm text-red-400">{formError}</p>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2">
        <button 
          on:click={closeModals}
          class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
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
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 flex flex-col">
    <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
      <h2 class="font-semibold">Projects</h2>
      <div class="flex items-center gap-2">
        <button 
          on:click={() => showNewProjectModal = true}
          class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
        >
          + New
        </button>
        <button 
          on:click={openImportModal}
          class="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-medium transition-colors"
        >
          📥 Import
        </button>
        <button on:click={loadProjects} class="text-xs text-slate-500 hover:text-slate-600 dark:text-slate-300">↻</button>
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
            on:click={() => {
              selectProject(project.id);
            }}
            class="w-full text-left p-3 rounded-lg transition-colors
              {selectedProject?.id === project.id ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-gray-100 dark:bg-gray-100/50 dark:bg-slate-700/50 hover:bg-gray-100 dark:bg-slate-700 border border-transparent'}"
          >
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span>📁</span>
                <span class="font-medium">{project.name}</span>
              </div>
            </div>
            <div class="text-xs text-slate-500">{project.path}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">{getProjectStats(project.id).completed}/{getProjectStats(project.id).total} tasks</div>
            {#if project.updated}
              <div class="text-xs text-slate-500 mt-1">Updated {formatRelativeTime(project.updated)}</div>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
  
  <!-- Project Detail -->
  <div class="col-span-2 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 flex flex-col">
    {#if !selectedProject}
      <div class="flex-1 flex items-center justify-center text-slate-500">
        Select a project to view details
      </div>
    {:else if loadingDetail}
      <div class="flex-1 flex items-center justify-center text-slate-500">
        Loading project details...
      </div>
    {:else}
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
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
            on:click={() => goto(`/projects/${selectedProject?.id}`)}
            class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium transition-colors"
          >
            View Full →
          </button>
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
          <h3 class="text-sm text-slate-500 dark:text-slate-400 mb-2 font-medium">ACTIONS</h3>
          <div class="flex gap-2 flex-wrap">
            <button 
              on:click={() => showSpawnAgentModal = true}
              class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
            >
              🚀 Spawn Agent
            </button>
            <button class="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors">
              📂 Open in Terminal
            </button>
          </div>
        </div>
        
        <!-- Milestones -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm text-slate-500 dark:text-slate-400 font-medium">🎯 MILESTONES</h3>
            <button
              on:click={() => { showNewMilestoneForm = !showNewMilestoneForm; milestoneFormError = ''; }}
              class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              + New
            </button>
          </div>

          {#if showNewMilestoneForm}
            <div class="mb-3 p-3 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 space-y-2">
              {#if milestoneFormError}
                <div class="text-xs text-red-400">{milestoneFormError}</div>
              {/if}
              <input
                type="text"
                bind:value={newMilestoneName}
                placeholder="Milestone name (e.g. v1.1 Release)"
                class="w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded focus:border-blue-500 focus:outline-none"
              />
              <textarea
                bind:value={newMilestoneDescription}
                placeholder="Description (optional)"
                rows="2"
                class="w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded focus:border-blue-500 focus:outline-none resize-none"
              ></textarea>
              <input
                type="date"
                bind:value={newMilestoneTargetDate}
                class="w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded focus:border-blue-500 focus:outline-none"
              />
              <div class="flex gap-2 justify-end">
                <button
                  on:click={() => { showNewMilestoneForm = false; milestoneFormError = ''; }}
                  class="px-3 py-1 text-xs bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >Cancel</button>
                <button
                  on:click={handleCreateMilestone}
                  disabled={milestoneFormLoading}
                  class="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
                >{milestoneFormLoading ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          {/if}

          {#if milestones.length === 0}
            <div class="p-3 bg-gray-100 dark:bg-slate-700/30 rounded-lg text-center text-sm text-slate-500 dark:text-slate-400 italic">
              No milestones yet
            </div>
          {:else}
            <div class="space-y-2">
              {#each milestones.filter(m => m.status === 'open') as m}
                {@const progress = getMilestoneProgress(m)}
                {@const overdue = isMilestoneOverdue(m)}
                <div class="p-3 bg-gray-100 dark:bg-slate-700/50 rounded-lg">
                  {#if editingMilestoneId === m.id}
                    <!-- Edit form -->
                    <div class="space-y-2">
                      <input
                        type="text"
                        bind:value={editMilestoneName}
                        class="w-full px-2 py-1 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded focus:border-blue-500 focus:outline-none"
                        placeholder="Milestone name"
                      />
                      <textarea
                        bind:value={editMilestoneDescription}
                        rows="2"
                        class="w-full px-2 py-1 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded focus:border-blue-500 focus:outline-none resize-none"
                        placeholder="Description (optional)"
                      ></textarea>
                      <input
                        type="date"
                        bind:value={editMilestoneTargetDate}
                        class="w-full px-2 py-1 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded focus:border-blue-500 focus:outline-none"
                      />
                      <div class="flex gap-2 justify-end">
                        <button
                          on:click={() => editingMilestoneId = null}
                          class="px-2 py-1 text-xs bg-gray-100 dark:bg-slate-700 hover:bg-slate-600 rounded"
                        >Cancel</button>
                        <button
                          on:click={handleSaveEditMilestone}
                          disabled={editMilestoneLoading}
                          class="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
                        >{editMilestoneLoading ? 'Saving...' : 'Save'}</button>
                      </div>
                    </div>
                  {:else}
                    <!-- View mode -->
                    <div class="flex items-start justify-between mb-1">
                      <button
                        on:click={() => goto(`/tasks?milestone=${m.id}`)}
                        class="font-medium text-sm text-blue-400 hover:text-blue-300 text-left truncate flex-1"
                      >{m.name}</button>
                      <div class="flex items-center gap-1 ml-2 flex-shrink-0">
                        <button
                          on:click={() => startEditMilestone(m)}
                          title="Edit milestone"
                          class="text-xs text-slate-500 hover:text-blue-400"
                        >✎</button>
                        <button
                          on:click={() => handleToggleMilestoneStatus(m)}
                          title="Close milestone"
                          class="text-xs text-slate-500 hover:text-green-400"
                        >✓</button>
                        <button
                          on:click={() => handleDeleteMilestone(m)}
                          title="Delete milestone"
                          class="text-xs text-slate-500 hover:text-red-400"
                        >✕</button>
                      </div>
                    </div>
                    <div class="text-xs {overdue ? 'text-red-400' : 'text-slate-500 dark:text-slate-400'} mb-2">
                      {overdue ? '⚠️ ' : '📅 '}{formatMilestoneDate(m.targetDate)}
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-slate-600 rounded-full h-1.5 mb-1">
                      <div class="bg-blue-500 h-1.5 rounded-full" style="width: {progress}%"></div>
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">{m.doneTasks}/{m.totalTasks} done · {progress}%</div>
                  {/if}
                </div>
              {/each}

              {#if milestones.some(m => m.status === 'closed')}
                <div class="mt-2">
                  {#each milestones.filter(m => m.status === 'closed') as m}
                    <div class="flex items-center gap-2 p-2 opacity-50">
                      <span class="text-xs text-green-400">✓</span>
                      <span class="text-xs text-slate-500 truncate flex-1">{m.name}</span>
                      <button
                        on:click={() => handleToggleMilestoneStatus(m)}
                        title="Reopen"
                        class="text-xs text-slate-500 hover:text-blue-400"
                      >↩</button>
                      <button
                        on:click={() => handleDeleteMilestone(m)}
                        title="Delete"
                        class="text-xs text-slate-500 hover:text-red-400"
                      >✕</button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Cost Savings -->
        <div>
          <h3 class="text-sm text-slate-500 dark:text-slate-400 mb-2 font-medium">💰 COST SAVINGS</h3>
          {#if projectCost && projectCost.tasks > 0}
            <div class="p-3 bg-gray-100 dark:bg-slate-700/50 rounded-lg space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm text-slate-500 dark:text-slate-400">Saved</span>
                <span class="text-lg font-bold text-green-400">{formatCostCurrency(projectCost.savings)}</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-500 dark:text-slate-400">AI Cost</span>
                <span class="text-slate-600 dark:text-slate-300">{formatCostCurrency(projectCost.aiCost)}</span>
              </div>
              {#if projectCost.aiCost > 0}
                <div class="flex items-center justify-between text-sm">
                  <span class="text-slate-500 dark:text-slate-400">ROI</span>
                  <span class="text-yellow-400 font-medium">{(projectCost.humanCost / projectCost.aiCost).toFixed(1)}x</span>
                </div>
              {/if}
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-500 dark:text-slate-400">Hours saved</span>
                <span class="text-slate-600 dark:text-slate-300">{(projectCost.humanCost / humanHourlyRate).toFixed(1)} hrs</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-500 dark:text-slate-400">Tasks completed</span>
                <span class="text-slate-600 dark:text-slate-300">{projectCost.tasks}</span>
              </div>
            </div>
          {:else}
            <div class="p-3 bg-gray-100 dark:bg-slate-700/30 rounded-lg text-center text-sm text-slate-500 dark:text-slate-400 italic">
              No completed tasks yet
            </div>
          {/if}
        </div>
        
        <!-- Agent Roster (deduplicated from tasks) -->
        <div>
          <h3 class="text-sm text-slate-500 dark:text-slate-400 mb-2 font-medium flex items-center justify-between">
            <span>AGENT ROSTER ({agentSummary.length})</span>
            <button 
              on:click={() => selectedProject && selectProject(selectedProject.id)}
              class="text-xs text-slate-500 hover:text-slate-600 dark:text-slate-300"
            >
              ↻ Refresh
            </button>
          </h3>
          
          {#if agentSummary.length === 0}
            <div class="p-4 bg-gray-100 dark:bg-gray-100/50 dark:bg-slate-700/30 rounded-lg text-center text-slate-500 text-sm">
              No agents have worked on this project yet.
            </div>
          {:else}
            <div class="grid grid-cols-1 gap-2">
              {#each agentSummary as agent}
                <div class="p-3 bg-gray-100 dark:bg-slate-700/50 rounded-lg">
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <span class="text-lg">{agent.agentId === 'senior-dev' ? '👨‍💻' : agent.agentId === 'junior-dev' ? '👩‍💻' : agent.agentId === 'cso' ? '🔵' : agent.agentId === 'editor' ? '✍️' : agent.agentId === 'qa' ? '🔍' : '🤖'}</span>
                      <span class="font-medium text-sm text-gray-900 dark:text-slate-200">{agent.agentId}</span>
                    </div>
                    <span class="text-xs text-slate-500">{formatRelativeTime(agent.lastActive)}</span>
                  </div>
                  <div class="flex items-center gap-3 text-xs">
                    <span class="px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full">{agent.doneTasks} done</span>
                    {#if agent.inProgress > 0}
                      <span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">{agent.inProgress} active</span>
                    {/if}
                    <span class="text-slate-500">{agent.taskCount} total</span>
                  </div>
                  {#if agent.models.length > 0}
                    <div class="mt-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                      🧠 {agent.models.map(m => m.split('/').pop()).join(', ')}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
        
        <!-- Files -->
        {#if selectedProject.files && selectedProject.files.length > 0}
          <div>
            <h3 class="text-sm text-slate-500 dark:text-slate-400 mb-2 font-medium">FILES</h3>
            <div class="flex flex-wrap gap-2">
              {#each selectedProject.files as file}
                <span class="px-2 py-1 bg-gray-100 dark:bg-slate-700 rounded text-sm font-mono">
                  {file.endsWith('/') ? '📁' : '📄'} {file}
                </span>
              {/each}
            </div>
          </div>
        {/if}
        
        <!-- PROJECT.md -->
        {#if selectedProject.projectMd}
          <div>
            <h3 class="text-sm text-slate-500 dark:text-slate-400 mb-2 font-medium">PROJECT.MD</h3>
            <div class="p-4 bg-gray-50 dark:bg-slate-900 rounded-lg font-mono text-sm whitespace-pre-wrap overflow-x-auto max-h-96">
              {selectedProject.projectMd}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
