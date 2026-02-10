/**
 * Track agent-to-project associations
 * Persisted to a JSON file so it survives restarts
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

const DATA_DIR = join(process.env.HOME || '', '.openclaw/workspace/mission-clawtrol/data');
const ASSOCIATIONS_FILE = join(DATA_DIR, 'project-agents.json');

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

let associations: AgentAssociation[] = [];

// Load associations from disk
export async function loadAssociations(): Promise<void> {
  try {
    const data = await readFile(ASSOCIATIONS_FILE, 'utf-8');
    associations = JSON.parse(data);
    console.log(`[ProjectAgents] Loaded ${associations.length} associations`);
  } catch (err) {
    // File doesn't exist yet, start fresh
    associations = [];
  }
}

// Save associations to disk
async function saveAssociations(): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ASSOCIATIONS_FILE, JSON.stringify(associations, null, 2));
  } catch (err) {
    console.error('[ProjectAgents] Failed to save associations:', err);
  }
}

// Add a new association
export async function addAssociation(assoc: Omit<AgentAssociation, 'status' | 'spawnedAt'>): Promise<void> {
  // Check if already exists
  const existing = associations.find(a => a.sessionKey === assoc.sessionKey);
  if (existing) {
    return;
  }

  associations.push({
    ...assoc,
    status: 'running',
    spawnedAt: Date.now(),
  });
  await saveAssociations();
}

// Update an association's status
export async function updateAssociation(
  sessionKey: string,
  update: Partial<Pick<AgentAssociation, 'status' | 'completedAt' | 'result'>>
): Promise<void> {
  const assoc = associations.find(a => a.sessionKey === sessionKey);
  if (assoc) {
    Object.assign(assoc, update);
    await saveAssociations();
  }
}

// Get all associations for a project
export function getProjectAgents(projectId: string): AgentAssociation[] {
  return associations
    .filter(a => a.projectId === projectId)
    .sort((a, b) => b.spawnedAt - a.spawnedAt);
}

// Get all associations
export function getAllAssociations(): AgentAssociation[] {
  return [...associations].sort((a, b) => b.spawnedAt - a.spawnedAt);
}

// Get association by session key
export function getAssociation(sessionKey: string): AgentAssociation | undefined {
  return associations.find(a => a.sessionKey === sessionKey);
}

// Clean up old completed/failed associations (keep last 50)
export async function cleanupOldAssociations(): Promise<void> {
  const running = associations.filter(a => a.status === 'running');
  const completed = associations
    .filter(a => a.status !== 'running')
    .sort((a, b) => b.spawnedAt - a.spawnedAt)
    .slice(0, 50);
  
  associations = [...running, ...completed];
  await saveAssociations();
}
