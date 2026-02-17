// WebSocket integration for task notifications
import { wsMessages } from '$lib/websocket';
import { toasts } from '$lib/stores/toasts';
import { get } from 'svelte/store';

interface TaskEventPayload {
  task?: {
    id: string;
    title: string;
    status: string;
    priority: string;
    agentId?: string;
    assignedTo?: string;
  };
  updates?: {
    status?: string;
    assignedTo?: string;
  };
  oldTask?: {
    status?: string;
    assignedTo?: string;
  };
  taskId?: string;
  actor: string;
}

let lastProcessedTimestamp = 0;
let taskUpdateCallback: (() => void) | null = null;

// Set callback for when tasks are updated (to refresh task list)
export function onTaskUpdate(callback: () => void) {
  taskUpdateCallback = callback;
}

// Get current user ID from session (if available)
let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null) {
  currentUserId = userId;
}

// Process WebSocket messages and create toast notifications
export function initTaskWebSocket() {
  wsMessages.subscribe((messages) => {
    if (messages.length === 0) return;

    // Process only new messages (avoid duplicates on reconnect)
    const newMessages = messages.filter(
      (msg) => msg.timestamp && new Date(msg.timestamp).getTime() > lastProcessedTimestamp
    );

    if (newMessages.length > 0) {
      lastProcessedTimestamp = new Date(newMessages[0].timestamp).getTime();
    }

    for (const message of newMessages) {
      handleTaskEvent(message);
    }
  });
}

function handleTaskEvent(message: any) {
  const { type, payload } = message;

  // Only handle task events
  if (!type || !type.startsWith('task.')) return;

  const data = payload as TaskEventPayload;

  switch (type) {
    case 'task.created':
      handleTaskCreated(data);
      break;
    case 'task.updated':
      handleTaskUpdated(data);
      break;
    case 'task.deleted':
      handleTaskDeleted(data);
      break;
  }

  // Trigger task list refresh
  if (taskUpdateCallback) {
    taskUpdateCallback();
  }
}

function handleTaskCreated(data: TaskEventPayload) {
  const { task, actor } = data;
  if (!task) return;

  toasts.add({
    message: `New task created: "${task.title}" by ${actor}`,
    type: 'info',
    duration: 5000,
  });
}

function handleTaskUpdated(data: TaskEventPayload) {
  const { task, updates, oldTask, actor } = data;
  if (!task) return;

  // Status change
  if (updates?.status && oldTask?.status && updates.status !== oldTask.status) {
    const statusEmoji = getStatusEmoji(updates.status);
    toasts.add({
      message: `Task "${task.title}" moved to ${updates.status} ${statusEmoji} by ${actor}`,
      type: getStatusToastType(updates.status),
      duration: 5000,
    });
    return;
  }

  // Assignment change - highlight if assigned to current user
  if (updates?.assignedTo !== undefined && updates.assignedTo !== oldTask?.assignedTo) {
    const isAssignedToMe = currentUserId && updates.assignedTo === currentUserId;
    
    if (updates.assignedTo === null) {
      toasts.add({
        message: `Task "${task.title}" unassigned by ${actor}`,
        type: 'info',
        duration: 5000,
      });
    } else if (isAssignedToMe) {
      toasts.add({
        message: `🎯 You were assigned to "${task.title}"`,
        type: 'warning', // Use warning to highlight important assignment
        duration: 7000, // Longer duration for assignments
      });
    } else {
      toasts.add({
        message: `Task "${task.title}" assigned by ${actor}`,
        type: 'info',
        duration: 5000,
      });
    }
    return;
  }

  // Generic update
  toasts.add({
    message: `Task "${task.title}" updated by ${actor}`,
    type: 'info',
    duration: 4000,
  });
}

function handleTaskDeleted(data: TaskEventPayload) {
  const { task, actor } = data;
  if (!task) return;

  toasts.add({
    message: `Task "${task.title}" deleted by ${actor}`,
    type: 'info',
    duration: 5000,
  });
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'backlog':
      return '📥';
    case 'todo':
      return '📋';
    case 'in-progress':
      return '⚙️';
    case 'review':
      return '👀';
    case 'done':
      return '✅';
    default:
      return '';
  }
}

function getStatusToastType(status: string): 'info' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'done':
      return 'success';
    case 'review':
      return 'warning';
    case 'in-progress':
      return 'info';
    default:
      return 'info';
  }
}
