/**
 * Audit Store - Manages audit log entries
 */

import { randomUUID } from 'crypto';
import { db } from './db/index.js';

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string | null;
  createdAt: string;
}

export interface AuditLogParams {
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface AuditLogFilters {
  entityType?: string;
  entityId?: string;
  userId?: string;
  limit?: number;
}

/**
 * Log an audit entry
 */
export async function logAudit(params: AuditLogParams): Promise<AuditEntry> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  
  // Convert details object to JSON string
  const detailsStr = params.details ? JSON.stringify(params.details) : null;

  await db.execute(
    `INSERT INTO audit_log (id, userId, action, entityType, entityId, details, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.userId ?? null,
      params.action,
      params.entityType ?? null,
      params.entityId ?? null,
      detailsStr,
      createdAt,
    ]
  );

  return {
    id,
    userId: params.userId ?? null,
    action: params.action,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    details: detailsStr,
    createdAt,
  };
}

/**
 * Get audit log entries with optional filters
 */
export async function getAuditLog(filters?: AuditLogFilters): Promise<AuditEntry[]> {
  const limit = filters?.limit ?? 100;
  
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params: (string | number)[] = [];

  if (filters?.entityType) {
    sql += ' AND entityType = ?';
    params.push(filters.entityType);
  }

  if (filters?.entityId) {
    sql += ' AND entityId = ?';
    params.push(filters.entityId);
  }

  if (filters?.userId) {
    sql += ' AND userId = ?';
    params.push(filters.userId);
  }

  sql += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(limit);

  const rows = await db.query<AuditEntry>(sql, params);
  
  // Parse details JSON string back to object
  return rows.map(row => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null,
  }));
}
