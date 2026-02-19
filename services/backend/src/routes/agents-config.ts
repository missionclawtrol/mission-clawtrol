import { FastifyInstance } from 'fastify';
import { gatewayClient } from '../gateway-client.js';

export async function agentsConfigRoutes(fastify: FastifyInstance) {

  // GET /api/agents-config — list all agents
  fastify.get('/', async (req, reply) => {
    const agents = await gatewayClient.getAgentsList();
    return { agents };
  });

  // POST /api/agents-config — create agent
  fastify.post('/', async (req, reply) => {
    const { id, name, model, workspace } = req.body as any;
    if (!id || !model || !workspace) {
      return reply.status(400).send({ error: 'id, model, workspace required' });
    }
    await gatewayClient.createAgent({ id, name, model, workspace });
    return { ok: true };
  });

  // PATCH /api/agents-config/:id — update agent
  fastify.patch('/:id', async (req, reply) => {
    const { id } = req.params as any;
    const patch = req.body as any;
    const agents = await gatewayClient.getAgentsList();
    const existing = agents.find((a: any) => a.id === id);
    if (!existing) {
      return reply.status(404).send({ error: 'Agent not found' });
    }
    const updated = { ...existing, ...patch };
    const newList = agents.map((a: any) => (a.id === id ? updated : a));
    // Write the full list directly (bypass patchConfig merge logic)
    const config = await gatewayClient.getConfig();
    config.agents.list = newList;
    const { writeFile } = await import('fs/promises');
    const { join } = await import('path');
    const configPath = join(process.env.HOME || '', '.openclaw', 'openclaw.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { ok: true };
  });

  // DELETE /api/agents-config/:id — delete agent
  fastify.delete('/:id', async (req, reply) => {
    const { id } = req.params as any;
    await gatewayClient.deleteAgent(id);
    return { ok: true };
  });
}
