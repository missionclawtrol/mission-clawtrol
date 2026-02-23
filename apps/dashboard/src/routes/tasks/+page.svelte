// Mission Clawtrol - Tasks Kanban Board

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fetchTasks, createTask, updateTask, deleteTask, spawnAgent, spawnTaskSession, fetchProjects, fetchAgents, fetchSettings, fetchUsers, fetchMilestones, fetchTaskDeliverables, reviewDeliverable, deleteDeliverable, type Task, type Project, type Agent, type Settings, type UserInfo, type Milestone, type Deliverable } from '$lib/api';
  import { getApiBase } from '$lib/config';
  import { onTaskUpdate } from '$lib/taskWebSocket';
  import { sendWSMessage, addWSMessageCallback } from '$lib/websocket';
  
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

  // Conflict warnings: taskId → list of conflicting in-progress tasks on same project
  let conflictWarnings: Record<string, Array<{ id: string; title: string; agentId: string }>> = {};
  
  // UI state
  let showNewTaskModal = false;
  let showTaskDetail = false;
  let selectedTask: Task | null = null;
  let draggedTask: Task | null = null;
  let dragOverColumn: string | null = null;

  // Activity stream state
  interface ActivityEntry {
    id: string;
    type: 'lifecycle-start' | 'text' | 'complete';
    timestamp: string;
    text?: string;
    expanded: boolean;
  }
  let activityEntries: ActivityEntry[] = [];
  let activityCurrentText = '';
  let activityTab: 'details' | 'activity' = 'details';
  let activityScrollEl: HTMLElement | null = null;
  let activityUserScrolled = false;
  let activityFinished = false;
  let activityCount = 0;
  // Batch text deltas via requestAnimationFrame
  let activityPendingDelta = '';
  let activityRafPending = false;
  // Cleanup fn for WS callback
  let removeActivityCallback: (() => void) | null = null;
  
  // Milestone state
  let milestones: Milestone[] = [];
  let selectedMilestoneId = ''; // Empty = all milestones

  // Filter state - initialized from URL on mount, then managed as local state
  // NOTE: These are plain let variables (not reactive $: declarations) so that
  // bind:value on filter dropdowns works correctly in Svelte 5. The reactive
  // $: URL sync block was removed because in Svelte 5 it overrides bind:value,
  // preventing the filter dropdowns from updating the displayed work orders.
  let searchQuery = '';
  let selectedAssignee = '';
  let selectedProjectId = ''; // Empty = all projects
  let filterType = ''; // Empty = all types

  // When project filter changes, load milestones for that project
  $: if (selectedProjectId && !loading) {
    fetchMilestones(selectedProjectId).then(ms => { milestones = ms; });
  } else if (!selectedProjectId) {
    milestones = [];
    if (!$page.url.searchParams.get('milestone')) selectedMilestoneId = '';
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
    if (selectedMilestoneId) params.set('milestone', selectedMilestoneId);
    if (filterType) params.set('type', filterType);
    
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
    if (!loading && (
      searchQuery !== $page.url.searchParams.get('q') ||
      selectedAssignee !== $page.url.searchParams.get('assignee') ||
      selectedProjectId !== $page.url.searchParams.get('project') ||
      selectedMilestoneId !== ($page.url.searchParams.get('milestone') || '') ||
      filterType !== ($page.url.searchParams.get('type') || '')
    )) {
      filterTimeout = setTimeout(updateUrlParams, 300);
    }
  }
  
  // Clear all filters
  function clearAllFilters() {
    searchQuery = '';
    selectedAssignee = '';
    selectedProjectId = '';
    selectedMilestoneId = '';
    filterType = '';
    updateUrlParams();
  }
  
  // Check if any filters are active
  $: hasActiveFilters = searchQuery || selectedAssignee || selectedProjectId || selectedMilestoneId || filterType;
  
  // Force kanban re-render when any filter changes
  // (getTasksForColumn is a function call in the template — Svelte can't track its reactive deps)
  $: filterKey = `${selectedProjectId}|${selectedAssignee}|${searchQuery}|${selectedMilestoneId}|${filterType}`;
  
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
      (task.description?.toLowerCase().includes(query) ?? false)
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

  // Check if task matches milestone filter
  function matchesMilestone(task: Task): boolean {
    if (!selectedMilestoneId) return true;
    return task.milestoneId === selectedMilestoneId;
  }
  
  // Assign & Run state
  let isSpawning = false;
  let spawnError = '';
  let spawnSuccess = '';

  // Form state
  let formError = '';
  let formLoading = false;
  let newTaskType: string = 'general';
  let newTask = {
    title: '',
    description: '',
    projectId: '',
    agentId: '',
    assignedTo: '',
    priority: 'P2' as const,
    dueDate: '',
    milestoneId: '',
  };

  function getTypeBadge(type: string | null | undefined): { icon: string; label: string; classes: string } | null {
    if (!type) return null;
    const map: Record<string, { icon: string; label: string; classes: string }> = {
      feature: { icon: '💻', label: 'Development', classes: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      general: { icon: '📌', label: 'General', classes: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
      research: { icon: '🔍', label: 'Research', classes: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
      writing: { icon: '✍️', label: 'Writing', classes: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
      design: { icon: '🎨', label: 'Design', classes: 'bg-pink-500/20 text-pink-400 border-pink-500/30' },
      analysis: { icon: '📊', label: 'Analysis', classes: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
      development: { icon: '💻', label: 'Development', classes: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      bug: { icon: '🐛', label: 'Bug Fix', classes: 'bg-red-500/20 text-red-400 border-red-500/30' },
      chore: { icon: '🔧', label: 'Chore', classes: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
    };
    return map[type] || null;
  }

  // Check if task matches type filter
  function matchesType(task: Task): boolean {
    if (!filterType) return true;
    return task.type === filterType;
  }

  // Milestones for the new task's project
  let newTaskMilestones: Milestone[] = [];
  $: if (newTask.projectId) {
    fetchMilestones(newTask.projectId).then(ms => { newTaskMilestones = ms; });
  } else {
    newTaskMilestones = [];
  }

  // Milestones for the selected task (detail panel)
  let selectedTaskMilestones: Milestone[] = [];
  $: if (selectedTask?.projectId) {
    fetchMilestones(selectedTask.projectId).then(ms => { selectedTaskMilestones = ms; });
  } else {
    selectedTaskMilestones = [];
  }
  
  // Deliverables state
  let deliverables: Deliverable[] = [];
  let loadingDeliverables = false;
  let reviewingDeliverable: string | null = null; // id of deliverable being reviewed
  let reviewFeedback = '';
  let deliverablePreview: Deliverable | null = null;

  async function loadDeliverables(taskId: string) {
    loadingDeliverables = true;
    try {
      deliverables = await fetchTaskDeliverables(taskId);
    } catch (e) {
      console.error('Failed to load deliverables:', e);
    } finally {
      loadingDeliverables = false;
    }
  }

  async function handleReviewDeliverable(id: string, action: 'approved' | 'rejected' | 'changes_requested') {
    await reviewDeliverable(id, action, reviewFeedback || undefined);
    reviewFeedback = '';
    reviewingDeliverable = null;
    if (selectedTask) await loadDeliverables(selectedTask.id);
  }

  async function handleDeleteDeliverable(id: string) {
    if (!confirm('Delete this deliverable?')) return;
    await deleteDeliverable(id);
    if (selectedTask) await loadDeliverables(selectedTask.id);
  }

  function getDeliverableStatusBadge(status: Deliverable['status']): { label: string; classes: string } {
    switch (status) {
      case 'draft': return { label: '📝 Draft', classes: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
      case 'review': return { label: '🔍 Review', classes: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
      case 'approved': return { label: '✅ Approved', classes: 'bg-green-500/20 text-green-300 border-green-500/30' };
      case 'rejected': return { label: '❌ Rejected', classes: 'bg-red-500/20 text-red-300 border-red-500/30' };
      case 'changes_requested': return { label: '🔄 Changes Requested', classes: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
      default: return { label: status, classes: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
    }
  }

  function getDeliverableTypeIcon(type: Deliverable['type']): string {
    switch (type) {
      case 'markdown': return '📄';
      case 'text': return '📃';
      case 'csv': return '📊';
      case 'html': return '🌐';
      case 'pdf': return '📑';
      default: return '📎';
    }
  }

  /** Minimal markdown → HTML for safe agent-produced content */
  function renderMarkdown(md: string): string {
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // Headings
      .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-4 mb-1">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-1">$1</h1>')
      // Bold / italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="bg-slate-600 px-1 rounded text-xs font-mono">$1</code>')
      // Code blocks
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="bg-slate-700 rounded p-3 my-2 text-xs overflow-x-auto whitespace-pre-wrap"><code>$1</code></pre>')
      // Unordered lists
      .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
      // Horizontal rule
      .replace(/^---$/gm, '<hr class="border-slate-600 my-3" />')
      // Line breaks → paragraphs (double newline = paragraph)
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
      const res = await fetch(`${getApiBase()}/tasks/${taskId}/comments`, { credentials: 'include' });
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
      const res = await fetch(`${getApiBase()}/tasks/${selectedTask.id}/comments`, {
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
      await fetch(`${getApiBase()}/tasks/${selectedTask.id}/comments/${commentId}`, {
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
  
  /**
   * Compute conflict warnings from a list of tasks.
   * Returns a map of taskId → array of other in-progress tasks on the same project.
   */
  function computeConflictWarnings(
    allTasks: Task[]
  ): Record<string, Array<{ id: string; title: string; agentId: string }>> {
    const result: Record<string, Array<{ id: string; title: string; agentId: string }>> = {};
    const inProgress = allTasks.filter(t => t.status === 'in-progress' && t.projectId);
    // Group by projectId
    const byProject: Record<string, Task[]> = {};
    for (const t of inProgress) {
      if (!byProject[t.projectId]) byProject[t.projectId] = [];
      byProject[t.projectId].push(t);
    }
    // For each project with 2+ in-progress tasks, build conflict entries
    for (const projectTasks of Object.values(byProject)) {
      if (projectTasks.length < 2) continue;
      for (const task of projectTasks) {
        result[task.id] = projectTasks
          .filter(other => other.id !== task.id)
          .map(other => ({ id: other.id, title: other.title, agentId: other.agentId || 'unknown' }));
      }
    }
    return result;
  }

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

      // Compute git conflict warnings: tasks with same projectId both in-progress
      conflictWarnings = computeConflictWarnings(tasksData);
    } catch (err) {
      console.error('Failed to load tasks view data:', err);
    } finally {
      loading = false;
    }
  }
  
  function getTasksForColumn(columnId: string, _reactiveKey?: string): Task[] {
    let filtered = tasks.filter(t => {
      // Filter by status
      if (t.status !== columnId) return false;
      // Filter by project if one is selected
      if (!matchesProject(t)) return false;
      // Filter by assignee if one is selected
      if (!matchesAssignee(t)) return false;
      // Filter by search query
      if (!matchesSearch(t)) return false;
      // Filter by milestone if one is selected
      if (!matchesMilestone(t)) return false;
      // Filter by type if one is selected
      if (!matchesType(t)) return false;
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
    if (!task.updatedAt) return null;
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
      milestoneId: newTask.milestoneId || undefined,
      type: newTaskType as any,
    } as any);
    
    formLoading = false;
    
    if (result.success) {
      showNewTaskModal = false;
      newTask = { title: '', description: '', projectId: '', agentId: '', assignedTo: '', priority: 'P2', dueDate: '', milestoneId: '' };
      newTaskType = 'general';
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

  /**
   * Assign & Run: sets the agentId and immediately spawns a session.
   * Uses the new POST /api/tasks/:id/spawn endpoint.
   */
  async function handleAssignAndRun(task: Task, agentId?: string) {
    const targetAgentId = agentId || task.agentId;
    if (!targetAgentId) {
      spawnError = 'Please select an agent first';
      return;
    }

    isSpawning = true;
    spawnError = '';
    spawnSuccess = '';

    try {
      const result = await spawnTaskSession(task.id, targetAgentId, !!task.sessionKey);
      if (result.success) {
        spawnSuccess = `✅ Session spawned! Agent ${targetAgentId} is now working on this task.`;
        await loadData();
        // Refresh selectedTask
        if (selectedTask && selectedTask.id === task.id) {
          const updated = tasks.find(t => t.id === task.id);
          if (updated) selectedTask = updated;
        }
        // Auto-close success message after 4s
        setTimeout(() => { spawnSuccess = ''; }, 4000);
      } else {
        spawnError = result.error || 'Failed to spawn session';
      }
    } catch (e: any) {
      spawnError = e.message || 'Network error';
    } finally {
      isSpawning = false;
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
  
  // ── Activity Stream ──────────────────────────────────────────────

  function resetActivityState() {
    activityEntries = [];
    activityCurrentText = '';
    activityPendingDelta = '';
    activityRafPending = false;
    activityFinished = false;
    activityCount = 0;
    activityUserScrolled = false;
  }

  function scrollActivityToBottom() {
    if (!activityUserScrolled && activityScrollEl) {
      requestAnimationFrame(() => {
        if (activityScrollEl) activityScrollEl.scrollTop = activityScrollEl.scrollHeight;
      });
    }
  }

  function handleActivityMsg(msg: any) {
    const { stream, data } = msg;
    if (!showTaskDetail || !selectedTask) return;

    if (stream === 'assistant' && data?.delta) {
      activityPendingDelta += data.delta;
      activityCount++;
      if (!activityRafPending) {
        activityRafPending = true;
        requestAnimationFrame(() => {
          activityCurrentText += activityPendingDelta;
          activityPendingDelta = '';
          activityRafPending = false;
          scrollActivityToBottom();
        });
      }
    } else if (stream === 'lifecycle') {
      if (data?.phase === 'start') {
        activityEntries = [...activityEntries, {
          id: crypto.randomUUID(),
          type: 'lifecycle-start',
          timestamp: msg.timestamp,
          expanded: false,
        }];
        activityCount++;
        scrollActivityToBottom();
      } else if (data?.phase === 'end') {
        // Finalize any pending text
        if (activityPendingDelta) {
          activityCurrentText += activityPendingDelta;
          activityPendingDelta = '';
        }
        if (activityCurrentText) {
          activityEntries = [...activityEntries, {
            id: crypto.randomUUID(),
            type: 'text',
            timestamp: msg.timestamp,
            text: activityCurrentText,
            expanded: false,
          }];
          activityCurrentText = '';
        }
        activityFinished = true;
        activityCount++;
        scrollActivityToBottom();
      }
    } else if (stream === 'complete') {
      // Session fully done
      if (activityCurrentText || activityPendingDelta) {
        activityCurrentText += activityPendingDelta;
        activityPendingDelta = '';
        activityEntries = [...activityEntries, {
          id: crypto.randomUUID(),
          type: 'text',
          timestamp: msg.timestamp,
          text: activityCurrentText,
          expanded: false,
        }];
        activityCurrentText = '';
      }
      activityFinished = true;
      scrollActivityToBottom();
    }
  }

  function openTaskDetail(task: Task) {
    selectedTask = task;
    showTaskDetail = true;
    comments = [];
    newComment = '';
    deliverables = [];
    deliverablePreview = null;
    reviewingDeliverable = null;
    reviewFeedback = '';
    loadComments(task.id);
    loadDeliverables(task.id);
    resetActivityState();

    if (task.status === 'in-progress' && task.sessionKey) {
      activityTab = 'activity'; // auto-switch to live activity
      sendWSMessage({ type: 'watch-task', taskId: task.id });
    } else {
      activityTab = 'details';
    }
  }

  function closeModals() {
    // Stop watching task activity if we were watching
    if (selectedTask?.status === 'in-progress' && selectedTask?.sessionKey) {
      sendWSMessage({ type: 'unwatch-task', taskId: selectedTask.id });
    }
    resetActivityState();
    showNewTaskModal = false;
    showTaskDetail = false;
    selectedTask = null;
    formError = '';
  }
  
  onMount(async () => {
    // Initialize filter state from URL query params on mount
    // (These are local state variables — not reactive $: declarations — so
    //  bind:value on the dropdowns works correctly in Svelte 5.)
    searchQuery = $page.url.searchParams.get('q') || '';
    selectedAssignee = $page.url.searchParams.get('assignee') || '';
    selectedProjectId = $page.url.searchParams.get('project') || '';
    selectedMilestoneId = $page.url.searchParams.get('milestone') || '';
    filterType = $page.url.searchParams.get('type') || '';

    // Initial load
    await loadData();

    // Load milestones if a project filter is set from URL
    const projectParam = $page.url.searchParams.get('project');
    if (projectParam) {
      milestones = await fetchMilestones(projectParam);
    }
    
    // Register WebSocket callback for real-time updates
    onTaskUpdate(() => {
      console.log('[Tasks] WebSocket task update received, refreshing...');
      loadData();
    });

    // Register direct activity stream callback
    removeActivityCallback = addWSMessageCallback((msg) => {
      if (msg.type === 'task-activity' && showTaskDetail && selectedTask && msg.taskId === selectedTask.id) {
        handleActivityMsg(msg);
      }

      // Handle git conflict-warning events in real-time
      if (msg.type === 'task.conflict-warning' && msg.payload) {
        const { task: warningTask, conflictWarning } = msg.payload as {
          task: { id: string };
          conflictWarning: { tasks: Array<{ id: string; title: string; agentId: string }> };
          projectId: string;
        };
        if (warningTask?.id && conflictWarning?.tasks) {
          conflictWarnings = {
            ...conflictWarnings,
            [warningTask.id]: conflictWarning.tasks,
          };
          // Also mark the conflicting tasks as having a warning back toward the new task
          for (const other of conflictWarning.tasks) {
            const existing = conflictWarnings[other.id] || [];
            if (!existing.find(e => e.id === warningTask.id)) {
              conflictWarnings = {
                ...conflictWarnings,
                [other.id]: [
                  ...existing,
                  { id: warningTask.id, title: warningTask.id, agentId: '' },
                ],
              };
            }
          }
          // Reload tasks to get fresh data (includes the title for back-references)
          loadData();
        }
      }
    });
  });

  onDestroy(() => {
    removeActivityCallback?.();
    // Unwatch if detail was open when component was destroyed
    if (selectedTask?.status === 'in-progress' && selectedTask?.sessionKey) {
      sendWSMessage({ type: 'unwatch-task', taskId: selectedTask.id });
    }
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
    <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 w-full max-w-md max-h-[90vh] flex flex-col" on:click|stopPropagation on:keydown|stopPropagation role="dialog" aria-modal="true" aria-labelledby="new-task-title" tabindex="-1">
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
        <h2 id="new-task-title" class="font-semibold">New Task</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>
      <div class="p-4 space-y-4 overflow-y-auto flex-1">
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
          <label for="task-type" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Type</label>
          <select
            id="task-type"
            bind:value={newTaskType}
            class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="general">📌 General</option>
            <option value="research">🔍 Research</option>
            <option value="writing">✍️ Writing</option>
            <option value="design">🎨 Design</option>
            <option value="analysis">📊 Analysis</option>
            <option value="development">💻 Development</option>
            <option value="bug">🐛 Bug Fix</option>
            <option value="chore">🔧 Chore</option>
          </select>
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

        {#if newTaskMilestones.length > 0}
          <div>
            <label for="task-milestone" class="block text-sm text-slate-500 dark:text-slate-400 mb-1">Milestone (Optional)</label>
            <select
              id="task-milestone"
              bind:value={newTask.milestoneId}
              class="w-full px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded focus:border-blue-500 focus:outline-none"
            >
              <option value="">No milestone</option>
              {#each newTaskMilestones.filter(m => m.status === 'open') as m}
                <option value={m.id}>🎯 {m.name}</option>
              {/each}
            </select>
          </div>
        {/if}
      </div>
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-2 flex-shrink-0">
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
      <div class="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
        <h2 id="task-detail-title" class="font-semibold">Task Details</h2>
        <button on:click={closeModals} class="text-slate-500 dark:text-slate-400 hover:text-white">✕</button>
      </div>

      <!-- Tabs (only for in-progress tasks with a session) -->
      {#if selectedTask.status === 'in-progress' && selectedTask.sessionKey}
        <div class="flex border-b border-gray-200 dark:border-slate-700 flex-shrink-0 bg-white dark:bg-slate-800">
          <button
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activityTab === 'details' ? 'border-blue-500 text-blue-500' : 'border-transparent text-slate-500 hover:text-slate-200'}"
            on:click={() => activityTab = 'details'}
          >Details</button>
          <button
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 {activityTab === 'activity' ? 'border-blue-500 text-blue-500' : 'border-transparent text-slate-500 hover:text-slate-200'}"
            on:click={() => activityTab = 'activity'}
          >
            Live Activity
            {#if activityCount > 0}
              <span class="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{activityCount > 99 ? '99+' : activityCount}</span>
            {/if}
          </button>
        </div>
      {/if}

      <!-- Activity panel (shown when activity tab active) -->
      {#if activityTab === 'activity' && selectedTask.status === 'in-progress' && selectedTask.sessionKey}
        <div
          class="flex-1 overflow-y-auto bg-gray-950 min-h-0 font-mono text-xs p-3 space-y-1"
          bind:this={activityScrollEl}
          on:scroll={(e) => {
            const el = e.currentTarget;
            activityUserScrolled = el.scrollHeight - el.scrollTop - el.clientHeight > 50;
          }}
        >
          {#if activityEntries.length === 0 && !activityCurrentText}
            <div class="flex flex-col items-center justify-center h-32 text-slate-600 gap-2">
              <span class="text-2xl animate-pulse">⚡</span>
              <span>Waiting for agent activity…</span>
            </div>
          {:else}
            {#each activityEntries as entry (entry.id)}
              {#if entry.type === 'lifecycle-start'}
                <div class="text-green-500 py-1">🚀 Agent started <span class="text-slate-600">{new Date(entry.timestamp).toLocaleTimeString()}</span></div>
              {:else if entry.type === 'text'}
                <div class="mb-2">
                  <div class="text-slate-600 mb-0.5">{new Date(entry.timestamp).toLocaleTimeString()}</div>
                  {#if entry.expanded || (entry.text?.length ?? 0) <= 400}
                    <pre class="whitespace-pre-wrap text-slate-300 font-sans leading-relaxed">{entry.text}</pre>
                  {:else}
                    <pre class="whitespace-pre-wrap text-slate-300 font-sans leading-relaxed">{entry.text?.slice(0, 400)}…</pre>
                    <button
                      class="text-blue-400 hover:underline mt-0.5"
                      on:click={() => { entry.expanded = true; activityEntries = activityEntries; }}
                    >Show more</button>
                  {/if}
                </div>
              {:else if entry.type === 'complete'}
                <div class="text-green-400 border-t border-slate-800 pt-2 mt-2">✅ Agent session complete</div>
              {/if}
            {/each}

            <!-- Live streaming text with cursor -->
            {#if activityCurrentText}
              <div class="mb-2">
                <div class="text-slate-600 mb-0.5">live</div>
                <pre class="whitespace-pre-wrap text-slate-200 font-sans leading-relaxed">{activityCurrentText.length > 800 ? '…' + activityCurrentText.slice(-800) : activityCurrentText}<span class="text-blue-400 animate-pulse">▋</span></pre>
              </div>
            {/if}

            {#if activityFinished && !activityCurrentText}
              <div class="text-slate-600 text-center pt-3 pb-1 border-t border-slate-800 mt-2">— session ended —</div>
            {/if}
          {/if}

          <!-- Scroll-to-bottom button -->
          {#if activityUserScrolled}
            <button
              class="sticky bottom-2 left-1/2 -translate-x-1/2 block mx-auto bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs px-3 py-1 rounded-full shadow"
              on:click={() => { activityUserScrolled = false; scrollActivityToBottom(); }}
            >↓ Jump to bottom</button>
          {/if}
        </div>

      <!-- Details panel (default) -->
      {:else}
      <div class="p-4 space-y-4 overflow-y-auto flex-1">
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
            on:change={(e) => handleAssignAgent(selectedTask!.id, e.currentTarget.value || null)}
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
              await updateTask(selectedTask!.id, { assignedTo: val });
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
                await updateTask(selectedTask!.id, { dueDate: isoDate });
                await loadData();
                if (selectedTask) selectedTask = { ...selectedTask, dueDate: isoDate };
              }}
              class="flex-1 bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-white"
            />
            {#if selectedTask.dueDate}
              <button
                on:click={async () => {
                  await updateTask(selectedTask!.id, { dueDate: null });
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

        {#if selectedTaskMilestones.length > 0}
          <div>
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-1">Milestone</h4>
            <select
              class="w-full bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-white"
              value={selectedTask.milestoneId || ''}
              on:change={async (e) => {
                const val = e.currentTarget.value || null;
                await updateTask(selectedTask!.id, { milestoneId: val } as any);
                await loadData();
                if (selectedTask) selectedTask = { ...selectedTask, milestoneId: val };
              }}
            >
              <option value="">No milestone</option>
              {#each selectedTaskMilestones.filter(m => m.status === 'open') as m}
                <option value={m.id}>🎯 {m.name}</option>
              {/each}
            </select>
          </div>
        {/if}

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

        <div class="flex items-center gap-2">
          <span class="text-slate-500 text-sm w-24">Type</span>
          <select
            value={selectedTask?.type || 'general'}
            on:change={async (e) => {
              await updateTask(selectedTask!.id, { type: e.currentTarget.value as any });
              await loadData();
            }}
            class="px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded"
          >
            <option value="general">📌 General</option>
            <option value="research">🔍 Research</option>
            <option value="writing">✍️ Writing</option>
            <option value="design">🎨 Design</option>
            <option value="analysis">📊 Analysis</option>
            <option value="development">💻 Development</option>
            <option value="bug">🐛 Bug Fix</option>
            <option value="chore">🔧 Chore</option>
          </select>
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
            <h4 class="text-sm text-slate-500 dark:text-slate-400 mb-2">⏱️ Time & Cost</h4>
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
                  AI Cost: <span class="font-semibold">${selectedTask.cost.toFixed(4)}</span>
                </p>
              {/if}
              {#if selectedTask.humanCost}
                <p class="text-slate-600 dark:text-slate-300">
                  Human Cost: <span class="font-semibold">${selectedTask.humanCost.toFixed(2)}</span>
                </p>
              {/if}
              {#if selectedTask.tokensIn != null || selectedTask.tokensOut != null || selectedTask.tokens}
                {@const tIn = selectedTask.tokensIn ?? selectedTask.tokens?.input ?? 0}
                {@const tOut = selectedTask.tokensOut ?? selectedTask.tokens?.output ?? 0}
                <p class="text-slate-600 dark:text-slate-300">
                  Tokens In: <span class="font-semibold text-amber-400">{formatTokens(tIn)}</span>
                </p>
                <p class="text-slate-600 dark:text-slate-300">
                  Tokens Out: <span class="font-semibold text-amber-300">{formatTokens(tOut)}</span>
                </p>
                <p class="text-slate-600 dark:text-slate-300">
                  Total Tokens: <span class="font-semibold">{formatTokens(tIn + tOut)}</span>
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

        <!-- Deliverables Section -->
        <div class="pt-2 border-t border-gray-200 dark:border-slate-700">
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-sm text-slate-500 dark:text-slate-400">📦 Deliverables ({deliverables.length})</h4>
            {#if deliverables.some(d => d.status === 'review')}
              <span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {deliverables.filter(d => d.status === 'review').length} pending review
              </span>
            {/if}
          </div>

          {#if loadingDeliverables}
            <p class="text-xs text-slate-500">Loading deliverables...</p>
          {:else if deliverables.length === 0}
            <p class="text-xs text-slate-500 italic">No deliverables yet. Agents will drop files here when done.</p>
          {:else}
            <div class="space-y-2">
              {#each deliverables as d (d.id)}
                {@const badge = getDeliverableStatusBadge(d.status)}
                <div class="bg-slate-700/50 rounded border border-slate-600 p-2">
                  <!-- Header row -->
                  <div class="flex items-start gap-2 mb-1">
                    <span class="text-sm">{getDeliverableTypeIcon(d.type)}</span>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-slate-200 truncate">{d.title}</p>
                      <p class="text-xs text-slate-500">{new Date(d.createdAt).toLocaleString()}{d.agentId ? ` · ${d.agentId}` : ''}</p>
                    </div>
                    <span class="text-xs px-1.5 py-0.5 rounded border flex-shrink-0 {badge.classes}">{badge.label}</span>
                  </div>

                  <!-- Feedback (if any) -->
                  {#if d.feedback}
                    <div class="mt-1 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-300">
                      💬 {d.feedback}
                    </div>
                  {/if}

                  <!-- Preview / Download -->
                  <div class="flex items-center gap-2 mt-2">
                    {#if d.content}
                      <button
                        on:click={() => { deliverablePreview = deliverablePreview?.id === d.id ? null : d; }}
                        class="text-xs px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded transition-colors"
                      >
                        {deliverablePreview?.id === d.id ? 'Hide' : '👁 Preview'}
                      </button>
                      <button
                        on:click={() => downloadDeliverable(d)}
                        class="text-xs px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded transition-colors"
                      >
                        ⬇ Download
                      </button>
                    {/if}

                    <!-- Review actions (only when in review status) -->
                    {#if d.status === 'review'}
                      {#if reviewingDeliverable === d.id}
                        <div class="flex-1 flex gap-1 flex-wrap">
                          <input
                            type="text"
                            bind:value={reviewFeedback}
                            placeholder="Feedback (optional)..."
                            class="flex-1 min-w-0 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white placeholder-slate-500"
                          />
                          <button on:click={() => handleReviewDeliverable(d.id, 'approved')} class="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-white">✅ Approve</button>
                          <button on:click={() => handleReviewDeliverable(d.id, 'changes_requested')} class="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-700 rounded text-white">🔄 Changes</button>
                          <button on:click={() => handleReviewDeliverable(d.id, 'rejected')} class="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-white">❌ Reject</button>
                          <button on:click={() => { reviewingDeliverable = null; reviewFeedback = ''; }} class="text-xs px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded">Cancel</button>
                        </div>
                      {:else}
                        <button
                          on:click={() => { reviewingDeliverable = d.id; reviewFeedback = ''; }}
                          class="ml-auto text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 rounded text-white"
                        >
                          📋 Review
                        </button>
                      {/if}
                    {:else}
                      <button
                        on:click={() => handleDeleteDeliverable(d.id)}
                        class="ml-auto text-xs text-red-400 hover:text-red-300 transition-colors"
                        title="Delete deliverable"
                      >✕</button>
                    {/if}
                  </div>

                  <!-- Content preview panel -->
                  {#if deliverablePreview?.id === d.id && d.content}
                    <div class="mt-2 border-t border-slate-600 pt-2">
                      {#if d.type === 'markdown'}
                        <div class="prose prose-invert prose-sm max-w-none text-slate-200 text-sm leading-relaxed max-h-96 overflow-y-auto">
                          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                          {@html '<p class="mb-2">' + renderMarkdown(d.content) + '</p>'}
                        </div>
                      {:else if d.type === 'csv'}
                        <div class="overflow-x-auto max-h-64">
                          <table class="text-xs w-full border-collapse">
                            {#each d.content.trim().split('\n') as row, i}
                              <tr class="{i === 0 ? 'font-semibold bg-slate-600' : 'even:bg-slate-700/40'}">
                                {#each row.split(',') as cell}
                                  <td class="border border-slate-600 px-2 py-1 text-slate-200">{cell.trim()}</td>
                                {/each}
                              </tr>
                            {/each}
                          </table>
                        </div>
                      {:else}
                        <pre class="text-xs text-slate-300 whitespace-pre-wrap max-h-64 overflow-y-auto">{d.content}</pre>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

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
      {/if}<!-- end activity/details panel -->
      <div class="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex-shrink-0">
        <!-- Spawn status messages -->
        {#if spawnError}
          <div class="mb-2 px-3 py-2 bg-red-500/20 border border-red-500/30 rounded text-red-400 text-xs">
            ❌ {spawnError}
          </div>
        {/if}
        {#if spawnSuccess}
          <div class="mb-2 px-3 py-2 bg-green-500/20 border border-green-500/30 rounded text-green-400 text-xs">
            {spawnSuccess}
          </div>
        {/if}
        <div class="flex justify-between gap-2">
          <!-- Left: action buttons -->
          <div class="flex gap-2">
            {#if !selectedTask.sessionKey}
              <!-- Assign & Run: spawn a session for this task using its agentId -->
              <button
                on:click={() => handleAssignAndRun(selectedTask!)}
                disabled={isSpawning || !selectedTask.agentId}
                title={!selectedTask.agentId ? 'Set an agent above first' : `Spawn ${selectedTask.agentId} to work on this task`}
                class="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
              >
                {#if isSpawning}
                  <span class="animate-spin">⏳</span> Spawning…
                {:else}
                  ⚡ Assign & Run
                {/if}
              </button>
              <!-- Start Work button removed — Assign & Run replaces it -->
            {:else}
              <!-- Already has a session — offer re-spawn (force) -->
              <button
                on:click={() => handleAssignAndRun(selectedTask!)}
                disabled={isSpawning || !selectedTask.agentId}
                title="Re-spawn: spawn a new session even though one already exists"
                class="px-4 py-2 bg-purple-600/60 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
              >
                {#if isSpawning}
                  <span class="animate-spin">⏳</span> Spawning…
                {:else}
                  ⚡ Re-Spawn
                {/if}
              </button>
            {/if}
          </div>
          <!-- Right: delete + close -->
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
  </div>
{/if}

<!-- Main Content -->
<div class="space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between gap-4 flex-wrap">
    <h1 class="text-2xl font-semibold">📋 Tasks</h1>
    
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

      <!-- Milestone Filter (shown when a project is selected) -->
      {#if selectedProjectId && milestones.length > 0}
        <select
          bind:value={selectedMilestoneId}
          class="px-3 py-2 bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:border-blue-500 min-w-[140px]"
        >
          <option value="">All Milestones</option>
          {#each milestones as m}
            <option value={m.id}>🎯 {m.name}</option>
          {/each}
        </select>
      {/if}

      <!-- Type Filter -->
      <select bind:value={filterType} class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:border-blue-500">
        <option value="">All Types</option>
        <option value="general">📌 General</option>
        <option value="development">💻 Development</option>
        <option value="bug">🐛 Bug Fix</option>
        <option value="chore">🔧 Chore</option>
        <option value="research">🔍 Research</option>
        <option value="writing">✍️ Writing</option>
        <option value="design">🎨 Design</option>
        <option value="analysis">📊 Analysis</option>
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
              {getTasksForColumn(column.id, filterKey).length}
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
            
            {#each getTasksForColumn(column.id, filterKey) as task (task.id)}
              <div 
                draggable="true"
                on:dragstart={() => handleDragStart(task)}
                on:click={() => openTaskDetail(task)}
                class="p-3 bg-white dark:bg-slate-800 rounded-lg border border-gray-300 dark:border-slate-600 hover:border-slate-500 cursor-move hover:bg-gray-100 dark:hover:bg-slate-700 transition-all {draggedTask && draggedTask.id === task.id ? 'opacity-50 scale-95' : ''}"
              >
                <!-- Title + Age Badge + Type Badge -->
                <div class="flex items-start gap-2 mb-1">
                  <h3 class="font-semibold text-sm flex-1">{task.title}</h3>
                  {#if task.type}
                    {@const badge = getTypeBadge(task.type)}
                    {#if badge}
                      <span class="text-xs px-1.5 py-0.5 rounded-full border flex-shrink-0 {badge.classes}">
                        {badge.icon} {badge.label}
                      </span>
                    {/if}
                  {/if}
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

                <!-- Git Conflict Warning Badge -->
                {#if conflictWarnings[task.id]?.length > 0}
                  <div class="mb-2 pb-2 border-b border-yellow-500/30">
                    {#each conflictWarnings[task.id] as conflict}
                      <div class="flex items-center gap-1 text-xs text-yellow-400 font-medium" title="Potential git conflict: both tasks are in-progress on the same project">
                        <span>⚠️</span>
                        <span class="truncate">{conflict.agentId && conflict.agentId !== 'unknown' ? conflict.agentId : 'Another agent'} is also working on this project</span>
                      </div>
                    {/each}
                  </div>
                {/if}
                
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
                  <div class="flex items-center gap-1.5 flex-shrink-0">
                    <!-- Quick Assign & Run button on kanban card -->
                    {#if task.agentId && !task.sessionKey && (task.status === 'todo' || task.status === 'in-progress' || task.status === 'backlog')}
                      <button
                        on:click|stopPropagation={() => handleAssignAndRun(task)}
                        disabled={isSpawning}
                        title="Assign & Run: spawn {task.agentId} to work on this task"
                        class="px-1.5 py-0.5 rounded bg-purple-600/80 hover:bg-purple-600 text-white text-[10px] font-semibold transition-colors disabled:opacity-50"
                      >
                        ⚡ Run
                      </button>
                    {/if}
                    <span class={`px-1.5 py-0.5 rounded-full text-xs font-semibold text-white ${getPriorityColor(task.priority)}`}>
                      {task.priority}
                    </span>
                  </div>
                </div>
              </div>
            {/each}
            
            <!-- Empty State -->
            {#if getTasksForColumn(column.id, filterKey).length === 0}
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
