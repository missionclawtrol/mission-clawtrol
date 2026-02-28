import { FastifyInstance } from 'fastify';
import { promises as fs } from 'fs';
import { join, basename, extname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const WORKSPACE_PATH = join(process.env.HOME || '', '.openclaw/workspace');

function sanitizeId(id: string): boolean {
  return !id.includes('..') && !id.includes('/') && !id.includes('\\');
}

function safeFilename(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._\- ]/g, '_');
}

export async function projectFilesRoutes(fastify: FastifyInstance) {
  // Register multipart for file uploads (scoped to this plugin)
  await fastify.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
      files: 20,
    },
  });

  // GET /api/projects/:id/files — list files in project workspace
  fastify.get<{ Params: { id: string } }>('/:id/files', async (request, reply) => {
    const { id } = request.params;

    if (!sanitizeId(id)) {
      return reply.status(400).send({ error: 'Invalid project id' });
    }

    const projectPath = join(WORKSPACE_PATH, id);

    try {
      await fs.stat(projectPath);
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      const files: Array<{
        name: string;
        isDirectory: boolean;
        size: number;
        modified: string;
      }> = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules') continue;

        try {
          const fileStat = await fs.stat(join(projectPath, entry.name));
          files.push({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: fileStat.size,
            modified: fileStat.mtime.toISOString(),
          });
        } catch {
          // Skip unreadable entries
        }
      }

      // Directories first, then files, both alphabetical
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { projectId: id, files };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to list files' });
    }
  });

  // POST /api/projects/:id/files — upload file(s) to project workspace
  // Query param: ?extract=true  →  auto-extract uploaded ZIP files
  fastify.post<{
    Params: { id: string };
    Querystring: { extract?: string };
  }>('/:id/files', async (request, reply) => {
    const { id } = request.params;
    const shouldExtract = request.query.extract === 'true';

    if (!sanitizeId(id)) {
      return reply.status(400).send({ error: 'Invalid project id' });
    }

    const projectPath = join(WORKSPACE_PATH, id);

    try {
      await fs.stat(projectPath);
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }

    try {
      const parts = request.parts();
      const uploaded: Array<{ name: string; size: number; extracted?: boolean }> = [];

      for await (const part of parts) {
        if (part.type !== 'file') continue;

        const safeName = safeFilename(part.filename);
        if (!safeName || safeName === '_') {
          // Drain the stream to avoid leaving it hanging
          for await (const _ of part.file) { /* drain */ }
          continue;
        }

        const destPath = join(projectPath, safeName);

        // Security: ensure dest stays inside project dir
        if (!destPath.startsWith(projectPath + '/') && destPath !== projectPath) {
          for await (const _ of part.file) { /* drain */ }
          continue;
        }

        // Buffer and write the file
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        const data = Buffer.concat(chunks);

        await fs.writeFile(destPath, data);

        let extracted = false;

        // Auto-extract ZIP if requested
        if (shouldExtract && extname(safeName).toLowerCase() === '.zip') {
          try {
            await execFileAsync('unzip', ['-o', destPath, '-d', projectPath]);
            extracted = true;
          } catch (err) {
            fastify.log.warn(`ZIP extraction failed for ${safeName}: ${err}`);
          }
        }

        uploaded.push({ name: safeName, size: data.length, extracted });
      }

      if (uploaded.length === 0) {
        return reply.status(400).send({ error: 'No files uploaded' });
      }

      return { success: true, uploaded };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to upload file(s)' });
    }
  });

  // DELETE /api/projects/:id/files/:filename — delete a file from project workspace
  fastify.delete<{ Params: { id: string; filename: string } }>(
    '/:id/files/:filename',
    async (request, reply) => {
      const { id, filename } = request.params;

      if (!sanitizeId(id)) {
        return reply.status(400).send({ error: 'Invalid project id' });
      }

      const projectPath = join(WORKSPACE_PATH, id);
      const safeName = safeFilename(decodeURIComponent(filename));
      const filePath = join(projectPath, safeName);

      // Security: ensure path stays within project directory
      if (!filePath.startsWith(projectPath + '/') && filePath !== projectPath) {
        return reply.status(400).send({ error: 'Invalid filename' });
      }

      try {
        await fs.unlink(filePath);
        return { success: true, deleted: safeName };
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return reply.status(404).send({ error: 'File not found' });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Failed to delete file' });
      }
    }
  );
}
