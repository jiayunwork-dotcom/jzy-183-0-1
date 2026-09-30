import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './db/migrate.js';
import { holesRoutes } from './routes/holes.routes.js';
import { probesRoutes } from './routes/probes.routes.js';
import { measurementsRoutes } from './routes/measurements.routes.js';
import { queryRoutes } from './routes/query.routes.js';
import { ValidationError } from './validation/validate.js';
import { ConflictError } from './services/recompute.service.js';
import { UnknownCalibrationError } from './calc/calibration.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function buildServer() {
  const app = Fastify({ logger: { transport: undefined } });
  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) {
      return reply.code(400).send({ error: 'ValidationError', message: err.message, fields: err.errors });
    }
    if (err instanceof ConflictError) {
      return reply.code(409).send({ error: 'ConflictError', field: err.field, message: err.message });
    }
    if (err instanceof UnknownCalibrationError) {
      return reply.code(400).send({
        error: 'UnknownCalibrationError',
        message: err.message,
        fields: [{ field: 'calibration', message: err.message }],
      });
    }
    if ((err as { code?: string }).code === '23505') {
      return reply.code(409).send({ error: 'UniqueViolation', message: (err as Error).message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'InternalError', message: err.message });
  });

  await app.register(holesRoutes);
  await app.register(probesRoutes);
  await app.register(measurementsRoutes);
  await app.register(queryRoutes);

  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // 前端打包产物由应用服务托管
  const distDir = process.env.FRONTEND_DIST ?? join(here, '..', 'public');
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'NotFound' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  migrate()
    .then(() => buildServer())
    .then((app) => app.listen({ host: '0.0.0.0', port }))
    .then((addr) => console.log(`inclinometer app listening on ${addr}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
