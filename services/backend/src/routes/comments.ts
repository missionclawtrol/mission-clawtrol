/**
 * Comment Routes - Task discussion threads
 */

import { FastifyInstance } from 'fastify';
import { getCommentsByTask, createComment, updateComment, deleteComment, getComment } from '../comment-store.js';
import { findTaskById } from '../task-store.js';
import { logAudit } from '../audit-store.js';
import { dispatchWebhookEvent } from '../webhook-dispatcher.js';

export async function commentRoutes(fastify: FastifyInstance) {
  /**
   * GET /tasks/:taskId/comments - list comments for a task
   */
  fastify.get<{ Params: { taskId: string } }>(
    '/:taskId/comments',
    async (request, reply) => {
      const { taskId } = request.params;
      const task = await findTaskById(taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const comments = await getCommentsByTask(taskId);
      return { comments, count: comments.length };
    }
  );

  /**
   * POST /tasks/:taskId/comments - add a comment
   */
  fastify.post<{
    Params: { taskId: string };
    Body: { content: string };
  }>(
    '/:taskId/comments',
    async (request, reply) => {
      const { taskId } = request.params;
      const { content } = request.body;

      if (!content || !content.trim()) {
        return reply.status(400).send({ error: 'Content is required' });
      }

      const task = await findTaskById(taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      // Viewers can't comment
      const user = (request as any).user;
      if (user && user.role === 'viewer') {
        return reply.status(403).send({ error: 'Viewers cannot add comments' });
      }

      const comment = await createComment({
        taskId,
        userId: user?.id || (process.env.DISABLE_AUTH === 'true' ? 'dev-user' : null),
        userName: user?.name || user?.githubLogin || (process.env.DISABLE_AUTH === 'true' ? 'Local Developer' : null),
        userAvatar: user?.avatarUrl || null,
        content: content.trim(),
      });

      await logAudit({
        userId: user?.id,
        action: 'comment.created',
        entityType: 'task',
        entityId: taskId,
        details: { commentId: comment.id },
      });

      // Dispatch webhook event for comment added
      dispatchWebhookEvent('task.comment_added', {
        taskId,
        comment,
      }).catch(err => {
        console.error('Webhook dispatch error for task.comment_added:', err);
      });

      return reply.status(201).send(comment);
    }
  );

  /**
   * PATCH /tasks/:taskId/comments/:commentId - edit a comment
   */
  fastify.patch<{
    Params: { taskId: string; commentId: string };
    Body: { content: string };
  }>(
    '/:taskId/comments/:commentId',
    async (request, reply) => {
      const { taskId, commentId } = request.params;
      const { content } = request.body;

      if (!content || !content.trim()) {
        return reply.status(400).send({ error: 'Content is required' });
      }

      const existing = await getComment(commentId);
      if (!existing || existing.taskId !== taskId) {
        return reply.status(404).send({ error: 'Comment not found' });
      }

      // Only the author or admin can edit
      const user = (request as any).user;
      const isAuthor = user?.id === existing.userId || (process.env.DISABLE_AUTH === 'true');
      const isAdmin = user?.role === 'admin' || process.env.DISABLE_AUTH === 'true';
      if (!isAuthor && !isAdmin) {
        return reply.status(403).send({ error: 'You can only edit your own comments' });
      }

      const updated = await updateComment(commentId, content.trim());
      return updated;
    }
  );

  /**
   * DELETE /tasks/:taskId/comments/:commentId - delete a comment
   */
  fastify.delete<{
    Params: { taskId: string; commentId: string };
  }>(
    '/:taskId/comments/:commentId',
    async (request, reply) => {
      const { taskId, commentId } = request.params;

      const existing = await getComment(commentId);
      if (!existing || existing.taskId !== taskId) {
        return reply.status(404).send({ error: 'Comment not found' });
      }

      // Only the author or admin can delete
      const user = (request as any).user;
      const isAuthor = user?.id === existing.userId || (process.env.DISABLE_AUTH === 'true');
      const isAdmin = user?.role === 'admin' || process.env.DISABLE_AUTH === 'true';
      if (!isAuthor && !isAdmin) {
        return reply.status(403).send({ error: 'You can only delete your own comments' });
      }

      await deleteComment(commentId);

      await logAudit({
        userId: user?.id,
        action: 'comment.deleted',
        entityType: 'task',
        entityId: taskId,
        details: { commentId },
      });

      return { success: true };
    }
  );
}
