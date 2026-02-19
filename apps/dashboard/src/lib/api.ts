// API client for Mission Clawtrol backend

// Use same hostname as frontend, but port 3001 for backend
const API_BASE = typeof window !== 'undefined' 
  ? `http://${window.location.hostname}:3001/api`
  : 'http://localhost:3001/api';

const REQUEST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(input, { 
      ...init, 
      signal: controller.signal,
      credentials: 'include', // Required for cookie-based sessions
    });

    // Session expired — redirect to login (skip for auth/me to avoid redirect loops)
    if (res.status === 401 && typeof window !== 'undefined') {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.includes('/auth/me') && !url.includes('/auth/logout')) {
        window.location.href = '/login';
      }
    }

    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// Current user type
export interface CurrentUser {
  id: string;
  username: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  role?: 'admin' | 'member' | 'viewer';
}

// Logout
export async function logout(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/auth/logout`, { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

// Fetch current authenticated user
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/auth/me`);
    if (res.status === 401) {
      return null;
    }
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch current user:', error);
    return null;
  }
}


export interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'error' | 'offline';
  role?: string;
  task?: string;
  lastActive?: string;
  model?: string;
  tokens?: number;
  emoji?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  hasStatusMd?: boolean;
  hasProjectMd?: boolean;
  hasHandoffMd?: boolean;
  statusMd?: string;
  projectMd?: string;
  handoffMd?: string;
  files?: string[];
  updated?: string;
  repoUrl?: string | null;
  reportChannel?: string | null;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'message' | 'status' | 'file' | 'approval' | 'task' | 'spawn' | 'complete' | 'error' | 'project' | 'system';
  agent?: string;
  from?: string;
  to?: string;
  message?: string;
  project?: string;
  model?: string;
  sessionKey?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
}

// Agents - use roster endpoint for full agent list from config
export async function fetchAgents(): Promise<Agent[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/roster`);
    const data = await res.json();
    // Map roster format to Agent interface
    return (data.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      status: a.status === 'online' ? 'working' : a.status === 'idle' ? 'idle' : 'offline',
      role: a.fullName,
      lastActive: a.lastActive,
      model: a.model,
      tokens: 0,
      emoji: a.emoji,
    }));
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return [];
  }
}

export async function fetchAgent(id: string): Promise<Agent | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    return null;
  }
}

export async function sendMessageToAgent(id: string, message: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return res.ok;
  } catch (error) {
    console.error('Failed to send message:', error);
    return false;
  }
}

// Projects
export async function fetchProjects(): Promise<Project[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects`);
    const data = await res.json();
    return data.projects || [];
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return [];
  }
}

export async function fetchProject(id: string): Promise<Project | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch project:', error);
    return null;
  }
}

export interface CreateProjectParams {
  name: string;
  description?: string;
}

export async function createProject(params: CreateProjectParams): Promise<{ success: boolean; project?: Project; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to create project' };
    }
    return { success: true, project: data.project };
  } catch (error) {
    console.error('Failed to create project:', error);
    return { success: false, error: 'Network error' };
  }
}

export async function deleteProject(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      return { success: false, error: data.error || 'Failed to delete project' };
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to delete project:', error);
    return { success: false, error: 'Network error' };
  }
}

export interface ImportableFolder {
  id: string;
  name: string;
  path: string;
}

