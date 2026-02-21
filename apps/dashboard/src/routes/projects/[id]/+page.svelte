<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { fetchProject, fetchTasks, createTask, updateTask, deleteTask, type Task, type Project } from '$lib/api';
  import { getApiBase } from '$lib/config';
  
  let projectId = '';
  let project: Project | null = null;
  let tasks: Task[] = [];
  let loading = true;
  let formLoading = false;
  let formError = '';
  
  // Cost data
  interface ProjectCost {
    projectId: string;
    tasks: number;
    lines: number;
    aiCost: number;
    humanCost: number;
    savings: number;
    tokensIn?: number;
    tokensOut?: number;
    totalTokens?: number;
    runtimeSeconds?: number;
  }
  let projectCost: ProjectCost | null = null;
  let humanHourlyRate = 100;
  
  // Modal states
  let showAddTaskModal = false;
  let showGenerateTasksModal = false;
  let showDeleteConfirm = false;
  let taskToDelete: Task | null = null;
  let suggestedTasks: any[] = [];
  let selectedTasks: Set<number> = new Set();
  let generatingTasks = false;
  let creatingTasks = false;
  
  // Form states
  let newTaskTitle = '';
  let newTaskDescription = '';
  let newTaskPriority: 'P0' | 'P1' | 'P2' | 'P3' = 'P2';
  let newTaskStatus: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done' = 'todo';
  
  $: projectId = $page.params.id || '';
  $: if (projectId && !project) loadProject();
  
  async function loadProject() {
    if (!projectId) return;
    loading = true;
    project = await fetchProject(projectId);
    loading = false;
  }
  
  async function loadTasks() {
    if (!projectId) return;
    const allTasks = await fetchTasks();
    tasks = allTasks.filter(t => t.projectId === projectId);
  }
  
  async function loadCosts() {
    if (!projectId) return;
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

      const res = await fetch(`${getApiBase()}/costs/by-project`);
      if (res.ok) {
        const data = await res.json();
        projectCost = (data.projects || []).find((p: ProjectCost) => p.projectId === projectId) || null;
      }
    } catch (e) {
      console.warn('Failed to load cost data:', e);
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
  
  function getTaskStats() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'done').length;
    const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);
    return { total, completed, percentage };
  }
  
  function getProgressColor(percentage: number) {
    if (percentage >= 70) return 'bg-green-600';
    if (percentage >= 30) return 'bg-yellow-600';
    return 'bg-red-600';
  }
  
  function getProgressLabel(percentage: number) {
    if (percentage >= 70) return 'text-green-400';
    if (percentage >= 30) return 'text-yellow-400';
    return 'text-red-400';
  }
  
  function getStatusIcon(status: string): string {
    switch (status) {
      case 'done': return '✅';
      case 'review': return '🔄';
      case 'in-progress': return '⏳';
      case 'todo': return '📋';
      case 'backlog': return '📦';
      default: return '⚪';
    }
  }
  
  function getPriorityColor(priority: string): string {
    switch (priority) {
      case 'P0': return 'bg-red-600 text-white';
      case 'P1': return 'bg-orange-600 text-white';
      case 'P2': return 'bg-blue-600 text-white';
      case 'P3': return 'bg-gray-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  }
  
  async function handleAddTask() {
    if (!newTaskTitle.trim()) {
      formError = 'Task title is required';
      return;
    }
    
    formLoading = true;
    formError = '';
    
    const result = await createTask({
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim(),
      projectId,
      priority: newTaskPriority,
      status: newTaskStatus,
    });
    
    formLoading = false;
    
    if (result.success) {
      showAddTaskModal = false;
      newTaskTitle = '';
      newTaskDescription = '';
      newTaskPriority = 'P2';
      newTaskStatus = 'todo';
      await loadTasks();
    } else {
      formError = result.error || 'Failed to create task';
    }
  }
  
  async function handleDeleteTask() {
    if (!taskToDelete) return;
    
    formLoading = true;
    const result = await deleteTask(taskToDelete.id);
    formLoading = false;
    
    if (result.success) {
      showDeleteConfirm = false;
      taskToDelete = null;
      await loadTasks();
    } else {
      formError = result.error || 'Failed to delete task';
    }
  }
  
  async function handleGenerateTasks() {
    if (!project) return;
    
    generatingTasks = true;
    formError = '';
    
    try {
      // Call the API to parse tasks from PROJECT.md
      const response = await fetch(`${getApiBase()}/projects/${projectId}/parse-tasks`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        const data = await response.json();
        formError = data.error || 'Failed to parse tasks';
        generatingTasks = false;
        return;
      }
      
      const data = await response.json();
      suggestedTasks = data.tasks || [];
      selectedTasks.clear();
      // Pre-select all tasks
      suggestedTasks.forEach((_, idx) => selectedTasks.add(idx));
      showGenerateTasksModal = true;
    } catch (error) {
      formError = 'Failed to parse tasks from PROJECT.md';
    }
    
    generatingTasks = false;
  }
  
  async function handleCreateSuggestedTasks() {
    if (selectedTasks.size === 0) {
      formError = 'Please select at least one task';
      return;
    }
    
    creatingTasks = true;
    formError = '';
    
    const tasksToCreate = suggestedTasks
      .filter((_, idx) => selectedTasks.has(idx))
      .map(t => ({
        title: t.title,
        description: t.description,
        projectId,
        priority: t.priority || 'P2',
        status: t.status || 'backlog',
      }));
    
    try {
      const response = await fetch(`${getApiBase()}/projects/${projectId}/create-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: tasksToCreate }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        formError = data.error || 'Failed to create tasks';
        creatingTasks = false;
        return;
      }
      
      showGenerateTasksModal = false;
      suggestedTasks = [];
      selectedTasks.clear();
      await loadTasks();
    } catch (error) {
      formError = 'Failed to create tasks';
    }
    
    creatingTasks = false;
  }
  
  function toggleTaskSelection(idx: number) {
    if (selectedTasks.has(idx)) {
      selectedTasks.delete(idx);
    } else {
      selectedTasks.add(idx);
    }
    selectedTasks = selectedTasks;
  }
  
  function closeModals() {
    showAddTaskModal = false;
    showGenerateTasksModal = false;
    showDeleteConfirm = false;
    taskToDelete = null;
    newTaskTitle = '';
    newTaskDescription = '';
    newTaskPriority = 'P2';
    newTaskStatus = 'todo';
    formError = '';
  }
  
  function confirmDeleteTask(task: Task) {
    taskToDelete = task;
    showDeleteConfirm = true;
  }
  
  function goBack() {
    goto('/projects');
  }
  
  onMount(() => {
    loadProject();
    loadTasks();
    loadCosts();
  });
</script>

<!-- Modal Backdrop -->
{#if showAddTaskModal || showGenerateTasksModal || showDeleteConfirm}
  <button 
    class="fixed inset-0 bg-black/50 z-40 cursor-default"
    on:click={closeModals}
    on:keydown={(e) => e.key === 'Escape' && closeModals()}
    aria-label="Close modal"
  ></button>
{/if}

<!-- Add Task Modal -->
{#if showAddTaskModal}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="add-task-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="add-task-title" class="font-semibold">+ Add Task</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        <div>
          <label for="task-title" class="block text-sm text-slate-400 mb-1">Task Title</label>
          <input 
            id="task-title"
            type="text" 
            bind:value={newTaskTitle}
            placeholder="Task title..."
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label for="task-description" class="block text-sm text-slate-400 mb-1">Description (optional)</label>
          <textarea 
            id="task-description"
            bind:value={newTaskDescription}
            placeholder="Task description..."
            rows="3"
            class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
          ></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="task-priority" class="block text-sm text-slate-400 mb-1">Priority</label>
            <select 
              id="task-priority"
              bind:value={newTaskPriority}
              class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
            >
              <option value="P0">P0 - Critical</option>
              <option value="P1">P1 - High</option>
              <option value="P2">P2 - Medium</option>
              <option value="P3">P3 - Low</option>
            </select>
          </div>
          <div>
            <label for="task-status" class="block text-sm text-slate-400 mb-1">Status</label>
            <select 
              id="task-status"
              bind:value={newTaskStatus}
              class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded focus:border-blue-500 focus:outline-none"
            >
              <option value="backlog">Backlog</option>
              <option value="todo">To Do</option>
              <option value="in-progress">In Progress</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
            </select>
          </div>
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
          on:click={handleAddTask}
          disabled={formLoading}
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Creating...' : 'Create Task'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Generate Tasks Modal -->
{#if showGenerateTasksModal}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="generate-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <h2 id="generate-title" class="font-semibold">📋 Generate Tasks from PROJECT.md</h2>
        <button on:click={closeModals} class="text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 overflow-y-auto flex-1">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm mb-4">{formError}</div>
        {/if}
        
        {#if suggestedTasks.length === 0}
          <div class="text-center py-8 text-slate-500">
            No tasks found in PROJECT.md
          </div>
        {:else}
          <div class="space-y-2">
            {#each suggestedTasks as task, idx}
              <label class="flex items-start gap-3 p-3 bg-slate-700/50 hover:bg-slate-700 rounded cursor-pointer transition-colors">
                <input 
                  type="checkbox" 
                  checked={selectedTasks.has(idx)}
                  on:change={() => toggleTaskSelection(idx)}
                  class="mt-1"
                />
                <div class="flex-1">
                  <div class="font-medium text-sm">{task.title}</div>
                  {#if task.description}
                    <div class="text-xs text-slate-400 mt-1">{task.description}</div>
                  {/if}
                  <div class="flex items-center gap-2 mt-2">
                    <span class="text-xs px-1.5 py-0.5 {getPriorityColor(task.priority)}">{task.priority}</span>
                    <span class="text-xs text-slate-500">{getStatusIcon(task.status)} {task.status}</span>
                  </div>
                </div>
              </label>
            {/each}
          </div>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-slate-700 flex justify-between items-center">
        <span class="text-sm text-slate-400">{selectedTasks.size} of {suggestedTasks.length} selected</span>
        <div class="flex gap-2">
          <button 
            on:click={closeModals}
            class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button 
            on:click={handleCreateSuggestedTasks}
            disabled={creatingTasks || selectedTasks.size === 0}
            class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            {creatingTasks ? 'Creating...' : `Create ${selectedTasks.size} Task${selectedTasks.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Confirm Modal -->
{#if showDeleteConfirm && taskToDelete}
  <div class="fixed inset-0 flex items-center justify-center z-50 p-4">
    <div class="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-sm" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="delete-task-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-slate-700">
        <h2 id="delete-task-title" class="font-semibold text-red-400">⚠️ Delete Task</h2>
      </div>
      <div class="p-4">
        <p class="text-slate-300">Are you sure you want to delete <strong>{taskToDelete.title}</strong>?</p>
        <p class="text-sm text-slate-400 mt-2">This action cannot be undone.</p>
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
          on:click={handleDeleteTask}
          disabled={formLoading}
          class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {formLoading ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
{/if}

<div class="flex flex-col h-[calc(100vh-180px)] bg-slate-900">
  {#if loading}
    <div class="flex-1 flex items-center justify-center text-slate-500">
      Loading project...
    </div>
  {:else if !project}
    <div class="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4">
      <div class="text-2xl">📁</div>
      <div>Project not found</div>
      <button 
        on:click={goBack}
        class="text-blue-400 hover:text-blue-300"
      >
        ← Back to Projects
      </button>
    </div>
  {:else}
    <!-- Header -->
    <div class="bg-slate-800 border-b border-slate-700 px-6 py-4">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <span class="text-2xl">📁</span>
          <div>
            <h1 class="text-2xl font-bold">{project.name}</h1>
            <p class="text-sm text-slate-400">{project.path}</p>
          </div>
        </div>
        <button 
          on:click={goBack}
          class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
        >
          ← Back
        </button>
      </div>
      
      {#if project.description}
        <p class="text-slate-300 text-sm">{project.description}</p>
      {/if}
    </div>
    
    <!-- Progress Section -->
    <div class="bg-slate-800 border-b border-slate-700 px-6 py-4">
      {#if tasks.length === 0}
        <div class="text-slate-500 text-sm">No tasks yet</div>
      {:else}
        <div>Progress: {getTaskStats().completed}/{getTaskStats().total} tasks ({getTaskStats().percentage}%)</div>
        <div class="mt-2 bg-slate-700 rounded-full h-3 overflow-hidden">
          <div 
            class="h-full {getProgressColor(getTaskStats().percentage)} transition-all"
            style="width: {getTaskStats().percentage}%"
          ></div>
        </div>
        <div class="mt-2 flex items-center justify-between text-xs">
          <span>{getTaskStats().completed}/{getTaskStats().total} tasks</span>
          <span class="{getProgressLabel(getTaskStats().percentage)} font-medium">
            {getTaskStats().percentage}%
          </span>
        </div>
      {/if}
    </div>
    
    <!-- Cost Savings Card -->
    <div class="bg-slate-800 border-b border-slate-700 px-6 py-4">
      <h2 class="text-sm text-slate-400 font-medium mb-3">💰 COST SAVINGS</h2>
      {#if projectCost && projectCost.tasks > 0}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div class="p-3 bg-slate-700/50 rounded-lg">
            <div class="text-xs text-slate-400 mb-1">Saved</div>
            <div class="text-xl font-bold text-green-400">{formatCostCurrency(projectCost.savings)}</div>
          </div>
          <div class="p-3 bg-slate-700/50 rounded-lg">
            <div class="text-xs text-slate-400 mb-1">AI Cost</div>
            <div class="text-base font-semibold text-slate-200">{formatCostCurrency(projectCost.aiCost)}</div>
          </div>
          {#if projectCost.aiCost > 0}
            <div class="p-3 bg-slate-700/50 rounded-lg">
              <div class="text-xs text-slate-400 mb-1">ROI</div>
              <div class="text-base font-semibold text-yellow-400">{(projectCost.humanCost / projectCost.aiCost).toFixed(1)}x</div>
            </div>
          {/if}
          <div class="p-3 bg-slate-700/50 rounded-lg">
            <div class="text-xs text-slate-400 mb-1">Hours saved</div>
            <div class="text-base font-semibold text-slate-200">{(projectCost.humanCost / humanHourlyRate).toFixed(1)} hrs</div>
          </div>
          <div class="p-3 bg-slate-700/50 rounded-lg">
            <div class="text-xs text-slate-400 mb-1">Tasks completed</div>
            <div class="text-base font-semibold text-slate-200">{projectCost.tasks}</div>
          </div>
          {#if projectCost.totalTokens && projectCost.totalTokens > 0}
            <div class="p-3 bg-slate-700/50 rounded-lg col-span-2 sm:col-span-2">
              <div class="text-xs text-slate-400 mb-1">🧠 Tokens Used</div>
              <div class="text-base font-semibold text-amber-400">
                {projectCost.totalTokens >= 1_000_000 
                  ? `${(projectCost.totalTokens / 1_000_000).toFixed(1)}M` 
                  : projectCost.totalTokens >= 1_000 
                    ? `${Math.round(projectCost.totalTokens / 1_000)}K` 
                    : projectCost.totalTokens}
              </div>
              <div class="text-xs text-slate-500 mt-0.5">
                {projectCost.tokensIn != null ? `${Math.round((projectCost.tokensIn || 0) / 1000)}K in` : ''} 
                {projectCost.tokensOut != null ? `/ ${Math.round((projectCost.tokensOut || 0) / 1000)}K out` : ''}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <p class="text-sm text-slate-500 italic">No completed tasks yet</p>
      {/if}
    </div>
    
    <!-- Actions Section -->
    <div class="bg-slate-800 border-b border-slate-700 px-6 py-3 flex gap-2 flex-wrap">
      <button 
        on:click={handleGenerateTasks}
        disabled={generatingTasks}
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors disabled:opacity-50"
      >
        {generatingTasks ? 'Generating...' : '📋 Generate Tasks from PROJECT.md'}
      </button>
      <button 
        on:click={() => showAddTaskModal = true}
        class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
      >
        + Add Task
      </button>
    </div>
    
    <!-- Tasks List -->
    <div class="flex-1 overflow-y-auto px-6 py-4">
      {#if tasks.length === 0}
        <div class="text-center py-8 text-slate-500">
          <div class="text-2xl mb-2">📭</div>
          <div>No tasks yet</div>
          <button 
            on:click={() => showAddTaskModal = true}
            class="mt-3 text-blue-400 hover:text-blue-300"
          >
            Create your first task →
          </button>
        </div>
      {:else}
        <div class="space-y-2">
          {#each tasks as task (task.id)}
            <div class="p-4 bg-slate-800 border border-slate-700 rounded-lg hover:border-slate-600 transition-colors">
              <div class="flex items-start justify-between mb-2">
                <div class="flex items-center gap-3 flex-1">
                  <span class="text-lg">{getStatusIcon(task.status)}</span>
                  <div class="flex-1">
                    <h3 class="font-medium">{task.title}</h3>
                    {#if task.description}
                      <p class="text-sm text-slate-400 mt-1">{task.description}</p>
                    {/if}
                  </div>
                </div>
                <div class="flex items-center gap-2 ml-2">
                  <span class="text-xs px-2 py-1 {getPriorityColor(task.priority)}">{task.priority}</span>
                  <span class="text-xs px-2 py-1 bg-slate-700 text-slate-300 rounded capitalize">{task.status}</span>
                </div>
              </div>
              {#if task.agentName}
                <div class="text-xs text-slate-400 mb-2 ml-7">
                  🤖 {task.agentEmoji || ''} {task.agentName}
                </div>
              {/if}
              <div class="flex items-center justify-between ml-7 text-xs text-slate-500">
                {#if task.updatedAt}
                  <span>{new Date(task.updatedAt).toLocaleDateString()}</span>
                {/if}
                <div class="flex gap-2">
                  <button 
                    on:click={() => confirmDeleteTask(task)}
                    class="text-red-400 hover:text-red-300 transition-colors"
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
  {/if}
</div>
