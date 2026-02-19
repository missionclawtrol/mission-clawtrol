// Mission Clawtrol - Work Orders Kanban Board

<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fetchTasks, createTask, updateTask, deleteTask, spawnAgent, fetchProjects, fetchAgents, fetchSettings, fetchUsers, type Task, type Project, type Agent, type Settings, type UserInfo } from '$lib/api';
  import { onTaskUpdate } from '$lib/taskWebSocket';
  
  // Data
  let tasks: Task[] = [];
  let projects: Project[] = [];
  let agents: Agent[] = [];
  let users: UserInfo[] = [];
  let settings: Settings = { humanHourlyRate: 100 };
  let kanbanColumnWidth = 384; // default w-96
  let loading = true;

  // Project → repoUrl lookup (populated after projects load)
  let projectRepoUrls: Record<string, string> = {};
  
  // UI state
  let showNewTaskModal = false;
  let showTaskDetail = false;
  let selectedTask: Task | null = null;
  let draggedTask: Task | null = null;
  let dragOverColumn: string | null = null;
  
  // Filter state - sync with URL query params
  let searchQuery = '';
  let selectedAssignee = '';
  let selectedProjectId = ''; // Empty = all projects
  
  // Sync filters from URL on mount and when URL changes
  $: {
    searchQuery = $page.url.searchParams.get('q') || '';
    selectedAssignee = $page.url.searchParams.get('assignee') || '';
    selectedProjectId = $page.url.searchParams.get('project') || '';
  }
  
  // Get unique assignees from tasks
  $: uniqueAssignees = [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))];
  
  // Get unique projects from tasks (fallback to projects list)
  $: uniqueProjects = [...new Set([...tasks.map(t => t.projectId), ...projects.map(p => p.id)]).values()];
  
  // Update URL when filters change (debounced)
  function updateUrlParams() {
    // Only update URL if we're still on the tasks page
    if (!$page.url.pathname.startsWith('/tasks')) return;
    
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedAssignee) params.set('assignee', selectedAssignee);
    if (selectedProjectId) params.set('project', selectedProjectId);
    
    const queryString = params.toString();
    const newUrl = queryString ? `/tasks?${queryString}` : '/tasks';
    goto(newUrl, { replaceState: true, noScroll: true, keepFocus: true });
  }
  
  // Watch filter changes and update URL (with debounce)
  let filterTimeout: ReturnType<typeof setTimeout>;
  $: {
    // Clear existing timeout on changes
    clearTimeout(filterTimeout);
    // Only update URL if we're past initial mount (loading is false)
    if (!loading && (searchQuery !== $page.url.searchParams.get('q') || selectedAssignee !== $page.url.searchParams.get('assignee') || selectedProjectId !== $page.url.searchParams.get('project'))) {
      filterTimeout = setTimeout(updateUrlParams, 300);
    }
  }
  
  // Clear all filters
  function clearAllFilters() {
    searchQuery = '';
    selectedAssignee = '';
    selectedProjectId = '';
    updateUrlParams();
  }
  
  // Check if any filters are active
  $: hasActiveFilters = searchQuery || selectedAssignee || selectedProjectId;
  
  // Persist project filter to localStorage (legacy - now mainly using URL)
  const PROJECT_FILTER_KEY = 'mission-clawtrol-project-filter';
  
  function saveProjectFilter(projectId: string) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROJECT_FILTER_KEY, projectId);
    }
  }
  
  function loadProjectFilter(): string {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(PROJECT_FILTER_KEY) || '';
    }
    return '';
  }
  
  // Watch for project filter changes and save (legacy)
  $: if (typeof localStorage !== 'undefined' && selectedProjectId !== undefined) {
    saveProjectFilter(selectedProjectId);
  }
  
  // Reload tasks when project filter changes (debounced) - disabled since we're doing client-side filtering now
  // The data is already loaded; we just filter client-side
  
  // Check if task matches search query
  function matchesSearch(task: Task): boolean {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      task.title.toLowerCase().includes(query) ||
      (task.description && task.description.toLowerCase().includes(query))
    );
  }
  
  // Check if task matches assignee filter
  function matchesAssignee(task: Task): boolean {
    if (!selectedAssignee) return true;
    return task.assignedTo === selectedAssignee;
  }
  
  // Check if task matches project filter
  function matchesProject(task: Task): boolean {
    if (!selectedProjectId) return true;
    return task.projectId === selectedProjectId;
  }
  
  // Form state
  let formError = '';
  let formLoading = false;
  let newTask = {
    title: '',
    description: '',
    projectId: '',
    agentId: '',
    assignedTo: '',
    priority: 'P2' as const,
    dueDate: '',
  };
  
  // Comments state
  interface TaskComment {
    id: string;
    taskId: string;
    userId: string | null;
    userName: string | null;
    userAvatar: string | null;
    content: string;
    createdAt: string;
    updatedAt: string | null;
  }
  let comments: TaskComment[] = [];
  let newComment = '';
  let loadingComments = false;
  let submittingComment = false;

  async function loadComments(taskId: string) {
    loadingComments = true;
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/tasks/${taskId}/comments`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        comments = data.comments || [];
      }
    } catch (e) {
      console.error('Failed to load comments:', e);
    } finally {
      loadingComments = false;
    }
  }

  async function submitComment() {
    if (!selectedTask || !newComment.trim()) return;
    submittingComment = true;
    try {
      const res = await fetch(`http://${window.location.hostname}:3001/api/tasks/${selectedTask.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: newComment.trim() }),
      });
      if (res.ok) {
        newComment = '';
        await loadComments(selectedTask.id);
      }
    } catch (e) {
      console.error('Failed to submit comment:', e);
    } finally {
      submittingComment = false;
    }
  }

  async function removeComment(commentId: string) {
    if (!selectedTask) return;
    try {
      await fetch(`http://${window.location.hostname}:3001/api/tasks/${selectedTask.id}/comments/${commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await loadComments(selectedTask.id);
    } catch (e) {
      console.error('Failed to delete comment:', e);
    }
  }

  function formatCommentTime(ts: string): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString();
  }

  // Kanban columns configuration
  const columns = [
    { id: 'backlog', name: 'Backlog', color: 'bg-gray-500' },
    { id: 'todo', name: 'Todo', color: 'bg-blue-500' },
    { id: 'in-progress', name: 'In Progress', color: 'bg-yellow-500' },
    { id: 'review', name: 'Review', color: 'bg-purple-500' },
    { id: 'done', name: 'Done', color: 'bg-green-500' },
  ];
  
  async function loadData() {
    loading = true;
    try {
      const [tasksData, projectsData, agentsData, usersData, settingsData] = await Promise.all([
        fetchTasks(),
        fetchProjects(),
        fetchAgents(),
        fetchUsers(),
        fetchSettings(),
      ]);
      tasks = tasksData;
      projects = projectsData;
      agents = agentsData;
      users = usersData;
      settings = settingsData;
      if (settingsData.kanbanColumnWidth) kanbanColumnWidth = settingsData.kanbanColumnWidth;

      // Build project → repoUrl lookup
      projectRepoUrls = {};
      projects.forEach(p => {
        if (p.repoUrl) projectRepoUrls[p.id] = p.repoUrl;
      });
    } catch (err) {
      console.error('Failed to load tasks view data:', err);
    } finally {
      loading = false;
    }
  }
  
  function getTasksForColumn(columnId: string): Task[] {
    let filtered = tasks.filter(t => {
      // Filter by status
      if (t.status !== columnId) return false;
      // Filter by project if one is selected
      if (!matchesProject(t)) return false;
      // Filter by assignee if one is selected
      if (!matchesAssignee(t)) return false;
      // Filter by search query
      if (!matchesSearch(t)) return false;
      return true;
    });
    
    // Sort by priority first (P0, P1, P2, P3), then by other criteria
    if (columnId === 'done') {
      // Sort Done column by completedAt descending (newest first) — no priority sort
      filtered.sort((a, b) => {
        const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return dateB - dateA;
      });
    } else {
      // Sort other columns by priority first, then by createdAt (stable sort)
      filtered.sort((a, b) => {
        // Priority sort (P0 < P1 < P2 < P3 alphabetically)
        if (a.priority !== b.priority) {
          return a.priority.localeCompare(b.priority);
        }
        // Then by createdAt ascending (older tasks first for same priority)
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });
    }
    
    return filtered;
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

  function getTaskAge(task: Task): { label: string; level: 'warn' | 'alert' } | null {
    if (task.status === 'done') return null;
    const ageMs = Date.now() - new Date(task.updatedAt).getTime();
    const hours = ageMs / (1000 * 60 * 60);
    const days = hours / 24;
    const fmt = (h: number) => h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;

    if (task.status === 'review') {
      if (hours >= 24) return { label: fmt(hours), level: 'alert' };
      if (hours >= 4) return { label: fmt(hours), level: 'warn' };
    } else if (task.status === 'in-progress') {
      if (days >= 2) return { label: fmt(hours), level: 'alert' };
      if (days >= 1) return { label: fmt(hours), level: 'warn' };
    } else if (task.status === 'todo' || task.status === 'backlog') {
      if (days >= 7) return { label: fmt(hours), level: 'alert' };
      if (days >= 3) return { label: fmt(hours), level: 'warn' };
    }
    return null;
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

  function getModelDisplayName(model: string | null | undefined): string | null {
    if (!model) return null;
    
    // Map raw model strings to friendly display names
    const modelMap: Record<string, string> = {
      'claude-sonnet-4-5': 'Sonnet 4.5',
      'claude-opus-4-6': 'Opus 4.6',
      'claude-opus-4': 'Opus 4',
      'claude-sonnet-4': 'Sonnet 4',
      'claude-sonnet-3-5': 'Sonnet 3.5',
      'claude-3-5-sonnet-20241022': 'Sonnet 3.5',
      'claude-3-5-sonnet-20240620': 'Sonnet 3.5',
      'claude-3-opus-20240229': 'Opus 3',
      'MiniMax-M2.5': 'MiniMax M2.5',
      'minimax/MiniMax-M2.5': 'MiniMax M2.5',
      'gpt-4': 'GPT-4',
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4o': 'GPT-4o',
      'gpt-3.5-turbo': 'GPT-3.5',
      'o1': 'o1',
      'o1-mini': 'o1-mini',
      'o1-preview': 'o1-preview',
    };
    
    // Try exact match first
    if (modelMap[model]) {
      return modelMap[model];
    }
    
    // Try partial matches for anthropic models
    if (model.includes('claude-sonnet-4-5') || model.includes('anthropic/claude-sonnet-4-5')) {
      return 'Sonnet 4.5';
    }
    if (model.includes('claude-opus-4-6') || model.includes('anthropic/claude-opus-4-6')) {
      return 'Opus 4.6';
    }
    if (model.includes('claude-opus-4') || model.includes('anthropic/claude-opus-4')) {
      return 'Opus 4';
    }
    if (model.includes('claude-sonnet-4') || model.includes('anthropic/claude-sonnet-4')) {
      return 'Sonnet 4';
    }
    if (model.includes('sonnet-3-5') || model.includes('sonnet-3.5')) {
      return 'Sonnet 3.5';
    }
    if (model.includes('opus-3')) {
      return 'Opus 3';
    }
    if (model.includes('MiniMax')) {
      return 'MiniMax M2.5';
    }
    
    // Return cleaned-up raw string if no mapping exists
    // Remove common prefixes
    return model
      .replace('anthropic/', '')
      .replace('openai/', '')
      .replace('minimax/', '')
      .replace('claude-', '')
      .replace('gpt-', 'GPT-');
  }

  function formatCompletedAt(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    }
  }
  
  function formatDueDate(dateStr: string | undefined | null): { text: string; color: string; icon: string } | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    // Format date as "Due Mon Feb 17"
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const text = `Due ${dayName} ${monthDay}`;
    
    // Color coding
    if (diffHours < 0) {
      // Overdue
      return { text, color: 'text-red-400', icon: '⚠️' };
    } else if (diffHours < 24) {
      // Due within 24h
      return { text, color: 'text-orange-400', icon: '' };
    } else {
      // Future
      return { text, color: 'text-slate-500 dark:text-slate-400', icon: '' };
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
  
  function getUserName(userId?: string | null): string | null {
    if (!userId) return null;
    const user = users.find(u => u.id === userId);
    return user?.name || user?.githubLogin || userId;
  }
  
  function getUserInitials(userId?: string | null): string {
    if (!userId) return '?';
    const user = users.find(u => u.id === userId);
    if (!user) return '?';
    
    const name = user.name || user.username || user.githubLogin || '';
    if (!name) return '?';
    
    // Get first letter of first and last name
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    // Single name - use first two letters
    return name.substring(0, 2).toUpperCase();
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
      assignedTo: newTask.assignedTo || undefined,
      priority: newTask.priority,
      status: 'backlog',
      dueDate: newTask.dueDate ? new Date(newTask.dueDate).toISOString() : undefined,
    });
    
    formLoading = false;
    
    if (result.success) {
      showNewTaskModal = false;
      newTask = { title: '', description: '', projectId: '', agentId: '', assignedTo: '', priority: 'P2', dueDate: '' };
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
  
  async function handleStartWork(task: Task) {
    const taskDescription = task.description || `Work on: ${task.title}`;
    
    const result = await spawnAgent({
      task: taskDescription,
      label: task.agentId || 'senior-dev',
      projectId: task.projectId || 'mission-clawtrol',
      taskId: task.id, // Link to existing task
    });
    
    if (result.success) {
      await loadData();
      showTaskDetail = false;
      selectedTask = null;
    } else {
      alert('Failed to start work: ' + (result.error || 'Unknown error'));
    }
  }
  
  async function handleAssignAgent(taskId: string, agentId: string | null) {
    const result = await updateTask(taskId, { agentId });
    if (result) {
      await loadData();
      // Update selectedTask if it's the one we just changed
      if (selectedTask && selectedTask.id === taskId) {
        selectedTask = { ...selectedTask, agentId };
      }
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
  
  function handleDragLeave(e: DragEvent) {
    // Only clear if we're leaving the column entirely (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const currentTarget = e.currentTarget as HTMLElement | null;
    if (currentTarget && relatedTarget && !currentTarget.contains(relatedTarget)) {
      dragOverColumn = null;
    }
  }
  
  async function handleDrop(columnId: string, e: DragEvent) {
    e.preventDefault();
    dragOverColumn = null;
    
    if (!draggedTask) return;
    
    // No-op if dropping on the same column
    if (draggedTask.status === columnId) {
      draggedTask = null;
      return;
    }
    
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
    selectedTask = null;
    formError = '';
  }
  
  onMount(() => {
    // Filters are now loaded from URL query params via reactive statement
    // Initial load
    loadData();
    
    // Register WebSocket callback for real-time updates
    onTaskUpdate(() => {
      console.log('[Tasks] WebSocket task update received, refreshing...');
      loadData();
    });
  });
</script>

<!-- Modal Backdrop -->
{#if showNewTaskModal || showTaskDetail}
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-md" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="new-task-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
        <h2 id="new-task-title" class="font-semibold">New Task</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4">
        {#if formError}
          <div class="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>
        {/if}
        
        <div>
          <label for="task-title" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Title *</label>
          <input 
            id="task-title"
            type="text" 
            bind:value={newTask.title}
            placeholder="Task title"
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          />
        </div>
        
        <div>
          <label for="task-description" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Description</label>
          <textarea 
            id="task-description"
            bind:value={newTask.description}
            placeholder="Task description..."
            rows="3"
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none resize-none"
          ></textarea>
        </div>
        
        <div>
          <label for="task-project" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Project *</label>
          <select 
            id="task-project"
            bind:value={newTask.projectId}
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select a project</option>
            {#each projects as project}
              <option value={project.id}>{project.name}</option>
            {/each}
          </select>
        </div>
        
        <div>
          <label for="task-agent" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Agent</label>
          <select 
            id="task-agent"
            bind:value={newTask.agentId}
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="">No agent</option>
            {#each agents as agent}
              <option value={agent.id}>{agent.emoji} {agent.name}</option>
            {/each}
          </select>
        </div>
        
        <div>
          <label for="task-assignee" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Assign To (User)</label>
          <select 
            id="task-assignee"
            bind:value={newTask.assignedTo}
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="">Unassigned</option>
            {#each users as user}
              <option value={user.id}>{user.name || user.githubLogin}</option>
            {/each}
          </select>
        </div>
        
        <div>
          <label for="task-priority" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Priority</label>
          <select 
            id="task-priority"
            bind:value={newTask.priority}
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          >
            <option value="P0">P0 - Critical</option>
            <option value="P1">P1 - High</option>
            <option value="P2">P2 - Medium</option>
            <option value="P3">P3 - Low</option>
          </select>
        </div>
        
        <div>
          <label for="task-due-date" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Due Date (Optional)</label>
          <input 
            id="task-due-date"
            type="date"
            bind:value={newTask.dueDate}
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
          />
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-lg max-h-[85vh] flex flex-col" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="task-detail-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
        <h2 id="task-detail-title" class="font-semibold">Task Details</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4 overflow-y-auto">
        <div>
          <h3 class="font-semibold text-lg">{selectedTask.title}</h3>
        </div>
        
        {#if selectedTask.description}
          <div>
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Description</h4>
            <p class="text-slate-600 dark:text-slate-300">{selectedTask.description}</p>
          </div>
        {/if}
        
        <div class="grid grid-cols-2 gap-4">
          <div>
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Project</h4>
            <p class="text-slate-600 dark:text-slate-300">{selectedTask.projectName || getProjectName(selectedTask.projectId)}</p>
          </div>
          
          <div>
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Priority</h4>
            <div class="flex items-center gap-2">
              <span class={`px-2 py-1 rounded text-xs text-white font-semibold ${getPriorityColor(selectedTask.priority)}`}>
                {selectedTask.priority}
              </span>
            </div>
          </div>
        </div>
        
        <div>
          <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Agent</h4>
          <select 
            class="w-full bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-white"
            value={selectedTask.agentId || ''}
            on:change={(e) => handleAssignAgent(selectedTask.id, e.currentTarget.value || null)}
          >
            <option value="">No agent</option>
            {#each agents as agent}
              <option value={agent.id}>{agent.emoji} {agent.name}</option>
            {/each}
          </select>
        </div>
        
        <div>
          <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Assigned To (User)</h4>
          <select 
            class="w-full bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-white"
            value={selectedTask.assignedTo || ''}
            on:change={async (e) => {
              const val = e.currentTarget.value || null;
              await updateTask(selectedTask.id, { assignedTo: val });
              await loadData();
              if (selectedTask) selectedTask = { ...selectedTask, assignedTo: val };
            }}
          >
            <option value="">Unassigned</option>
            {#each users as user}
              <option value={user.id}>{user.name || user.githubLogin}</option>
            {/each}
          </select>
        </div>

        <div>
          <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Due Date</h4>
          <div class="flex gap-2">
            <input 
              type="date"
              value={selectedTask.dueDate ? new Date(selectedTask.dueDate).toISOString().split('T')[0] : ''}
              on:change={async (e) => {
                const val = e.currentTarget.value;
                const isoDate = val ? new Date(val).toISOString() : null;
                await updateTask(selectedTask.id, { dueDate: isoDate });
                await loadData();
                if (selectedTask) selectedTask = { ...selectedTask, dueDate: isoDate };
              }}
              class="flex-1 bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-white"
            />
            {#if selectedTask.dueDate}
              <button
                on:click={async () => {
                  await updateTask(selectedTask.id, { dueDate: null });
                  await loadData();
                  if (selectedTask) selectedTask = { ...selectedTask, dueDate: null };
                }}
                class="px-3 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-sm transition-colors"
                title="Clear due date"
              >
                Clear
              </button>
            {/if}
          </div>
        </div>

        {#if selectedTask.createdBy}
          <div>
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Created By</h4>
            <p class="text-slate-600 dark:text-slate-300">👤 {getUserName(selectedTask.createdBy)}</p>
          </div>
        {/if}
        
        <div>
          <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Status</h4>
          <div class="text-slate-600 dark:text-slate-300 capitalize">{selectedTask.status.replace('_', ' ')}</div>
        </div>

        {#if selectedTask.completedAt}
          <div>
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Completed</h4>
            <div class="text-slate-600 dark:text-slate-300">✅ {formatCompletedAt(selectedTask.completedAt)}</div>
          </div>
        {/if}

        {#if selectedTask.status === 'done' && selectedTask.linesChanged}
          <div class="pt-2 border-t border-gray-200 dark:border-slate-700">
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-2">📊 Code Changes</h4>
            <div class="space-y-1 text-sm">
              <p class="text-slate-600 dark:text-slate-300">
                Lines Added: <span class="font-semibold text-green-400">+{selectedTask.linesChanged.added}</span>
              </p>
              <p class="text-slate-600 dark:text-slate-300">
                Lines Removed: <span class="font-semibold text-red-400">-{selectedTask.linesChanged.removed}</span>
              </p>
              <p class="text-slate-600 dark:text-slate-300">
                Total: <span class="font-semibold">{selectedTask.linesChanged.total}</span>
              </p>
            </div>
          </div>
        {/if}

        {#if selectedTask.status === 'done'}
          <div class="pt-2 border-t border-gray-200 dark:border-slate-700">
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-2">⏱️ Time Estimates</h4>
            <div class="space-y-1 text-sm">
              <p class="text-slate-600 dark:text-slate-300">
                AI Time: <span class="font-semibold">{formatRuntime(selectedTask.runtime || 0)}</span>
              </p>
              {#if selectedTask.estimatedHumanMinutes}
                <p class="text-slate-600 dark:text-slate-300">
                  Human Time: <span class="font-semibold">{formatMinutes(selectedTask.estimatedHumanMinutes)}</span>
                </p>
              {/if}
              {#if selectedTask.cost}
                <p class="text-slate-600 dark:text-slate-300">
                  AI Cost: <span class="font-semibold">${selectedTask.cost.toFixed(2)}</span>
                </p>
              {/if}
              {#if selectedTask.humanCost}
                <p class="text-slate-600 dark:text-slate-300">
                  Human Cost: <span class="font-semibold">${selectedTask.humanCost.toFixed(2)}</span>
                </p>
              {/if}
              {#if getModelDisplayName(selectedTask.model)}
                <p class="text-slate-600 dark:text-slate-300">
                  Model: <span class="font-semibold">🤖 {getModelDisplayName(selectedTask.model)}</span>
                </p>
              {/if}
            </div>
          </div>
        {/if}

        {#if selectedTask.status === 'done' && selectedTask.estimatedHumanMinutes && selectedTask.runtime}
          {@const timeSaved = Math.round(Math.max(0, selectedTask.estimatedHumanMinutes - (selectedTask.runtime / 60000)))}
          {@const moneySaved = Math.max(0, (selectedTask.humanCost || 0) - (selectedTask.cost || 0))}
          <div class="pt-2 border-t border-gray-200 dark:border-slate-700">
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-2">💰 ROI</h4>
            <div class="space-y-1 text-sm">
              <p class="text-green-400 font-semibold">
                ⏱️ Time Saved: {formatMinutes(timeSaved)}
              </p>
              <p class="text-green-400 font-semibold">
                💰 Money Saved: ${moneySaved.toFixed(2)}
              </p>
            </div>
          </div>
        {/if}
        <!-- Commit Hash -->
        {#if selectedTask.commitHash && selectedTask.commitHash !== 'NO_COMMIT'}
          {@const repoUrl = projectRepoUrls[selectedTask.projectId]}
          <div class="pt-2 border-t border-gray-200 dark:border-slate-700">
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-2">🔗 Commit</h4>
            <div class="flex items-center gap-2 text-sm">
              {#if repoUrl}
                <a href="{repoUrl}/commit/{selectedTask.commitHash}" target="_blank" rel="noopener"
                   class="font-mono text-blue-400 hover:underline text-xs">
                  {selectedTask.commitHash.slice(0, 8)}
                </a>
                <a href="{repoUrl}/commit/{selectedTask.commitHash}" target="_blank" rel="noopener"
                   class="text-xs text-slate-500 hover:text-blue-400 transition-colors">↗ View diff</a>
              {:else}
                <span class="font-mono text-slate-400 text-xs">{selectedTask.commitHash.slice(0, 8)}</span>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Comments Section -->
        <div class="pt-2 border-t border-gray-200 dark:border-slate-700">
          <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-2">💬 Comments ({comments.length})</h4>
          
          {#if loadingComments}
            <p class="text-xs text-slate-500">Loading comments...</p>
          {:else}
            {#if comments.length > 0}
              <div class="space-y-2 max-h-48 overflow-y-auto mb-3">
                {#each comments as comment (comment.id)}
                  <div class="bg-gray-100 dark:bg-gray-100/50 dark:bg-slate-700/50 rounded p-2 group">
                    <div class="flex items-center justify-between mb-1">
                      <div class="flex items-center gap-1.5">
                        {#if comment.userAvatar}
                          <img src={comment.userAvatar} alt="" class="w-4 h-4 rounded-full" />
                        {/if}
                        <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{comment.userName || 'Unknown'}</span>
                        <span class="text-xs text-slate-500">{formatCommentTime(comment.createdAt)}</span>
                        {#if comment.updatedAt}
                          <span class="text-xs text-slate-500 italic">(edited)</span>
                        {/if}
                      </div>
                      <button
                        on:click={() => removeComment(comment.id)}
                        class="text-xs text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete comment"
                      >✕</button>
                    </div>
                    <p class="text-sm text-slate-200 whitespace-pre-wrap">{comment.content}</p>
                  </div>
                {/each}
              </div>
            {/if}
            
            <!-- New comment input -->
            <div class="flex gap-2">
              <input
                type="text"
                bind:value={newComment}
                on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
                placeholder="Add a comment..."
                class="flex-1 bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                disabled={submittingComment}
              />
              <button
                on:click={submitComment}
                disabled={submittingComment || !newComment.trim()}
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm text-white transition-colors"
              >
                {submittingComment ? '...' : 'Send'}
              </button>
            </div>
          {/if}
        </div>
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-between gap-2">
        {#if (selectedTask.status === 'todo' || selectedTask.status === 'in-progress') && !selectedTask.sessionKey}
          <button 
            on:click={() => handleStartWork(selectedTask!)}
            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
          >
            🚀 Start Work
          </button>
        {:else}
          <div></div>
        {/if}
        <div class="flex gap-2">
          <button 
            on:click={() => handleDeleteTask(selectedTask!.id)}
            class="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-sm font-medium transition-colors"
          >
            🗑️ Delete
          </button>
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

<!-- Main Content -->
<div class="space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between gap-4 flex-wrap">
    <h1 class="text-2xl font-semibold">📋 Work Orders</h1>
    
    <!-- Filter Bar -->
    <div class="flex items-center gap-2 flex-1 max-w-3xl flex-wrap">
      <!-- Search Input -->
      <div class="relative flex-1 min-w-[180px] max-w-xs">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search tasks..."
          class="w-full px-3 py-2 pl-8 bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500 placeholder-slate-400"
        />
        <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm">🔍</span>
      </div>
      
      <!-- Assignee Filter -->
      <select 
        bind:value={selectedAssignee}
        class="px-3 py-2 bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500 min-w-[140px]"
      >
        <option value="">All Assignees</option>
        {#each uniqueAssignees as assignee}
          <option value={assignee}>{getUserName(assignee) || assignee}</option>
        {/each}
      </select>
      
      <!-- Project Filter -->
      <select 
        bind:value={selectedProjectId}
        class="px-3 py-2 bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500 min-w-[140px]"
      >
        <option value="">All Projects</option>
        {#each projects as project}
          <option value={project.id}>{project.name}</option>
        {/each}
      </select>
      
      <!-- Clear Filters Button -->
      {#if hasActiveFilters}
        <button 
          on:click={clearAllFilters}
          class="px-3 py-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-600 rounded transition-colors"
          title="Clear all filters"
        >
          ✕ Clear
        </button>
      {/if}
    </div>
    
    <button 
      on:click={() => showNewTaskModal = true}
      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors whitespace-nowrap"
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
    <div class="flex gap-4 overflow-x-auto pb-4">
      {#each columns as column}
        <div 
          class="bg-gray-100 dark:bg-gray-100/50 dark:bg-slate-700/30 rounded-lg flex flex-col flex-shrink-0 max-h-[calc(100vh-200px)] transition-all {dragOverColumn === column.id ? 'border-2 border-blue-500 shadow-lg shadow-blue-500/30' : 'border border-gray-300 dark:border-slate-600'}"
          style="width: {kanbanColumnWidth}px"
          on:dragover={(e) => handleDragOver(column.id, e)}
          on:dragleave={(e) => handleDragLeave(e)}
          on:drop={(e) => handleDrop(column.id, e)}
        >
          <!-- Column Header -->
          <div class="px-4 py-3 border-b border-gray-300 dark:border-slate-600 flex items-center gap-2 bg-white dark:bg-slate-800/50">
            <div class="w-3 h-3 rounded-full {column.color}"></div>
            <h2 class="font-semibold text-sm">{column.name}</h2>
            <span class="ml-auto text-xs text-slate-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded">
              {getTasksForColumn(column.id).length}
            </span>
          </div>
          
          <!-- Cards Container -->
          <div class="flex-1 p-3 space-y-2 overflow-y-auto {dragOverColumn === column.id ? 'bg-blue-500/10' : ''}">
            <!-- Drop placeholder -->
            {#if dragOverColumn === column.id && draggedTask && draggedTask.status !== column.id}
              <div class="p-3 border-2 border-dashed border-blue-400 rounded-lg bg-blue-500/5 flex items-center justify-center text-sm text-blue-400">
                Drop here to move task
              </div>
            {/if}
            
            {#each getTasksForColumn(column.id) as task (task.id)}
              <div 
                draggable="true"
                on:dragstart={() => handleDragStart(task)}
                on:click={() => { selectedTask = task; showTaskDetail = true; comments = []; newComment = ''; loadComments(task.id); }}
                class="p-3 bg-white dark:bg-slate-800 rounded-lg border border-gray-300 dark:border-slate-600 hover:border-slate-500 cursor-move hover:bg-gray-100 dark:bg-slate-700/80 transition-all {draggedTask && draggedTask.id === task.id ? 'opacity-50 scale-95' : ''}"
              >
                <!-- Title + Age Badge -->
                <div class="flex items-start gap-2 mb-1">
                  <h3 class="font-semibold text-sm flex-1">{task.title}</h3>
                  {#if task.status !== 'done'}
                    {@const age = getTaskAge(task)}
                    {#if age}
                      <span class="text-xs font-mono px-1.5 py-0.5 rounded-full border flex-shrink-0 {age.level === 'alert' ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}">
                        {age.label}
                      </span>
                    {/if}
                  {/if}
                </div>
                
                <!-- Project Name -->
                <p class="text-xs text-slate-500 dark:text-slate-400 mb-2">{task.projectName || getProjectName(task.projectId)}</p>
                
                <!-- Lines Changed Info (for completed tasks) -->
                {#if task.status === 'done' && task.linesChanged}
                  <div class="mb-2 pb-2 border-b border-gray-200 dark:border-slate-700">
                    <div class="text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <span class="text-green-400">+{task.linesChanged.added}</span>
                      <span class="text-red-400"> / -{task.linesChanged.removed}</span> lines
                    </div>
                  </div>
                {/if}

                <!-- Completed At (for done tasks) -->
                {#if task.status === 'done' && task.completedAt}
                  <div class="mb-2 pb-2 border-b border-gray-200 dark:border-slate-700">
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                      ✅ Completed {formatCompletedAt(task.completedAt)}
                    </div>
                  </div>
                {/if}

                <!-- AI Stats (for completed tasks) -->
                {#if task.status === 'done' && (task.tokens || task.cost || task.runtime)}
                  <div class="mb-2 pb-2 border-b border-gray-200 dark:border-slate-700 flex flex-col gap-1 text-xs text-slate-500">
                    <div class="flex gap-2 flex-wrap">
                      {#if task.runtime}
                        <span>⏱️ AI: {formatRuntime(task.runtime)}</span>
                      {/if}
                      {#if task.estimatedHumanMinutes}
                        <span class="text-slate-600 dark:text-slate-300">👤 {formatMinutes(task.estimatedHumanMinutes)}</span>
                      {/if}
                    </div>
                    {#if task.cost}
                      <span>💰 AI: ${task.cost.toFixed(2)}</span>
                    {/if}
                    {#if getModelDisplayName(task.model)}
                      <span class="text-slate-500 dark:text-slate-400">🤖 {getModelDisplayName(task.model)}</span>
                    {/if}
                  </div>
                {/if}

                <!-- Commit Hash Badge (for done tasks) -->
                {#if task.status === 'done' && task.commitHash && task.commitHash !== 'NO_COMMIT'}
                  {@const shortHash = task.commitHash.slice(0, 8)}
                  {@const repoUrl = projectRepoUrls[task.projectId]}
                  <div class="mb-2 pb-2 border-b border-gray-200 dark:border-slate-700">
                    <div class="mt-1">
                      {#if repoUrl}
                        <a href="{repoUrl}/commit/{task.commitHash}" target="_blank" rel="noopener"
                           class="text-xs font-mono text-blue-400 hover:text-blue-300 hover:underline"
                           on:click|stopPropagation>
                          🔗 {shortHash}
                        </a>
                      {:else}
                        <span class="text-xs font-mono text-slate-500">{shortHash}</span>
                      {/if}
                    </div>
                  </div>
                {/if}

                <!-- Savings Info (if human estimate exists) -->
                {#if task.status === 'done' && task.estimatedHumanMinutes && task.humanCost}
                  {@const timeSaved = Math.round(Math.max(0, task.estimatedHumanMinutes - (task.runtime || 0) / 60000))}
                  {@const moneySaved = Math.max(0, task.humanCost - (task.cost || 0))}
                  {#if timeSaved > 0 || moneySaved > 0}
                    <div class="mb-2 pb-2 border-b border-gray-200 dark:border-slate-700 flex flex-col gap-1 text-xs">
                      <span class="text-green-400 font-semibold">✨ Saved {formatMinutes(timeSaved)}</span>
                      <span class="text-green-400 font-semibold">💚 ${moneySaved.toFixed(0)}</span>
                    </div>
                  {/if}
                {/if}
                
                <!-- Due Date -->
                {#if task.dueDate}
                  {@const dueDateInfo = formatDueDate(task.dueDate)}
                  {#if dueDateInfo}
                    <div class="mb-2 pb-2 border-b border-gray-200 dark:border-slate-700">
                      <div class="text-xs {dueDateInfo.color} flex items-center gap-1">
                        {#if dueDateInfo.icon}
                          <span>{dueDateInfo.icon}</span>
                        {/if}
                        <span>{dueDateInfo.text}</span>
                      </div>
                    </div>
                  {/if}
                {/if}
                
                <!-- Assignee + Agent + Priority -->
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 min-w-0">
                    {#if task.assignedTo}
                      <div class="flex items-center gap-1.5">
                        <div 
                          class="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0"
                          title={getUserName(task.assignedTo) || 'Assigned user'}
                        >
                          {getUserInitials(task.assignedTo)}
                        </div>
                        <span class="text-xs text-slate-600 dark:text-slate-300 truncate">{getUserName(task.assignedTo)}</span>
                      </div>
                    {:else if task.agentId}
                      <span class="text-sm">{getAgentInfo(task.agentId).emoji}</span>
                      <span class="text-xs text-slate-500 dark:text-slate-400 truncate">{getAgentInfo(task.agentId).name}</span>
                    {:else}
                      <span class="text-xs text-slate-500">Unassigned</span>
                    {/if}
                  </div>
                  <span class={`px-1.5 py-0.5 rounded-full text-xs font-semibold text-white flex-shrink-0 ${getPriorityColor(task.priority)}`}>
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
