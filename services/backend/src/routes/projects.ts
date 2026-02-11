import { FastifyInstance } from 'fastify';
import { readFile, readdir, stat, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { logProjectEvent } from './activity.js';

// Path to OpenClaw workspace
const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');

// Template for new projects
const PROJECT_TEMPLATE = (name: string, description: string) => `# ${name}

${description}

## Overview

*Add project overview here.*

## Goals

- [ ] Define goals

## Notes

*Working notes and decisions.*
`;

const STATUS_TEMPLATE = (name: string) => `# Status

**Last Updated:** ${new Date().toISOString().split('T')[0]}

## Current Phase

Phase 1: Setup

## Progress

- [ ] Project created
- [ ] Goals defined
- [ ] Implementation started

## Next Steps

1. Define project scope
2. Assign agents
3. Begin work

## Blockers

None yet.
`;

const HANDOFF_TEMPLATE = (name: string) => `# Handoff - ${name}

## Context for New Agents

This document provides context for agents joining this project.

## Key Files

- \`PROJECT.md\` - Project overview and goals
- \`STATUS.md\` - Current progress and blockers

## Current State

*Describe what's been done and what's next.*

## Important Decisions

*List key decisions made so far.*

## Tips

*Any gotchas or tips for working on this project.*
`;

// Folders to exclude from project list
const EXCLUDED_FOLDERS = ['.git', 'node_modules', '.svelte-kit', 'dist', 'build'];

interface Project {
  id: string;
  name: string;
  path: string;
  hasStatusMd: boolean;
  hasProjectMd: boolean;
  hasHandoffMd: boolean;
  statusMd?: string;
  projectMd?: string;
  handoffMd?: string;
  files?: string[];
  updated: string;
}

function formatProjectName(folderName: string): string {
  return folderName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function projectRoutes(fastify: FastifyInstance) {
  // Get all projects (workspace folders)
  fastify.get('/', async (request, reply) => {
    try {
      const entries = await readdir(WORKSPACE_PATH, { withFileTypes: true });
      
      const projects: Project[] = [];
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (EXCLUDED_FOLDERS.includes(entry.name)) continue;
        
        const projectPath = join(WORKSPACE_PATH, entry.name);
        const stats = await stat(projectPath);
        
        // Check for standard files
        let hasStatusMd = false;
        let hasProjectMd = false;
        let hasHandoffMd = false;
        let statusMdPreview = '';
        
        try {
          const statusContent = await readFile(join(projectPath, 'STATUS.md'), 'utf-8');
          hasStatusMd = true;
          // Get first 500 chars as preview
          statusMdPreview = statusContent.slice(0, 500);
        } catch {}
        
        try {
          await stat(join(projectPath, 'PROJECT.md'));
          hasProjectMd = true;
        } catch {}
        
        try {
          await stat(join(projectPath, 'HANDOFF.md'));
          hasHandoffMd = true;
        } catch {}
        
        projects.push({
          id: entry.name,
          name: formatProjectName(entry.name),
          path: entry.name + '/',
          hasStatusMd,
          hasProjectMd,
          hasHandoffMd,
          statusMd: statusMdPreview,
          updated: stats.mtime.toISOString(),
        });
      }
      
      // Sort by last modified
      projects.sort((a, b) => {
        return new Date(b.updated).getTime() - new Date(a.updated).getTime();
      });
      
      return { projects };
    } catch (error) {
      fastify.log.error(error);
      return { projects: [], error: 'Failed to read workspace' };
    }
  });
  
  // Get single project with full details
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const projectPath = join(WORKSPACE_PATH, id);
    
    try {
      const stats = await stat(projectPath);
      
      // Read markdown files
      let statusMd = '', projectMd = '', handoffMd = '';
      
      try { statusMd = await readFile(join(projectPath, 'STATUS.md'), 'utf-8'); } catch {}
      try { projectMd = await readFile(join(projectPath, 'PROJECT.md'), 'utf-8'); } catch {}
      try { handoffMd = await readFile(join(projectPath, 'HANDOFF.md'), 'utf-8'); } catch {}
      
      // List files (non-recursive, exclude hidden and node_modules)
      const allFiles = await readdir(projectPath);
      const files = allFiles.filter(f => !f.startsWith('.') && f !== 'node_modules');
      
      return {
        id,
        name: formatProjectName(id),
        path: id + '/',
        hasStatusMd: !!statusMd,
        hasProjectMd: !!projectMd,
        hasHandoffMd: !!handoffMd,
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
  
  // Get STATUS.md content
  fastify.get('/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const content = await readFile(join(WORKSPACE_PATH, id, 'STATUS.md'), 'utf-8');
      return { content };
    } catch (error) {
      return reply.status(404).send({ error: 'STATUS.md not found' });
    }
  });
  
  // Get HANDOFF.md content
  fastify.get('/:id/handoff', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const content = await readFile(join(WORKSPACE_PATH, id, 'HANDOFF.md'), 'utf-8');
      return { content };
    } catch (error) {
      return reply.status(404).send({ error: 'HANDOFF.md not found' });
    }
  });
  
  // Get PROJECT.md content
  fastify.get('/:id/project', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const content = await readFile(join(WORKSPACE_PATH, id, 'PROJECT.md'), 'utf-8');
      return { content };
    } catch (error) {
      return reply.status(404).send({ error: 'PROJECT.md not found' });
    }
  });

  // Create a new project
  fastify.post<{
    Body: { name: string; description?: string };
  }>('/', async (request, reply) => {
    const { name, description = '' } = request.body;

    if (!name || typeof name !== 'string') {
      return reply.status(400).send({ error: 'Project name is required' });
    }

    // Convert name to folder-safe id
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (!id) {
      return reply.status(400).send({ error: 'Invalid project name' });
    }

    const projectPath = join(WORKSPACE_PATH, id);

    // Check if already exists
    try {
      await stat(projectPath);
      return reply.status(409).send({ error: 'Project already exists' });
    } catch {
      // Good - doesn't exist
    }

    try {
      // Create directory
      await mkdir(projectPath, { recursive: true });

      // Create standard files
      await writeFile(join(projectPath, 'PROJECT.md'), PROJECT_TEMPLATE(name, description));
      await writeFile(join(projectPath, 'STATUS.md'), STATUS_TEMPLATE(name));
      await writeFile(join(projectPath, 'HANDOFF.md'), HANDOFF_TEMPLATE(name));

      // Log to activity feed
      logProjectEvent({ action: 'created', projectName: name });

      return {
        success: true,
        project: {
          id,
          name,
          path: id + '/',
          hasStatusMd: true,
          hasProjectMd: true,
          hasHandoffMd: true,
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to create project' });
    }
  });

  // Delete a project (move to trash)
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const projectPath = join(WORKSPACE_PATH, id);
    const trashPath = join(WORKSPACE_PATH, '.trash', id + '-' + Date.now());

    try {
      await stat(projectPath);
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      // Move to trash instead of deleting
      await mkdir(join(WORKSPACE_PATH, '.trash'), { recursive: true });
      const { rename } = await import('fs/promises');
      await rename(projectPath, trashPath);

      // Log to activity feed
      logProjectEvent({ action: 'deleted', projectName: id });

      return { success: true, trashedTo: trashPath };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to delete project' });
    }
  });
}
