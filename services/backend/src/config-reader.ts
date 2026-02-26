/**
 * Read and cache OpenClaw configuration
 */
import { readFile, watch } from 'fs/promises';
import { join } from 'path';

const CONFIG_PATH = join(process.env.HOME || '', '.openclaw/openclaw.json');

export interface AgentIdentity {
  name: string;
  emoji: string;
}

export interface AgentGroupChat {
  mentionPatterns: string[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  workspace: string;
  agentDir: string;
  model: string;
  default?: boolean;
  identity: AgentIdentity;
  groupChat: AgentGroupChat;
}

export interface OpenClawConfig {
  agents: {
    defaults: {
      model: {
        primary: string;
        fallbacks: string[];
      };
      models: Record<string, { alias: string }>;
      workspace: string;
      compaction: { mode: string };
      maxConcurrent: number;
      subagents: {
        maxConcurrent: number;
        model: string;
      };
    };
    list: AgentDefinition[];
  };
  [key: string]: any;
}

let cachedConfig: OpenClawConfig | null = null;
let lastReadTime = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Read OpenClaw configuration from disk
 * Cached for 5 seconds to reduce disk I/O
 */
export async function readConfig(): Promise<OpenClawConfig> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cachedConfig && (now - lastReadTime) < CACHE_TTL) {
    return cachedConfig;
  }
  
  try {
    const data = await readFile(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(data);
    lastReadTime = now;
    return cachedConfig!;
  } catch (err) {
    console.error('[ConfigReader] Failed to read config:', err);
    throw new Error('Failed to read OpenClaw configuration');
  }
}

/**
 * Get all agent definitions
 */
export async function getAgentDefinitions(): Promise<AgentDefinition[]> {
  try {
    const config = await readConfig();
    return config.agents?.list || [];
  } catch {
    // Config not yet set up (fresh install) — return empty list gracefully
    return [];
  }
}

/**
 * Get a single agent definition by ID
 */
export async function getAgentDefinition(agentId: string): Promise<AgentDefinition | null> {
  const agents = await getAgentDefinitions();
  return agents.find(a => a.id === agentId) || null;
}

/**
 * Get the default agent (CSO)
 */
export async function getDefaultAgent(): Promise<AgentDefinition | null> {
  const agents = await getAgentDefinitions();
  return agents.find(a => a.default) || agents[0] || null;
}

/**
 * Clear the cache (useful for testing or forced reload)
 */
export function clearCache(): void {
  cachedConfig = null;
  lastReadTime = 0;
}
