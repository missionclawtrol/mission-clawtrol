import { FastifyInstance } from 'fastify';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

// Path to OpenClaw workspace
const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');

interface Project {
  id: string;
  name: string;
  path: string;
  status?: string;
  statusMd?: string;
  updated?: string;
}

export async function projectRoutes(fastify: FastifyInstance) {
  // Get all projects (workspace folders)
  fastify.get('/', async (request, reply) => {
    try {
      const entries = await readdir(WORKSPACE_PATH, { withFileTypes: true });
      
      const projects: Project[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const projectPath = join(WORKSPACE_PATH, entry.name);
          const stats = await stat(projectPath);
          
          // Try to read STATUS.md if it exists
          let statusMd = '';
          try {
            statusMd = await readFile(join(projectPath, 'STATUS.md'), 'utf-8');
          } catch {
            // STATUS.md doesn't exist
          }
          
          projects.push({
            id: entry.name,
            name: entry.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            path: entry.name + '/',
            statusMd,
            updated: stats.mtime.toISOString(),
          });
        }
      }
      
      return { projects };
    } catch (error) {
      fastify.log.error(error);
      return { projects: [] };
    }
  });
  
  // Get single project
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const projectPath = join(WORKSPACE_PATH, id);
    
    try {
      const stats = await stat(projectPath);
      
      // Read various markdown files
      let statusMd = '', projectMd = '', handoffMd = '';
      
      try { statusMd = await readFile(join(projectPath, 'STATUS.md'), 'utf-8'); } catch {}
      try { projectMd = await readFile(join(projectPath, 'PROJECT.md'), 'utf-8'); } catch {}
      try { handoffMd = await readFile(join(projectPath, 'HANDOFF.md'), 'utf-8'); } catch {}
      
      // List files
      const files = await readdir(projectPath);
      
      return {
        id,
        name: id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        path: id + '/',
        statusMd,
        projectMd,
        handoffMd,
        files,
        updated: stats.mtime.toISOString(),
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(404).send({ error: 'Project not found' });
    }
  });
  
  // Get STATUS.md for a project
  fastify.get('/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const content = await readFile(join(WORKSPACE_PATH, id, 'STATUS.md'), 'utf-8');
      return { content };
    } catch (error) {
      return reply.status(404).send({ error: 'STATUS.md not found' });
    }
  });
  
  // Get HANDOFF.md for a project
  fastify.get('/:id/handoff', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const content = await readFile(join(WORKSPACE_PATH, id, 'HANDOFF.md'), 'utf-8');
      return { content };
    } catch (error) {
      return reply.status(404).send({ error: 'HANDOFF.md not found' });
    }
  });
}
