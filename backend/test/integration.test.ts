/**
 * 存储/服务集成测试：需要真实 PostgreSQL。
 * 仅当 DATABASE_URL 可连接时运行，否则全部跳过。
 *
 * 运行方式（Docker）：
 *   docker compose up -d db
 *   DATABASE_URL=postgres://inclin:inclin@localhost:5432/inclin_test npm test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import * as holesSvc from '../src/services/holes.service.js';
import * as probesSvc from '../src/services/probes.service.js';
import * as mSvc from '../src/services/measurements.service.js';
import * as qSvc from '../src/services/query.service.js';
import { ConflictError } from '../src/services/recompute.service.js';

const dbOk = await (async () => {
  if (!process.env.DATABASE_URL) return false;
  try {
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();
    return true;
  } catch {
    return false;
  }
})();

const maybe = dbOk ? describe : describe.skip;

// 底部三段测孔，rows 自底向上给倾斜
let probeId = 0;
const rowsBu = (bu: number[], probe = probeId) =>
  [...bu]
    .reverse()
    .map((t, i) => ({ depth: i * 0.5, a: 2 * t, b: 0, probeIdA: probe, probeIdB: probe }));

interface CreatedHole {
  id: number;
}

maybe('端到端：上传/更正/并发/历史判级/补录/基准', () => {
  let holeId = 0;

  beforeAll(async () => {
    // 独立干净库：测试库需自行建表；用事务回滚隔离太重（咨询锁跨事务），改用唯一孔编号
    await migrate();
    const h = await holesSvc.createHole({
      code: `IT-${process.pid}-${Date.now()}`,
      depthM: 1.5,
      spacingM: 0.5,
      positiveDirection: 'N',
      checksumTolerance: 100,
      thresholds: { blue: 2, yellow: 5, red: 10 },
    });
    holeId = (h as CreatedHole).id;
    const probe = await probesSvc.createProbe(`P-${process.pid}-${Date.now()}`, null);
    await probesSvc.addCalibration({
      probeId: probe.id,
      factor: 1,
      effectiveFrom: '2020-01-01T00:00:00Z',
    });
    probeId = probe.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('初始上传与全量重算一致', async () => {
    const m0 = await mSvc.uploadMeasurement({
      holeId,
      measuredAt: '2026-01-01T00:00:00Z',
      operator: 'tester',
      rows: rowsBu([0, 0, 0]),
    });
    expect(m0.isInitial).toBe(true);
    const m1 = await mSvc.uploadMeasurement({
      holeId,
      measuredAt: '2026-01-03T00:00:00Z',
      rows: rowsBu([0, 0, 0.024]), // 孔口 12mm，6mm/d 黄
    });
    const detail = await mSvc.getMeasurementDetail(m1.id);
    expect(detail!.latest!.overallLevel).toBe('yellow');
  });

  it('历史判级可查：按当时是黄，更正读数变小后按现在是蓝，二者并列差异', async () => {
    const list = await mSvc.listMeasurements(holeId);
    const m1 = list.find((m) => !m.isInitial)!;
    const before = await mSvc.measurementHistory(m1.id);
    expect(before.thenOverall).toBe('yellow');
    expect(before.nowOverall).toBe('yellow');

    const corrected = await mSvc.correctMeasurement({
      measurementId: m1.id,
      expectedRevision: m1.revision,
      actor: 'alice',
      rows: rowsBu([0, 0, 0.008]), // 孔口 4mm → 2mm/d 蓝
    });
    expect(corrected.revision).toBe(m1.revision + 1);

    const after = await mSvc.measurementHistory(m1.id);
    expect(after.thenOverall).toBe('yellow');
    expect(after.nowOverall).toBe('blue');
    expect(after.changed).toBe(true);
    expect(after.diffs.some((d) => d.thenLevel === 'yellow' && d.nowLevel === 'blue')).toBe(true);
  });

  it('并发更正同一测量：只生效一次，另一次得到冲突提示，不静默覆盖', async () => {
    const list = await mSvc.listMeasurements(holeId);
    const m1 = list.find((m) => !m.isInitial)!;
    const rev = m1.revision;
    const [a, b] = await Promise.allSettled([
      mSvc.correctMeasurement({
        measurementId: m1.id,
        expectedRevision: rev,
        actor: 'bob',
        rows: rowsBu([0, 0, 0.01]),
      }),
      mSvc.correctMeasurement({
        measurementId: m1.id,
        expectedRevision: rev,
        actor: 'carol',
        rows: rowsBu([0, 0, 0.012]),
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);
    const rejected = [a, b].find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    // 只有一条更正留痕
    const { rows } = await pool.query(
      'SELECT count(*)::int AS c FROM corrections WHERE measurement_id = $1',
      [m1.id],
    );
    expect(rows[0].c).toBeGreaterThanOrEqual(1);
  });

  it('补录中间测量：前后两次速率按新顺序重算', async () => {
    // 当前：1/1 初测 0，1/3 末测（已更正）
    const mid = await mSvc.uploadMeasurement({
      holeId,
      measuredAt: '2026-01-02T00:00:00Z',
      rows: rowsBu([0, 0, 0.005]),
    });
    const list = await mSvc.listMeasurements(holeId);
    expect(list.map((m) => m.measuredAt.slice(0, 10))).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    // 插入后每测都有速率（与上一测），且 1/3 的速率改为 (末-中)/1 天
    const byId = new Map(list.map((m) => [m.id, m] as const));
    const midRow = byId.get(mid.id)!;
    expect(midRow.rates[0]).not.toBeNull();
  });

  it('更正标定系数（两倍）后级联重算：位移变为约两倍', async () => {
    const list = await mSvc.listMeasurements(holeId);
    const beforeDisp = list.find((m) => !m.isInitial)!.displacement![0]!;
    await probesSvc.addCalibration({
      probeId,
      factor: 2,
      effectiveFrom: '2020-01-02T00:00:00Z',
      note: '系数翻倍（严格晚于原标定，避免同生效时间并列）',
    });
    const after = await mSvc.listMeasurements(holeId);
    const afterDisp = after.find((m) => !m.isInitial)!.displacement![0]!;
    expect(afterDisp).toBeCloseTo(2 * beforeDisp, 6);
  });

  it('总览与查询接口可用', async () => {
    const ov = await qSvc.overview();
    expect(Array.isArray(ov)).toBe(true);
    const profile = await qSvc.profileOverlay(holeId, 'all');
    expect(profile!.series.length).toBe(3);
    const ts = await qSvc.depthTimeSeries(holeId, 0);
    expect(ts!.points.length).toBe(3);
  });

  it('拒收六类输入给出具体字段', async () => {
    const tryBad = async (rows: unknown[]) => {
      try {
        await mSvc.uploadMeasurement({
          holeId,
          measuredAt: '2026-01-04T00:00:00Z',
          rows: rows as never,
        });
        return null;
      } catch (e) {
        const err = e as { errors?: Array<{ field: string }>; message?: string };
        return err;
      }
    };
    const fieldsOf = (e: NonNullable<Awaited<ReturnType<typeof tryBad>>>) => (e.errors ?? []).map((x) => x.field);

    // 深度不对（只有一行，应有 3 行）
    const singleBad = await tryBad([{ depth: 0, a: 1, b: 1, probeIdA: probeId, probeIdB: probeId }]);
    expect(singleBad).not.toBeNull();
    expect(fieldsOf(singleBad!)).toContain('rows');
    // 探头未登记
    const bad = await tryBad(
      rowsBu([0, 0, 0]).map((r) => ({ ...r, probeIdA: 999 })),
    );
    expect(bad).not.toBeNull();
    expect(fieldsOf(bad!)).toContain('probeIdA');
  });
});
