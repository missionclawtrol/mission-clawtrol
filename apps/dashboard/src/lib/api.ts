// API client for Mission Clawtrol backend

// Use same hostname as frontend, but port 3001 for backend
const API_BASE = typeof window !== 'undefined' 
  ? `http://${window.location.hostname}:3001/api`
  : 'http://localhost:3001/api';

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
  hasStatusMd?: boolean;
  hasProjectMd?: boolean;
  hasHandoffMd?: boolean;
  statusMd?: string;
  projectMd?: string;
  handoffMd?: string;
  files?: string[];
  updated?: string;
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
    const res = await fetch(`${API_BASE}/agents/roster`);
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
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    return null;
  }
}

export async function sendMessageToAgent(id: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(id)}/message`, {
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
    const res = await fetch(`${API_BASE}/projects`);
    const data = await res.json();
    return data.projects || [];
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return [];
  }
}

export async function fetchProject(id: string): Promise<Project | null> {
  try {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}`);
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
    const res = await fetch(`${API_BASE}/projects`, {
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
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}`, {
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

// Agent spawning
export interface SpawnAgentParams {
  task?: string;
  label?: string;
  model?: string;
  projectId?: string;
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
    const res = await fetch(`${API_BASE}/agents/spawn`, {
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
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(id)}/history?limit=${limit}`);
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
    const res = await fetch(`${API_BASE}/agents/project/${encodeURIComponent(projectId)}`);
    const data = await res.json();
    return data.agents || [];
  } catch (error) {
    console.error('Failed to fetch project agents:', error);
    return [];
  }
}

export async function deleteAgent(sessionKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(sessionKey)}`, {
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
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(sessionKey)}/model`, {
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
    const res = await fetch(`${API_BASE}/activity?limit=${limit}`);
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
    const res = await fetch(`${API_BASE}/health`);
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
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  status: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';
  createdAt?: string;
  updatedAt?: string;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number; // estimated USD
  model?: string; // which model was used
  runtime?: number; // milliseconds
  commitHash?: string; // Git commit hash for this task
  linesChanged?: {
    added: number;
    removed: number;
    total: number;
  };
  estimatedHumanMinutes?: number; // Auto-calculated from lines changed
  humanCost?: number; // Auto-calculated cost
}

export async function fetchTasks(): Promise<Task[]> {
  try {
    const res = await fetch(`${API_BASE}/tasks`);
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
  status?: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
}

export async function createTask(params: CreateTaskParams): Promise<{ success: boolean; task?: Task; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/tasks`, {
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
  agentId?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  status?: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
  estimatedHumanMinutes?: number;
  humanHourlyRate?: number;
  complexity?: 'simple' | 'medium' | 'complex';
}

export async function updateTask(id: string, params: UpdateTaskParams): Promise<{ success: boolean; task?: Task; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
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
    const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
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

// Settings
export interface Settings {
  humanHourlyRate: number;
}

export async function fetchSettings(): Promise<Settings> {
  try {
    const res = await fetch(`${API_BASE}/settings`);
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

// Generic API helper for custom endpoints
export const api = {
  get: async (path: string) => {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  post: async (path: string, body: any) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
};
