import type { FastifyInstance } from 'fastify';
import { parseReadingText } from '../validation/parseText.js';
import * as mSvc from '../services/measurements.service.js';

export async function measurementsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/holes/:id/measurements', async (req) => {
    const { id } = req.params as { id: string };
    return mSvc.listMeasurements(Number(id));
  });

  app.post('/api/holes/:id/measurements', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      measuredAt?: string;
      operator?: string | null;
      note?: string | null;
      isInitial?: boolean;
      rows?: unknown[];
      /** 逐行文本/表格粘贴：给了 text 就解析成 rows（rows 优先） */
      text?: string;
      defaultProbeId?: number;
      newDatum?: { reason: 'probe_change' | 'repair' | 'reset'; note?: string | null };
    };
    let rows = body.rows;
    if (!Array.isArray(rows) && typeof body.text === 'string') {
      const parsed = parseReadingText(body.text, body.defaultProbeId);
      rows = parsed.rows;
    }
    const m = await mSvc.uploadMeasurement({
      holeId: Number(id),
      measuredAt: body.measuredAt ?? '',
      operator: body.operator ?? null,
      note: body.note ?? null,
      isInitial: body.isInitial,
      rows: (rows ?? []) as mSvc.UploadInput['rows'],
      newDatum: body.newDatum,
    });
    return reply.code(201).send(m);
  });

  app.get('/api/measurements/:id', async (req) => {
    const { id } = req.params as { id: string };
    return mSvc.getMeasurementDetail(Number(id));
  });

  app.patch('/api/measurements/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      expectedRevision?: number;
      actor?: string;
      measuredAt?: string;
      operator?: string | null;
      note?: string | null;
      rows?: unknown[];
      text?: string;
      defaultProbeId?: number;
    };
    let rows = body.rows;
    if (!Array.isArray(rows) && typeof body.text === 'string') {
      rows = parseReadingText(body.text, body.defaultProbeId).rows;
    }
    const m = await mSvc.correctMeasurement({
      measurementId: Number(id),
      expectedRevision: Number(body.expectedRevision),
      actor: body.actor ?? 'anonymous',
      measuredAt: body.measuredAt,
      operator: body.operator,
      note: body.note,
      rows: rows as mSvc.CorrectInput['rows'],
    });
    return reply.send(m);
  });

  /** 历史判级：首判 vs 现判 + 全部快照 */
  app.get('/api/measurements/:id/history', async (req) => {
    const { id } = req.params as { id: string };
    return mSvc.measurementHistory(Number(id));
  });
}
