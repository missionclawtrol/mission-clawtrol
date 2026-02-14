/**
 * Parse AGENTS.md files in project directories
 * Format documented in multi-agent-spec.md
 */
import { readFile } from 'fs/promises';

export interface ProjectAgent {
  agentId: string;
  emoji: string;
  name: string;
  session?: string;
  task: string;
  since?: string;
  status: 'working' | 'idle' | 'completed';
  completed?: string;
}

export interface ParsedAgentsMd {
  active: ProjectAgent[];
  completed: ProjectAgent[];
}

/**
 * Parse an AGENTS.md file
 * Returns active and completed agent lists
 */
export async function parseAgentsMd(filePath: string): Promise<ParsedAgentsMd> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseAgentsMdContent(content);
  } catch (err) {
    // File doesn't exist or can't be read
    return { active: [], completed: [] };
  }
}

/**
 * Parse AGENTS.md content from a string
 */
export function parseAgentsMdContent(content: string): ParsedAgentsMd {
  const active: ProjectAgent[] = [];
  const completed: ProjectAgent[] = [];
  
  const lines = content.split('\n');
  let currentSection: 'active' | 'completed' | null = null;
  let currentAgent: Partial<ProjectAgent> | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Section headers
    if (line === '## Active') {
      // Save previous agent before changing sections
      if (currentAgent && currentAgent.agentId && currentAgent.task && currentSection) {
        const target = currentSection === 'active' ? active : completed;
        const agent = { ...currentAgent } as ProjectAgent;
        if (!agent.status) {
          agent.status = currentSection === 'active' ? 'working' : 'completed';
        }
        target.push(agent);
      }
      currentSection = 'active';
      currentAgent = null;
      continue;
    }
    
    if (line === '## Completed') {
      // Save previous agent before changing sections
      if (currentAgent && currentAgent.agentId && currentAgent.task && currentSection) {
        const target = currentSection === 'active' ? active : completed;
        const agent = { ...currentAgent } as ProjectAgent;
        if (!agent.status) {
          agent.status = currentSection === 'active' ? 'working' : 'completed';
        }
        target.push(agent);
      }
      currentSection = 'completed';
      currentAgent = null;
      continue;
    }
    
    // Agent header (### emoji name)
    // Note: Use [^\s]+ instead of [\p{Emoji}] to handle compound emojis like 👨‍💻
    const agentHeaderMatch = line.match(/^###\s+([^\s]+)\s+(.+)$/);
    if (agentHeaderMatch && currentSection) {
      // Save previous agent if any
      if (currentAgent && currentAgent.agentId && currentAgent.task) {
        const target = currentSection === 'active' ? active : completed;
        const agent = { ...currentAgent } as ProjectAgent;
        if (!agent.status) {
          agent.status = currentSection === 'active' ? 'working' : 'completed';
        }
        target.push(agent);
      }
      
      // Start new agent
      currentAgent = {
        emoji: agentHeaderMatch[1],
        name: agentHeaderMatch[2],
      };
      continue;
    }
    
    // Field lines (- **Field:** value)
    if (currentAgent && line.startsWith('- **')) {
      const fieldMatch = line.match(/^- \*\*(.+?):\*\*\s*(.+)$/);
      if (fieldMatch) {
        const [, fieldName, value] = fieldMatch;
        
        switch (fieldName) {
          case 'Agent ID':
            currentAgent.agentId = value;
            break;
          case 'Session':
            currentAgent.session = value;
            break;
          case 'Task':
            currentAgent.task = value;
            break;
          case 'Since':
            currentAgent.since = value;
            break;
          case 'Status':
            if (value === 'working' || value === 'idle' || value === 'completed') {
              currentAgent.status = value;
            }
            break;
          case 'Completed':
            currentAgent.completed = value;
            break;
        }
      }
    }
  }
  
  // Save last agent
  if (currentAgent && currentAgent.agentId && currentAgent.task && currentSection) {
    const target = currentSection === 'active' ? active : completed;
    const agent = { ...currentAgent } as ProjectAgent;
    if (!agent.status) {
      agent.status = currentSection === 'active' ? 'working' : 'completed';
    }
    target.push(agent);
  }
  
  return { active, completed };
}

/**
 * Generate AGENTS.md content from structured data
 * Useful for agents that want to check in/out
 */
export function generateAgentsMd(data: ParsedAgentsMd): string {
  let content = '# Project Agents\n\n';
  content += 'Agents currently working on this project. Updated by agents when they check in/out.\n\n';
  
  // Active section
  content += '## Active\n\n';
  for (const agent of data.active) {
    content += `### ${agent.emoji} ${agent.name}\n`;
    content += `- **Agent ID:** ${agent.agentId}\n`;
    if (agent.session) {
      content += `- **Session:** ${agent.session}\n`;
    }
    content += `- **Task:** ${agent.task}\n`;
    if (agent.since) {
      content += `- **Since:** ${agent.since}\n`;
    }
    content += `- **Status:** ${agent.status}\n\n`;
  }
  
  // Completed section
  if (data.completed.length > 0) {
    content += '## Completed\n\n';
    for (const agent of data.completed) {
      content += `### ${agent.emoji} ${agent.name}\n`;
      content += `- **Agent ID:** ${agent.agentId}\n`;
      content += `- **Task:** ${agent.task}\n`;
      if (agent.completed) {
        content += `- **Completed:** ${agent.completed}\n`;
      }
      content += '\n';
    }
  }
  
  return content;
}
