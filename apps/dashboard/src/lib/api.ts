// API client for Mission Clawtrol backend

const API_BASE = 'http://localhost:3001/api';

export interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'error' | 'offline';
  role?: string;
  task?: string;
  lastActive?: string;
  model?: string;
  tokens?: number;
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
  type: 'message' | 'status' | 'file' | 'approval' | 'task';
  agent?: string;
  from?: string;
  to?: string;
  message?: string;
}

// Agents
export async function fetchAgents(): Promise<Agent[]> {
  try {
    const res = await fetch(`${API_BASE}/agents`);
    const data = await res.json();
    return data.agents || [];
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
