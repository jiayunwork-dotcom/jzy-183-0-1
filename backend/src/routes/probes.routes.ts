import type { FastifyInstance } from 'fastify';
import * as probesSvc from '../services/probes.service.js';

export async function probesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/probes', async () => probesSvc.listProbes());

  app.post('/api/probes', async (req, reply) => {
    const body = req.body as { code?: string; note?: string | null };
    const p = await probesSvc.createProbe(body.code ?? '', body.note ?? null);
    return reply.code(201).send(p);
  });

  app.post('/api/calibrations', async (req, reply) => {
    const cal = await probesSvc.addCalibration(
      req.body as Parameters<typeof probesSvc.addCalibration>[0],
    );
    return reply.code(201).send(cal);
  });
}