export async function fetchImportableFolders(): Promise<ImportableFolder[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/importable`);
    const data = await res.json();
    return data.folders || [];
  } catch (error) {
    console.error('Failed to fetch importable folders:', error);
    return [];
  }
}

export interface ImportProjectParams {
  folderId: string;
  description?: string;
}

export async function importProject(params: ImportProjectParams): Promise<{ success: boolean; project?: Project; createdFiles?: string[]; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to import project' };
    }
    return { success: true, project: data.project, createdFiles: data.createdFiles };
  } catch (error) {
    console.error('Failed to import project:', error);
    return { success: false, error: 'Network error' };
  }
}

// Agent spawning
export interface SpawnAgentParams {
  task?: string;
  label?: string;
  model?: string;
  projectId?: string;
  taskId?: string; // Link to existing task instead of creating new
  timeoutSeconds?: number;
}

export interface SpawnResult {
  success: boolean;
  childSessionKey?: string;
  runId?: string;
  error?: string;
  errorCode?: string;
  details?: string;
}

export async function spawnAgent(params: SpawnAgentParams): Promise<SpawnResult> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { 
        success: false, 
        error: data.error || 'Failed to spawn agent',
        errorCode: data.code,
        details: data.details,
      };
    }
    return { success: true, ...data };
  } catch (error) {
    console.error('Failed to spawn agent:', error);
    return { success: false, error: 'Network error' };
  }
}

export async function fetchAgentHistory(id: string, limit = 20): Promise<{ messages?: Array<{ role: string; content: string }>; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/${encodeURIComponent(id)}/history?limit=${limit}`);
    if (!res.ok) {
      const data = await res.json();
      return { error: data.error || 'Failed to fetch history' };
    }
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch agent history:', error);
    return { error: 'Network error' };
  }
}

// Project-Agent associations
export interface AgentAssociation {
  sessionKey: string;
  projectId: string;
  task: string;
  spawnedAt: number;
  label?: string;
  model?: string;
  status: 'running' | 'completed' | 'failed' | 'unknown';
  completedAt?: number;
  result?: string;
}

export async function fetchProjectAgents(projectId: string): Promise<AgentAssociation[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/project/${encodeURIComponent(projectId)}`);
    const data = await res.json();
    return data.agents || [];
  } catch (error) {
    console.error('Failed to fetch project agents:', error);
    return [];
  }
}

// Deduplicated agent summary from task DB
export interface AgentSummary {
  agentId: string;
  taskCount: number;
  doneTasks: number;
  inProgress: number;
  lastActive: string;
  models: string[];
}

export async function fetchProjectAgentSummary(projectId: string): Promise<AgentSummary[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(projectId)}/agent-summary`);
    const data = await res.json();
    return data.agents || [];
  } catch (error) {
    console.error('Failed to fetch agent summary:', error);
    return [];
  }
}

export async function deleteAgent(sessionKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/${encodeURIComponent(sessionKey)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to delete agent' };
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to delete agent:', error);
    return { success: false, error: 'Network error' };
  }
}

export async function changeAgentModel(sessionKey: string, model: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents/${encodeURIComponent(sessionKey)}/model`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to change model' };
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to change agent model:', error);
    return { success: false, error: 'Network error' };
  }
}

// Activity
export async function fetchActivity(limit = 50): Promise<ActivityEvent[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/activity?limit=${limit}`);
    const data = await res.json();
    return data.events || [];
  } catch (error) {
    console.error('Failed to fetch activity:', error);
    return [];
  }
}

// Health check
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// Tasks
export interface Task {
  id: string;
  title: string;
  description?: string;
  projectId: string;
  projectName?: string;
  agentId?: string | null;
  agentName?: string;
  agentEmoji?: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number; // estimated USD
  model?: string; // which model was used
  runtime?: number; // milliseconds
  commitHash?: string; // Git commit hash for this task
  sessionKey?: string;
  linesChanged?: {
    added: number;
    removed: number;
    total: number;
  };
  estimatedHumanMinutes?: number; // Auto-calculated from lines changed
  humanCost?: number; // Auto-calculated cost
  createdBy?: string | null;
  assignedTo?: string | null;
  createdByName?: string | null; // Populated client-side
  assignedToName?: string | null; // Populated client-side
  dueDate?: string | null; // ISO timestamp for when task is due
  milestoneId?: string | null; // Milestone this task belongs to
  type?: 'feature' | 'bug' | 'chore' | 'spike' | 'docs' | null; // Task type for bug tracking
}

export interface UserInfo {
  id: string;
  githubLogin: string;
  username?: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
}

export async function fetchUsers(): Promise<UserInfo[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/users`);
    const data = await res.json();
    return data.users || [];
  } catch (error) {
    console.error('Failed to fetch users:', error);
    return [];
  }
}

export async function fetchTasks(): Promise<Task[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/tasks`);
    const data = await res.json();
    return data.tasks || [];
  } catch (error) {
    console.error('Failed to fetch tasks:', error);
    return [];
  }
}

