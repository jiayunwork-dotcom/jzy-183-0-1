import type { FastifyInstance } from 'fastify';
import { ValidationError } from '../validation/validate.js';
import * as holesSvc from '../services/holes.service.js';

export async function holesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/holes', async () => holesSvc.listHoles());

  app.post('/api/holes', async (req, reply) => {
    const h = await holesSvc.createHole(req.body as Parameters<typeof holesSvc.createHole>[0]);
    return reply.code(201).send(h);
  });

  app.patch('/api/holes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Parameters<typeof holesSvc.updateHoleThresholds>[1];
    const h = await holesSvc.updateHoleThresholds(Number(id), body);
    return reply.send(h);
  });

  app.get('/api/holes/:id/segments', async (req) => {
    const { id } = req.params as { id: string };
    return holesSvc.listSegments(Number(id));
  });
}

export { ValidationError };
