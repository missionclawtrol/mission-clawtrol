// Mission Clawtrol - Task Kanban Board

<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchTasks, createTask, updateTask, deleteTask, fetchProjects, fetchAgents, fetchSettings, type Task, type Project, type Agent, type Settings } from '$lib/api';
  
  // Data
  let tasks: Task[] = [];
  let projects: Project[] = [];
  let agents: Agent[] = [];
  let settings: Settings = { humanHourlyRate: 100 };
  let loading = true;
  
  // UI state
  let showNewTaskModal = false;
  let showTaskDetail = false;
  let showEstimateModal = false;
  let selectedTask: Task | null = null;
  let draggedTask: Task | null = null;
  let dragOverColumn: string | null = null;
  
  // Form state
  let formError = '';
  let formLoading = false;
  let newTask = {
    title: '',
    description: '',
    projectId: '',
    agentId: '',
    priority: 'P2' as const,
  };

  // Estimate form state
  let estimateForm = {
    estimatedHumanMinutes: 0,
    complexity: 'medium' as 'simple' | 'medium' | 'complex',
    humanHourlyRate: 100,
  };
  
  // Kanban columns configuration
  const columns = [
    { id: 'backlog', name: 'Backlog', color: 'bg-gray-500' },
    { id: 'todo', name: 'To Do', color: 'bg-blue-500' },
    { id: 'in-progress', name: 'In Progress', color: 'bg-yellow-500' },
    { id: 'review', name: 'Review', color: 'bg-purple-500' },
    { id: 'done', name: 'Done', color: 'bg-green-500' },
  ];
  
  async function loadData() {
    loading = true;
    const [tasksData, projectsData, agentsData, settingsData] = await Promise.all([
      fetchTasks(),
      fetchProjects(),
      fetchAgents(),
      fetchSettings(),
    ]);
    tasks = tasksData;
    projects = projectsData;
    agents = agentsData;
    settings = settingsData;
    loading = false;
  }
  
  function getTasksForColumn(columnId: string): Task[] {
    return tasks.filter(t => t.status === columnId);
  }
  
  function getPriorityColor(priority: string): string {
    switch (priority) {
      case 'P0': return 'bg-red-500';
      case 'P1': return 'bg-orange-500';
      case 'P2': return 'bg-blue-500';
      case 'P3': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  }
  
  function formatTokens(total: number): string {
    if (total >= 1_000_000) {
      return `${(total / 1_000_000).toFixed(1)}M`;
    } else if (total >= 1_000) {
      return `${(total / 1_000).toFixed(0)}K`;
    }
    return total.toString();
  }
  
  function formatRuntime(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    const seconds = Math.round(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${seconds}s`;
  }

  function suggestHumanMinutes(complexity: string, aiRuntimeMs: number): number {
    const aiMinutes = aiRuntimeMs / 60000;
    switch (complexity) {
      case 'simple':
        return Math.max(30, Math.round(aiMinutes * 20));
      case 'medium':
        return Math.max(60, Math.round(aiMinutes * 40));
      case 'complex':
        return Math.max(120, Math.round(aiMinutes * 60));
      default:
        return Math.round(aiMinutes * 30);
    }
  }

  function formatMinutes(mins: number): string {
    if (mins < 60) {
      return `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours}h`;
  }

  function calculateSavings(task: Task): { timeSavedMinutes: number; moneySavedUSD: number } | null {
    if (!task.estimatedHumanMinutes || !task.runtime) {
      return null;
    }

    const humanMinutes = task.estimatedHumanMinutes;
    const aiMinutes = task.runtime / 60000;
    const timeSavedMinutes = Math.max(0, humanMinutes - aiMinutes);

    const hourlyRate = task.humanHourlyRate || settings.humanHourlyRate;
    const humanCost = (humanMinutes / 60) * hourlyRate;
    const aiCost = task.cost || 0;
    const moneySavedUSD = Math.max(0, humanCost - aiCost);

    return { timeSavedMinutes, moneySavedUSD };
  }

  function openEstimateModal(task: Task) {
    selectedTask = task;
    estimateForm.estimatedHumanMinutes = task.estimatedHumanMinutes || 0;
    estimateForm.complexity = task.complexity || 'medium';
    estimateForm.humanHourlyRate = task.humanHourlyRate || settings.humanHourlyRate;
    showEstimateModal = true;
  }

  async function handleSaveEstimate() {
    if (!selectedTask) return;

    formLoading = true;
    formError = '';

    const result = await updateTask(selectedTask.id, {
      estimatedHumanMinutes: estimateForm.estimatedHumanMinutes || undefined,
      complexity: estimateForm.complexity,
      humanHourlyRate: estimateForm.humanHourlyRate !== settings.humanHourlyRate ? estimateForm.humanHourlyRate : undefined,
    });

    formLoading = false;

    if (result.success) {
      showEstimateModal = false;
      await loadData();
    } else {
      formError = result.error || 'Failed to save estimate';
    }
  }

  function autoSuggestHumanTime() {
    if (selectedTask?.runtime && estimateForm.complexity) {
      estimateForm.estimatedHumanMinutes = suggestHumanMinutes(estimateForm.complexity, selectedTask.runtime);
    }
  }
  
  function getProjectName(projectId: string): string {
    return projects.find(p => p.id === projectId)?.name || 'Unknown';
  }
  
  function getAgentInfo(agentId?: string): { emoji: string; name: string } {
    if (!agentId) return { emoji: '❓', name: 'Unassigned' };
    const agent = agents.find(a => a.id === agentId);
    return {
      emoji: agent?.emoji || '🤖',
      name: agent?.name || 'Unknown Agent',
    };
  }
  
  async function handleCreateTask() {
    if (!newTask.title.trim()) {
      formError = 'Task title is required';
      return;
    }
    
    if (!newTask.projectId) {
      formError = 'Project is required';
      return;
    }
    
    formLoading = true;
    formError = '';
    
    const result = await createTask({
      title: newTask.title.trim(),
      description: newTask.description.trim(),
      projectId: newTask.projectId,
      agentId: newTask.agentId || undefined,
      priority: newTask.priority,
      status: 'backlog',
    });
    
    formLoading = false;
    
    if (result.success) {
      showNewTaskModal = false;
      newTask = { title: '', description: '', projectId: '', agentId: '', priority: 'P2' };
      await loadData();
    } else {
      formError = result.error || 'Failed to create task';
    }
  }
  
  async function handleDeleteTask(taskId: string) {
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    const result = await deleteTask(taskId);
    if (result.success) {
      await loadData();
      showTaskDetail = false;
      selectedTask = null;
    }
  }
  
  // Drag and drop handlers
  function handleDragStart(task: Task) {
    draggedTask = task;
  }
  
  function handleDragOver(columnId: string, e: DragEvent) {
    e.preventDefault();
    dragOverColumn = columnId;
  }
  
  function handleDragLeave() {
    dragOverColumn = null;
  }
  
  async function handleDrop(columnId: string, e: DragEvent) {
    e.preventDefault();
    dragOverColumn = null;
    
    if (!draggedTask) return;
    
    // Update task status
    const result = await updateTask(draggedTask.id, {
      status: columnId as any,
    });
    
    if (result.success) {
      await loadData();
    }
    
    draggedTask = null;
  }
  
  function closeModals() {
    showNewTaskModal = false;
    showTaskDetail = false;
    showEstimateModal = false;
    selectedTask = null;
    formError = '';
  }
  
  onMount(() => {
    loadData();
  });
</script>

<!-- Modal Backdrop -->
{#if showNewTaskModal || showTaskDetail || showEstimateModal}
  <button 
    class="fixed inset-0 bg-black/50 z-40 cursor-default"
    on:click={closeModals}
    on:keydown={(e) => e.key === 'Escape' && closeModals()}
    aria-label="Close modal"
  ></button>
{/if}

<!-- New Task Modal -->
{#if showNewTaskModal}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="new-task-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="new-task-title" class="font-semibold">New Task</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        
        <div>
          <label for="task-title" class="block text-sm text-slate-400 mb-1">Title *</label>
          <input 
            id="task-title"
            type="text" 
            bind:value={newTask.title}
            placeholder="Task title"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          />
        </div>
        
        <div>
          <label for="task-description" class="block text-sm text-slate-400 mb-1">Description</label>
          <textarea 
            id="task-description"
            bind:value={newTask.description}
            placeholder="Task description..."
            rows="3"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
          ></textarea>
        </div>
        
        <div>
          <label for="task-project" class="block text-sm text-slate-400 mb-1">Project *</label>
          <select 
            id="task-project"
            bind:value={newTask.projectId}
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select a project</option>
            {#each projects as project}
              <option value={project.id}>{project.name}</option>
            {/each}
          </select>
        </div>
        
        <div>
          <label for="task-agent" class="block text-sm text-slate-400 mb-1">Assign To</label>
          <select 
            id="task-agent"
            bind:value={newTask.agentId}
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="">Unassigned</option>
            {#each agents as agent}
              <option value={agent.id}>{agent.emoji} {agent.name}</option>
            {/each}
          </select>
        </div>
        
        <div>
          <label for="task-priority" class="block text-sm text-slate-400 mb-1">Priority</label>
          <select 
            id="task-priority"
            bind:value={newTask.priority}
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="P0">P0 - Critical</option>
            <option value="P1">P1 - High</option>
            <option value="P2">P2 - Medium</option>
            <option value="P3">P3 - Low</option>
          </select>
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
          on:click={handleCreateTask}
          disabled={formLoading}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Creating...' : 'Create Task'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Task Detail Modal -->
{#if showTaskDetail && selectedTask}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="task-detail-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="task-detail-title" class="font-semibold">Task Details</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        <div>
          <h3 class="font-semibold text-lg">{selectedTask.title}</h3>
        </div>
        
        {#if selectedTask.description}
          <div>
            <h4 class="text-sm text-slate-400 mb-1">Description</h4>
            <p class="text-slate-300">{selectedTask.description}</p>
          </div>
        {/if}
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <h4 class="text-sm text-slate-400 mb-1">Project</h4>
            <p class="text-slate-300">{selectedTask.projectName || getProjectName(selectedTask.projectId)}</p>
          </div>
          
          <div>
            <h4 class="text-sm text-slate-400 mb-1">Priority</h4>
            <div class="flex items-center gap-2">
              <span class={`px-2 py-1 rounded text-xs text-white font-semibold ${getPriorityColor(selectedTask.priority)}`}>
                {selectedTask.priority}
              </span>
            </div>
          </div>
        </div>
        
        <div>
          <h4 class="text-sm text-slate-400 mb-1">Assigned To</h4>
          <div class="flex items-center gap-2">
            <span>{getAgentInfo(selectedTask.agentId).emoji}</span>
            <span class="text-slate-300">{getAgentInfo(selectedTask.agentId).name}</span>
          </div>
        </div>
        
        <div>
          <h4 class="text-sm text-slate-400 mb-1">Status</h4>
          <div class="text-slate-300 capitalize">{selectedTask.status.replace('_', ' ')}</div>
        </div>

        {#if selectedTask.status === 'done' && selectedTask.runtime}
          <div class="pt-2 border-t border-slate-700">
            <h4 class="text-sm text-slate-400 mb-2">AI Performance</h4>
            <div class="space-y-1 text-sm">
              <p class="text-slate-300">
                ⏱️ AI Time: <span class="font-semibold">{formatRuntime(selectedTask.runtime)}</span>
              </p>
              {#if selectedTask.estimatedHumanMinutes}
                <p class="text-slate-300">
                  👤 Human Est: <span class="font-semibold">{formatMinutes(selectedTask.estimatedHumanMinutes)}</span>
                </p>
              {/if}
              {#if selectedTask.estimatedHumanMinutes && selectedTask.runtime}
                {@const savings = calculateSavings(selectedTask)}
                {#if savings}
                  <p class="text-green-400 font-semibold">
                    ⏱️ Time Saved: {formatMinutes(savings.timeSavedMinutes)}
                  </p>
                  <p class="text-green-400 font-semibold">
                    💰 Money Saved: ${savings.moneySavedUSD.toFixed(2)}
                  </p>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-between gap-2">
        <button 
          on:click={() => handleDeleteTask(selectedTask!.id)}
          class="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-sm font-medium transition-colors"
        >
          🗑️ Delete
        </button>
        <div class="flex gap-2">
          {#if selectedTask.status === 'done'}
            <button 
              on:click={() => openEstimateModal(selectedTask!)}
              class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
            >
              📊 {selectedTask.estimatedHumanMinutes ? 'Edit' : 'Set'} Estimate
            </button>
          {/if}
          <button 
            on:click={closeModals}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Estimate Modal -->
{#if showEstimateModal && selectedTask}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="estimate-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="estimate-title" class="font-semibold">Set Human Estimate</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}

        <div>
          <label for="complexity" class="block text-sm text-slate-400 mb-1">Task Complexity *</label>
          <select 
            id="complexity"
            bind:value={estimateForm.complexity}
            on:change={autoSuggestHumanTime}
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="simple">Simple (30 min baseline)</option>
            <option value="medium">Medium (1 hour baseline)</option>
            <option value="complex">Complex (2 hour baseline)</option>
          </select>
          <p class="text-xs text-slate-500 mt-1">Select based on how complex the task is for a human developer</p>
        </div>

        <div>
          <label for="humanMinutes" class="block text-sm text-slate-400 mb-1">Estimated Time (minutes) *</label>
          <div class="flex gap-2">
            <input 
              id="humanMinutes"
              type="number" 
              bind:value={estimateForm.estimatedHumanMinutes}
              min="1"
              placeholder="Enter minutes"
              class="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
            />
            <button 
              on:click={autoSuggestHumanTime}
              class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
            >
              Auto
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-1">How long would this take a human developer?</p>
        </div>

        <div>
          <label for="hourlyRate" class="block text-sm text-slate-400 mb-1">Hourly Rate ($/hour)</label>
          <input 
            id="hourlyRate"
            type="number" 
            bind:value={estimateForm.humanHourlyRate}
            min="1"
            step="10"
            placeholder="100"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          />
          <p class="text-xs text-slate-500 mt-1">Leave blank to use default (${settings.humanHourlyRate}/hr)</p>
        </div>

        {#if estimateForm.estimatedHumanMinutes && selectedTask.runtime}
          {@const timeSaved = Math.max(0, estimateForm.estimatedHumanMinutes - (selectedTask.runtime / 60000))}
          {@const moneySaved = Math.max(0, ((estimateForm.estimatedHumanMinutes / 60) * estimateForm.humanHourlyRate) - (selectedTask.cost || 0))}
          <div class="p-3 bg-slate-700/40 rounded border border-slate-600">
            <h4 class="text-sm text-slate-300 mb-2 font-semibold">💰 ROI Preview</h4>
            <div class="text-xs text-slate-400 space-y-1">
              <p>Human time: {formatMinutes(estimateForm.estimatedHumanMinutes)}</p>
              <p>Human cost: ${((estimateForm.estimatedHumanMinutes / 60) * estimateForm.humanHourlyRate).toFixed(2)}</p>
              <p>AI time: {formatRuntime(selectedTask.runtime)}</p>
              <p>AI cost: ${(selectedTask.cost || 0).toFixed(2)}</p>
              <p class="text-green-400 font-semibold pt-1 border-t border-slate-600">Time saved: {formatMinutes(timeSaved)}</p>
              <p class="text-green-400 font-semibold">Money saved: ${moneySaved.toFixed(2)}</p>
            </div>
          </div>
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
          on:click={handleSaveEstimate}
          disabled={formLoading || !estimateForm.estimatedHumanMinutes}
          class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Saving...' : 'Save Estimate'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Main Content -->
<div class="space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-semibold">📋 Tasks</h1>
    <button 
      on:click={() => showNewTaskModal = true}
      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
    >
      + New Task
    </button>
  </div>
  
  <!-- Kanban Board -->
  {#if loading}
    <div class="text-center py-12 text-slate-500">
      <div class="text-2xl mb-2">⏳</div>
      <div>Loading tasks...</div>
    </div>
  {:else}
    <div class="grid grid-cols-5 gap-4 overflow-x-auto pb-4">
      {#each columns as column}
        <div 
          class="bg-slate-700/30 rounded-lg border border-slate-600 flex flex-col min-w-80 max-h-[calc(100vh-200px)]"
          on:dragover={(e) => handleDragOver(column.id, e)}
          on:dragleave={handleDragLeave}
          on:drop={(e) => handleDrop(column.id, e)}
        >
          <!-- Column Header -->
          <div class="px-4 py-3 border-b border-slate-600 flex items-center gap-2 bg-slate-800/50">
            <div class="w-3 h-3 rounded-full {column.color}"></div>
            <h2 class="font-semibold text-sm">{column.name}</h2>
            <span class="ml-auto text-xs text-slate-400 bg-slate-700 px-2 py-1 rounded">
              {getTasksForColumn(column.id).length}
            </span>
          </div>
          
          <!-- Cards Container -->
          <div class="flex-1 p-3 space-y-2 overflow-y-auto {dragOverColumn === column.id ? 'bg-slate-600/20' : ''}">
            {#each getTasksForColumn(column.id) as task (task.id)}
              <div 
                draggable="true"
                on:dragstart={() => handleDragStart(task)}
                on:click={() => { selectedTask = task; showTaskDetail = true; }}
                class="p-3 bg-slate-800 rounded-lg border border-slate-600 hover:border-slate-500 cursor-move hover:bg-slate-700/80 transition-colors"
              >
                <!-- Title -->
                <h3 class="font-semibold text-sm mb-1">{task.title}</h3>
                
                <!-- Project Name -->
                <p class="text-xs text-slate-400 mb-2">{task.projectName || getProjectName(task.projectId)}</p>
                
                <!-- Token/Cost Info (for completed tasks) -->
                {#if task.status === 'done' && (task.tokens || task.cost)}
                  <div class="mb-2 pb-2 border-b border-slate-700 flex gap-2 text-xs text-slate-500">
                    {#if task.tokens}
                      <span>📊 {formatTokens(task.tokens.total)} tokens</span>
                    {/if}
                    {#if task.cost}
                      <span>💰 ${task.cost.toFixed(2)}</span>
                    {/if}
                    {#if task.runtime}
                      <span>⏱️ {formatRuntime(task.runtime)}</span>
                    {/if}
                  </div>

                  <!-- Savings Info (if human estimate exists) -->
                  {#if task.estimatedHumanMinutes && task.runtime}
                    {@const savings = calculateSavings(task)}
                    {#if savings}
                      <div class="mb-2 pb-2 border-b border-slate-700 flex gap-2 text-xs">
                        <span class="text-green-400 font-semibold">⏱️ Saved {formatMinutes(savings.timeSavedMinutes)}</span>
                        <span class="text-green-400 font-semibold">💰 ${savings.moneySavedUSD.toFixed(0)}</span>
                      </div>
                    {/if}
                  {/if}
                {/if}
                
                <!-- Agent + Priority -->
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1">
                    <span class="text-sm">{getAgentInfo(task.agentId).emoji}</span>
                    <span class="text-xs text-slate-400">{getAgentInfo(task.agentId).name}</span>
                  </div>
                  <span class={`px-1.5 py-0.5 rounded text-xs font-semibold text-white ${getPriorityColor(task.priority)}`}>
                    {task.priority}
                  </span>
                </div>
              </div>
            {/each}
            
            <!-- Empty State -->
            {#if getTasksForColumn(column.id).length === 0}
              <div class="flex items-center justify-center h-32 text-slate-500 text-xs">
                No tasks
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