export interface CreateTaskParams {
  title: string;
  description?: string;
  projectId: string;
  agentId?: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status?: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';
  dueDate?: string;
  assignedTo?: string;
  type?: 'feature' | 'bug' | 'chore' | 'spike' | 'docs' | null;
}

export async function createTask(params: CreateTaskParams): Promise<{ success: boolean; task?: Task; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to create task' };
    }
    return { success: true, task: data.task };
  } catch (error) {
    console.error('Failed to create task:', error);
    return { success: false, error: 'Network error' };
  }
}

export interface UpdateTaskParams {
  title?: string;
  description?: string;
  agentId?: string | null;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  status?: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';
  estimatedHumanMinutes?: number;
  humanHourlyRate?: number;
  complexity?: 'simple' | 'medium' | 'complex';
  dueDate?: string | null;
  assignedTo?: string | null;
  type?: 'feature' | 'bug' | 'chore' | 'spike' | 'docs' | null;
}

export async function updateTask(id: string, params: UpdateTaskParams): Promise<{ success: boolean; task?: Task; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to update task' };
    }
    return { success: true, task: data.task };
  } catch (error) {
    console.error('Failed to update task:', error);
    return { success: false, error: 'Network error' };
  }
}

export async function deleteTask(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      return { success: false, error: data.error || 'Failed to delete task' };
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task:', error);
    return { success: false, error: 'Network error' };
  }
}

// Milestones
export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  targetDate?: string;
  status: 'open' | 'closed';
  totalTasks: number;
  doneTasks: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchMilestones(projectId: string): Promise<Milestone[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/milestones?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.milestones || [];
  } catch (error) {
    console.error('Failed to fetch milestones:', error);
    return [];
  }
}

export async function fetchAllMilestones(): Promise<(Milestone & { projectName?: string })[]> {
  try {
    // Fetch all projects, then milestones for each
    const projects = await fetchProjects();
    const results: (Milestone & { projectName?: string })[] = [];
    await Promise.all(
      projects.map(async (p) => {
        const milestones = await fetchMilestones(p.id);
        milestones.forEach((m) => results.push({ ...m, projectName: p.name }));
      })
    );
    // Sort by targetDate ascending (nulls last)
    results.sort((a, b) => {
      if (!a.targetDate && !b.targetDate) return 0;
      if (!a.targetDate) return 1;
      if (!b.targetDate) return -1;
      return a.targetDate.localeCompare(b.targetDate);
    });
    return results;
  } catch (error) {
    console.error('Failed to fetch all milestones:', error);
    return [];
  }
}

export async function createMilestone(data: {
  projectId: string;
  name: string;
  description?: string;
  targetDate?: string;
}): Promise<Milestone> {
  const res = await fetchWithTimeout(`${API_BASE}/milestones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create milestone');
  }
  return res.json();
}

export async function updateMilestone(id: string, data: Partial<Milestone>): Promise<Milestone> {
  const res = await fetchWithTimeout(`${API_BASE}/milestones/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update milestone');
  }
  return res.json();
}

export async function deleteMilestone(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/milestones/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete milestone');
  }
}

// Settings
export interface Settings {
  humanHourlyRate: number;
  kanbanColumnWidth?: number;
}

export async function fetchSettings(): Promise<Settings> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/settings`);
    if (!res.ok) {
      // Return default if endpoint doesn't exist
      return { humanHourlyRate: 100 };
    }
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return { humanHourlyRate: 100 };
  }
}

// Messaging - Send message to main agent with project context
export interface SendMessageParams {
  message: string;
  projectId?: string;
}

export interface SendMessageResult {
  success: boolean;
  result?: any;
  sessionKey?: string;
  projectId?: string | null;
  error?: string;
}

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Failed to send message' };
    }
    return { success: true, ...data };
  } catch (error) {
    console.error('Failed to send message:', error);
    return { success: false, error: 'Network error' };
  }
}

// Get message history with main agent
export async function fetchMessageHistory(limit = 20): Promise<{ messages?: Array<{ role: string; content: string }>; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/message/history?limit=${limit}`);
    if (!res.ok) {
      const data = await res.json();
      return { error: data.error || 'Failed to fetch history' };
    }
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch message history:', error);
    return { error: 'Network error' };
  }
}

