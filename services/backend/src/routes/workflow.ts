import { FastifyInstance } from 'fastify';

const workflowRules = {
  sessionStart: {
    fetchContext: 'GET http://localhost:3001/api/context',
    instruction: 'On every session start, fetch /api/context to orient yourself on active projects, recent work, and blockers before doing anything else.',
  },
  taskCreationWorkflow: {
    description: 'MANDATORY steps when creating any task',
    steps: [
      'Create task in DB with status: todo',
      'Spawn the agent session',
      'Immediately update task with agentId, sessionKey, status: in-progress, and model',
      'Let the agent work',
      'Agent moves task to review when done',
    ],
    warnings: [
      'NEVER spawn an agent without linking the session to the task immediately',
      'ALWAYS include model in the in-progress PATCH',
    ],
  },
  doneCriteria: {
    description: 'ALL required to move a task from review to done',
    required: [
      'Files changed — list of files modified',
      'How tested — what testing was done (compilation, manual, curl, etc.)',
      'Edge cases / risks — known limitations or risks',
      'Rollback plan — how to undo the change',
      'Commit hash — git commit hash (or NO_COMMIT for non-git work)',
    ],
  },
  heartbeatChecklist: {
    description: 'Checks to perform on each heartbeat',
    steps: [
      'GET /api/tasks?status=review — check each against done criteria, move to done if met, back to in-progress if not',
      'GET /api/tasks?status=in-progress — ping assigned agents for status, note blockers',
      'Enforce WIP limit: flag any agent with more than 2 in-progress tasks',
    ],
    periodicChecks: ['email inbox', 'calendar upcoming events'],
  },
  agentGuidelines: {
    wipLimit: 2,
    delegation: {
      'senior-dev': 'Complex coding, architecture, code reviews, refactoring',
      'junior-dev': 'Routine coding, boilerplate, tests, simple scripts',
      'senior-researcher': 'Deep analysis, competitive intelligence, technical evaluations',
      'junior-researcher': 'Data gathering, quick lookups, summaries, fact-checking',
      'editor': 'Documentation, blog posts, emails, polished writing',
      'devops': 'Server configs, deployments, Docker, networking',
      'security': 'Code security reviews, vulnerability assessments',
    },
    modelRecommendations: {
      note: 'Delegate to cheapest capable agent. Use junior agents for routine work, senior for complex.',
    },
  },
};

const heartbeatPromptText = `Mission Clawtrol Heartbeat Checklist:

1. Check tasks in review: GET http://localhost:3001/api/tasks?status=review
   - For each: verify all 5 done criteria are in handoff notes
   - Done criteria: files changed, how tested, edge cases/risks, rollback plan, commit hash
   - If all met → PATCH status to "done"
   - If missing → PATCH status back to "in-progress" with notes

2. Check tasks in-progress: GET http://localhost:3001/api/tasks?status=in-progress
   - Flag any agent with >2 in-progress tasks (WIP limit exceeded)

3. Periodic checks (rotate): email inbox, upcoming calendar events
`;

export async function workflowRoutes(fastify: FastifyInstance) {
  // GET /api/workflow — full workflow rules as JSON
  fastify.get('/', async (_request, reply) => {
    return reply.send(workflowRules);
  });

  // GET /api/workflow/heartbeat-prompt — plain text heartbeat instructions
  fastify.get('/heartbeat-prompt', async (_request, reply) => {
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .send(heartbeatPromptText);
  });
}
