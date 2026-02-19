import { FastifyInstance } from 'fastify';
import { gatewayClient } from '../gateway-client.js';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';

const HOME = process.env.HOME || '';

export async function setupRoutes(fastify: FastifyInstance) {

  // GET /api/setup/status
  fastify.get('/status', async (req, reply) => {
    const agents = await gatewayClient.getAgentsList().catch(() => []);
    const agentIds = agents.map((a: any) => a.id);

    // Check workspace for projects (folders with PROJECT.md)
    const workspacePath = join(HOME, '.openclaw', 'workspace');
    let hasProjects = false;
    try {
      if (existsSync(workspacePath)) {
        const entries = readdirSync(workspacePath, { withFileTypes: true });
        hasProjects = entries
          .filter(e => e.isDirectory())
          .some(e => existsSync(join(workspacePath, e.name, 'PROJECT.md')));
      }
    } catch {
      hasProjects = false;
    }

    const qaExists = agentIds.includes('qa');
    const editorExists = agentIds.includes('editor');
    const complete = qaExists && editorExists && hasProjects;

    return {
      gatewayConnected: agents !== null,
      agents: { qa: qaExists, editor: editorExists },
      hasProjects,
      complete,
    };
  });

  // POST /api/setup/minimum-agents
  fastify.post('/minimum-agents', async (req, reply) => {
    const created: string[] = [];
    const agents = await gatewayClient.getAgentsList().catch(() => []);
    const existingIds = agents.map((a: any) => a.id);

    const agentsToCreate = [
      {
        id: 'qa',
        name: 'QA',
        model: 'anthropic/claude-haiku-4-5',
        workspace: join(HOME, '.openclaw', 'workspace-qa'),
        soul: `# QA Agent\n\nYou review completed tasks in Mission Clawtrol and verify they meet done criteria.\n\n## Your Job\nWhen given a task to review, verify ALL 5 done criteria are present in the handoff notes:\n1. Files changed\n2. How tested\n3. Edge cases / risks\n4. Rollback plan\n5. Commit hash (or NO_COMMIT)\n\nVerify the commit exists in the repo if provided. Post your review as a comment on the task via Mission Clawtrol API. Move the task to done (all pass) or back to in-progress (any fail).\n\n## Workflow Rules\nFetch from Mission Clawtrol on each session:\n\`GET http://localhost:3001/api/workflow\`\n`,
      },
      {
        id: 'editor',
        name: 'Editor',
        model: 'anthropic/claude-haiku-4-5',
        workspace: join(HOME, '.openclaw', 'workspace-editor'),
        soul: `# Editor / Docs Agent\n\nYou keep PROJECT.md files accurate and up-to-date when tasks ship.\n\n## Your Job\nWhen a task completes with a commit hash:\n1. Read the commit diff\n2. Determine if the change is user-facing (new feature, new API, architecture change)\n3. If yes: update the project PROJECT.md — one or two concise lines per change\n4. If no (bug fix, refactor, CSS, tests): skip\n5. Commit your changes\n\n## Rules\n- Only modify PROJECT.md — no other files\n- Be concise and match the existing style\n\n## Workflow Rules\n\`GET http://localhost:3001/api/workflow\`\n`,
      },
    ];

    const agentsMd = `## Mission Clawtrol\nIf Mission Clawtrol is running (http://localhost:3001), fetch workflow rules:\n\`GET http://localhost:3001/api/workflow\`\nFollow them exactly.\n`;

    for (const agent of agentsToCreate) {
      if (!existingIds.includes(agent.id)) {
        // Create workspace
        if (!existsSync(agent.workspace)) {
          mkdirSync(agent.workspace, { recursive: true });
        }
        // Write SOUL.md
        writeFileSync(join(agent.workspace, 'SOUL.md'), agent.soul);
        // Write AGENTS.md
        writeFileSync(join(agent.workspace, 'AGENTS.md'), agentsMd);
        // Register in OpenClaw config
        await gatewayClient.createAgent({
          id: agent.id,
          name: agent.name,
          model: agent.model,
          workspace: agent.workspace,
        });
        created.push(agent.id);
      }
    }

    return { created };
  });

  // POST /api/setup/first-project
  fastify.post('/first-project', async (req, reply) => {
    const projectDir = join(HOME, '.openclaw', 'workspace', 'my-first-project');
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }
    const projectMdPath = join(projectDir, 'PROJECT.md');
    if (!existsSync(projectMdPath)) {
      writeFileSync(
        projectMdPath,
        `# My First Project\n\n**Repo:** https://github.com/your-org/your-repo\n\n## Overview\nDescribe your project here.\n\n## Goals\n- What are you building?\n- Who does it serve?\n`,
      );
    }
    return { created: true, projectId: 'my-first-project' };
  });
}
