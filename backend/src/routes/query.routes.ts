import type { FastifyInstance } from 'fastify';
import * as q from '../services/query.service.js';

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  /** 全部测孔当前预警等级总览 */
  app.get('/api/overview', async () => q.overview());

  /** 某孔任选几次测量叠加剖面；?ids=1,2,3，不给则全部 */
  app.get('/api/holes/:id/profile', async (req) => {
    const { id } = req.params as { id: string };
    const { ids } = req.query as { ids?: string };
    const measurementIds = ids
      ? ids
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n))
      : 'all';
    return q.profileOverlay(Number(id), measurementIds);
  });

  /** 某深度随时间的位移与速率 */
  app.get('/api/holes/:id/time-series', async (req) => {
    const { id } = req.params as { id: string };
    const { depth } = req.query as { depth?: string };
    return q.depthTimeSeries(Number(id), Number(depth ?? 0));
  });
}