// Audit Log
export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: any;
  createdAt: string;
}

export interface FetchAuditParams {
  entityType?: string;
  entityId?: string;
  userId?: string;
  limit?: number;
}

export async function fetchAuditLog(params?: FetchAuditParams): Promise<AuditEntry[]> {
  try {
    const queryParams = new URLSearchParams();
    if (params?.entityType) queryParams.set('entityType', params.entityType);
    if (params?.entityId) queryParams.set('entityId', params.entityId);
    if (params?.userId) queryParams.set('userId', params.userId);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    
    const url = `${API_BASE}/audit${queryParams.toString() ? `?${queryParams}` : ''}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    return data.auditLog || [];
  } catch (error) {
    console.error('Failed to fetch audit log:', error);
    return [];
  }
}

// Generic API helper for custom endpoints
export const api = {
  get: async (path: string) => {
    const res = await fetchWithTimeout(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  post: async (path: string, body: any) => {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return res.json();
  },
  patch: async (path: string, body: any) => {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return res.json();
  },
  delete: async (path: string) => {
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `API error: ${res.status}`);
    }
    return res.json();
  },
};

// Webhook types
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
  createdAt: string;
}

// Fetch all webhooks
export async function fetchWebhooks(): Promise<Webhook[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/webhooks`);
    if (!res.ok) throw new Error('Failed to fetch webhooks');
    const data = await res.json();
    return data.webhooks || [];
  } catch (err) {
    console.error('fetchWebhooks error:', err);
    throw err;
  }
}

// Create a new webhook
export async function createWebhook(webhook: {
  url: string;
  events: string[];
  secret?: string;
  enabled?: boolean;
}): Promise<Webhook> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhook),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to create webhook');
    }
    return res.json();
  } catch (err) {
    console.error('createWebhook error:', err);
    throw err;
  }
}

// Update a webhook
export async function updateWebhook(id: string, updates: Partial<Webhook>): Promise<Webhook> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/webhooks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to update webhook');
    }
    return res.json();
  } catch (err) {
    console.error('updateWebhook error:', err);
    throw err;
  }
}

// Delete a webhook
export async function deleteWebhook(id: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/webhooks/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to delete webhook');
    }
  } catch (err) {
    console.error('deleteWebhook error:', err);
    throw err;
  }
}

// Test a webhook
export async function testWebhook(id: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/webhooks/${id}/test`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to test webhook');
    }
  } catch (err) {
    console.error('testWebhook error:', err);
    throw err;
  }
}

// ---- Weekly Report ----

export interface ReportTask {
  id: string;
  title: string;
  status: string;
  priority?: number;
  agentId?: string;
  projectId?: string;
  projectName?: string;
  completedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  type?: 'feature' | 'bug' | 'chore' | 'spike' | 'docs' | null;
}

export interface ReportMilestone {
  id: string;
  name: string;
  status: string;
  targetDate?: string;
  totalTasks: number;
  doneTasks: number;
  progress: number;
}

export interface WeeklyReport {
  period: { from: string; to: string; days: number };
  projectId: string | null;
  shipped: Array<{ projectId: string; projectName: string; taskCount: number; tasks: ReportTask[] }>;
  inProgress: ReportTask[];
  inReview: ReportTask[];
  upcoming: ReportTask[];
  costs: {
    aiCost: number;
    humanCost: number;
    savings: number;
    roi: string;
    hoursSaved: number;
    tasksCompleted: number;
  };
  milestones: ReportMilestone[];
  flags: string[];
}

export async function fetchWeeklyReport(days = 7, projectId?: string): Promise<WeeklyReport> {
  const params = new URLSearchParams({ days: String(days) });
  if (projectId) params.set('projectId', projectId);
  const res = await fetchWithTimeout(`${API_BASE}/reports/weekly?${params}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || `Failed to fetch weekly report: ${res.status}`);
  }
  return res.json();
}

export async function sendWeeklyReport(params?: {
  channelId?: string;
  projectId?: string;
  days?: number;
}): Promise<{ ok: boolean; ts?: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/reports/weekly/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || `Failed to send weekly report: ${res.status}`);
  }
  return res.json();
}
