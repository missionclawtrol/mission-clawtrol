import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  projectId: string;
  agentId: string | null;
  sessionKey: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  handoffNotes: string | null;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number; // estimated USD
  model?: string; // which model was used
  runtime?: number; // milliseconds
  estimatedHumanMinutes?: number; // How long would this take a human dev?
  humanHourlyRate?: number; // Override rate for this task (optional)
  complexity?: 'simple' | 'medium' | 'complex'; // Task complexity
}

const TASKS_FILE = join(process.env.HOME || '', '.openclaw/tasks.json');

/**
 * Load all tasks from the tasks.json file
 */
export async function loadTasks(): Promise<Task[]> {
  try {
    const data = await readFile(TASKS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    // File doesn't exist yet or is empty
    return [];
  }
}

/**
 * Save tasks to the tasks.json file
 */
async function saveTasks(tasks: Task[]): Promise<void> {
  try {
    // Ensure the .openclaw directory exists
    await mkdir(join(process.env.HOME || '', '.openclaw'), { recursive: true });
    await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2));
  } catch (error) {
    console.error('Failed to save tasks:', error);
    throw error;
  }
}

/**
 * Get a single task by ID
 */
export async function getTask(id: string): Promise<Task | null> {
  const tasks = await loadTasks();
  return tasks.find(t => t.id === id) || null;
}

/**
 * Create a new task
 */
export async function createTask(
  data: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>
): Promise<Task> {
  const tasks = await loadTasks();
  
  const task: Task = {
    ...data,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
  
  tasks.push(task);
  await saveTasks(tasks);
  return task;
}

/**
 * Update a task (partial update)
 */
export async function updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
  const tasks = await loadTasks();
  const index = tasks.findIndex(t => t.id === id);
  
  if (index === -1) {
    return null;
  }
  
  const task = tasks[index];
  const updated: Task = {
    ...task,
    ...updates,
    id: task.id, // Ensure ID doesn't change
    createdAt: task.createdAt, // Ensure createdAt doesn't change
    updatedAt: new Date().toISOString(), // Always update the timestamp
  };
  
  // If status changed to 'done', set completedAt
  if (updates.status === 'done' && task.status !== 'done') {
    updated.completedAt = new Date().toISOString();
  }
  
  tasks[index] = updated;
  await saveTasks(tasks);
  return updated;
}

/**
 * Delete a task
 */
export async function deleteTask(id: string): Promise<boolean> {
  const tasks = await loadTasks();
  const index = tasks.findIndex(t => t.id === id);
  
  if (index === -1) {
    return false;
  }
  
  tasks.splice(index, 1);
  await saveTasks(tasks);
  return true;
}

/**
 * Get tasks filtered by project ID
 */
export async function getTasksByProject(projectId: string): Promise<Task[]> {
  const tasks = await loadTasks();
  return tasks.filter(t => t.projectId === projectId);
}

/**
 * Get tasks assigned to an agent
 */
export async function getTasksByAgent(agentId: string): Promise<Task[]> {
  const tasks = await loadTasks();
  return tasks.filter(t => t.agentId === agentId);
}

/**
 * Get tasks by status
 */
export async function getTasksByStatus(status: Task['status']): Promise<Task[]> {
  const tasks = await loadTasks();
  return tasks.filter(t => t.status === status);
}

/**
 * Get task statistics for a project
 */
export async function getProjectTaskStats(projectId: string): Promise<{
  total: number;
  byStatus: Record<string, number>;
  completionPercent: number;
}> {
  const tasks = await getTasksByProject(projectId);
  
  // Count total tasks
  const total = tasks.length;
  
  // Count by status
  const byStatus: Record<string, number> = {};
  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
  }
  
  // Calculate completion percentage
  const completedCount = tasks.filter(t => t.status === 'done').length;
  const completionPercent = total === 0 ? 0 : Math.round((completedCount / total) * 100);
  
  return {
    total,
    byStatus,
    completionPercent,
  };
}

/**
 * Find task by session key (used to link subagent tasks)
 */
export async function findTaskBySessionKey(sessionKey: string): Promise<Task | null> {
  const tasks = await loadTasks();
  return tasks.find(t => t.sessionKey === sessionKey) || null;
}
