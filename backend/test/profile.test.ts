import { describe, expect, it } from 'vitest';
import { computeHole } from '../src/calc/profile.js';
import type { CalibEntry } from '../src/calc/calibration.js';
import type { DatumSegment, Measurement, ReadingRow } from '../src/models/types.js';

const PROBE = 1;
const calibs: CalibEntry[] = [{ probeId: PROBE, factor: 1, effectiveFrom: '2020-01-01T00:00:00Z' }];
const thresholds = { blue: 2, yellow: 5, red: 10 };
const cfg = { depthM: 1.5, spacingM: 0.5, thresholds, checksumTolerance: 1e6 };

/** 入参按「从孔底往上」的测段顺序给倾斜正弦（与需求算例同口径），内部反转为按深度自上而下的行 */
function rowsFromTilts(bottomUp: number[], factor = 1): ReadingRow[] {
  return [...bottomUp].reverse().map((t, i) => ({
    depth: i * 0.5,
    a: (2 * t) / factor,
    b: 0,
    probeIdA: PROBE,
    probeIdB: PROBE,
  }));
}

let mid = 0;
function mk(holeId: number, measuredAt: string, tilts: number[], factor = 1, isInitial = false): Measurement {
  const now = new Date(Date.parse(measuredAt)).toISOString();
  return {
    id: ++mid,
    holeId,
    measuredAt,
    isInitial,
    operator: null,
    note: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    rows: rowsFromTilts(tilts, factor),
  };
}

const seg0: DatumSegment = {
  id: 1,
  holeId: 1,
  seq: 0,
  reason: 'initial',
  anchorMeasurementId: null,
  startedAt: '1970-01-01T00:00:00Z',
  note: null,
};

const mm = 1e-6;

describe('三测段算例（需求给定）', () => {
  it('测段长 0.5m，从孔底往上相对初始倾斜 0、0.004、0.002 → 段顶累计 0、2mm、3mm', () => {
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    const later = mk(1, '2026-01-08T00:00:00Z', [0, 0.004, 0.002]);
    const r = computeHole([initial, later], [seg0], calibs, cfg, 'upload', later.measuredAt);
    const d = r.measurements[1]!.displacementAtPoints;
    // 测点顺序自上而下：孔口(0m)=3，0.5m=2，1.0m=0，孔底1.5m=0
    expect(d[3]).toBeCloseTo(0, 6);
    expect(d[2]).toBeCloseTo(0, 6);
    expect(d[1]).toBeCloseTo(2, 3);
    expect(d[0]).toBeCloseTo(3, 3);
  });
});

describe('剖面基本性质', () => {
  it('读数全部等于初始测量时位移处处为零', () => {
    const tilts = [0.001, -0.002, 0.003];
    const initial = mk(1, '2026-01-01T00:00:00Z', tilts, 1, true);
    const later = mk(1, '2026-01-08T00:00:00Z', tilts);
    const r = computeHole([initial, later], [seg0], calibs, cfg, 'upload', later.measuredAt);
    for (const v of r.measurements[1]!.displacementAtPoints) expect(v).toBeCloseTo(0, 10);
  });

  it('探头系数变为两倍而读数不变时位移变为两倍', () => {
    const cal2: CalibEntry[] = [{ probeId: PROBE, factor: 2, effectiveFrom: '2020-01-01T00:00:00Z' }];
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    const later = mk(1, '2026-01-08T00:00:00Z', [0, 0.004, 0.002]);
    const r1 = computeHole([initial, later], [seg0], calibs, cfg, 'upload', later.measuredAt);
    const r2 = computeHole([initial, later], [seg0], cal2, cfg, 'upload', later.measuredAt);
    const d1 = r1.measurements[1]!.displacementAtPoints;
    const d2 = r2.measurements[1]!.displacementAtPoints;
    for (let j = 0; j < d1.length; j++) expect(d2[j]).toBeCloseTo(2 * d1[j]!, 9);
  });

  it('把正反测读数互换，位移变号', () => {
    const flip = (m: Measurement): Measurement => ({
      ...m,
      rows: m.rows.map((r) => ({ ...r, a: r.b, b: r.a })),
    });
    const initial = mk(1, '2026-01-01T00:00:00Z', [0.001, 0.001, 0.001], 1, true);
    const later = mk(1, '2026-01-08T00:00:00Z', [0.003, 0.005, 0.002]);
    const r = computeHole([initial, later], [seg0], calibs, cfg, 'upload', later.measuredAt);
    const rf = computeHole([flip(initial), flip(later)], [seg0], calibs, cfg, 'upload', later.measuredAt);
    const d = r.measurements[1]!.displacementAtPoints;
    const df = rf.measurements[1]!.displacementAtPoints;
    for (let j = 0; j < d.length; j++) expect(df[j]).toBeCloseTo(-d[j]!, 9);
  });
});

describe('速率与预警分级', () => {
  it('速率 = 位移差 / 天数，取最大绝对速率定级', () => {
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    // 2 天后孔口累计 12mm（12mm/2d=6mm/d → yellow[5,10)）；变形集中在最底测段
    const later = mk(1, '2026-01-03T00:00:00Z', [0, 0, 0.024]);
    const r = computeHole([initial, later], [seg0], calibs, cfg, 'upload', later.measuredAt);
    const mi = r.measurements[1]!;
    expect(mi.ratesAtPoints[0]).toBeCloseTo(6, 9);
    expect(mi.overallLevel).toBe('yellow');
  });

  it('同日两次测量不产生速率（首测速率为 null）', () => {
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    const later = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0.004]);
    later.createdAt = '2026-01-01T12:00:00Z';
    const r = computeHole([initial, later], [seg0], calibs, cfg, 'upload', later.measuredAt);
    expect(r.measurements[1]!.ratesAtPoints.every((v) => v === null)).toBe(true);
    expect(r.measurements[1]!.overallLevel).toBeNull();
  });
});

describe('校核和可疑点', () => {
  it('偏离中位数超过容差的点标可疑但不剔除（仍参与位移计算）', () => {
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    const later = mk(1, '2026-01-03T00:00:00Z', [0.004, 0, 0]);
    // 给最底测段加一个 0.5 的反测零偏 → 校核和异常；同时 a=2*0=0 不变（该测段位移为0）
    later.rows[2] = { depth: 1.0, a: 0, b: 0.5, probeIdA: PROBE, probeIdB: PROBE };
    const cfgTol = { ...cfg, checksumTolerance: 0.1 };
    const r = computeHole([initial, later], [seg0], calibs, cfgTol, 'upload', later.measuredAt);
    const cs = r.measurements[1]!.checksums;
    // 可疑行是按深度自上而下的第 3 行（1.0m，即最底测段）
    expect(cs[2]!.suspicious).toBe(true);
    expect(cs[0]!.suspicious).toBe(false);
    expect(cs[1]!.suspicious).toBe(false);
    // 位移仍按原读数计算（可疑但不剔除）：最底测段 (0-0.5)/2=-0.25 累加到所有测点
    const d = r.measurements[1]!.displacementAtPoints;
    expect(Math.abs(d[0]!)).toBeGreaterThan(0);
  });
});

describe('增量与全量一致性（纯函数等价性）', () => {
  it('更正后增量结果与全量重算完全一致', () => {
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    const m2 = mk(1, '2026-01-03T00:00:00Z', [0, 0, 0.004]);
    const m3 = mk(1, '2026-01-06T00:00:00Z', [0, 0, 0.01]);
    // 「增量」：每加一次测量，当时得到的结果都缓存下来
    const step1 = computeHole([initial, m2], [seg0], calibs, cfg, 'upload', m2.measuredAt);
    const step2 = computeHole([initial, m2, m3], [seg0], calibs, cfg, 'upload', m3.measuredAt);
    // 「全量」：最终用全部输入从头重算
    const full = computeHole([initial, m2, m3], [seg0], calibs, cfg, 'recalc', '2026-02-01T00:00:00Z');
    const fullById = new Map(full.measurements.map((x) => [x.measurementId, x]));
    const incremental: typeof full.measurements = [...step1.measurements, ...step2.measurements];
    for (const inc of incremental) {
      const ful = fullById.get(inc.measurementId)!;
      for (let j = 0; j < inc.displacementAtPoints.length; j++) {
        expect(ful.displacementAtPoints[j]).toBeCloseTo(inc.displacementAtPoints[j]!, 12);
        const ri = inc.ratesAtPoints[j];
        const rf = ful.ratesAtPoints[j];
        if (ri === null || rf === null) expect(ri).toBe(rf);
        else expect(rf).toBeCloseTo(ri, 12);
      }
      expect(ful.overallLevel).toBe(inc.overallLevel);
    }
  });

  it('补录中间测量后，前后两次速率按新顺序重算', () => {
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    const m3 = mk(1, '2026-01-09T00:00:00Z', [0, 0, 0.016]); // 孔口 8mm
    const before = computeHole([initial, m3], [seg0], calibs, cfg, 'upload', m3.measuredAt);
    // 补录 1 月 5 日：4mm
    const mInsert = mk(1, '2026-01-05T00:00:00Z', [0, 0, 0.008]);
    const after = computeHole([initial, mInsert, m3], [seg0], calibs, cfg, 'correct', mInsert.measuredAt);
    // 补录前：8mm/8d = 1mm/d（无警）；补录后：m3 速率 (8-4)/4=1mm/d；插入测速率 4/4=1mm/d
    expect(before.measurements[1]!.ratesAtPoints[0]).toBeCloseTo(1, 9);
    const byId = new Map(after.measurements.map((x) => [x.measurementId, x]));
    expect(byId.get(m3.id)!.ratesAtPoints[0]).toBeCloseTo(1, 9);
    expect(byId.get(mInsert.id)!.ratesAtPoints[0]).toBeCloseTo(1, 9);
    // 顺序确认为 initial → insert → m3
    expect(after.measurements.map((x) => x.measurementId)).toEqual([initial.id, mInsert.id, m3.id]);
  });
});

describe('基准拼接（方案二：中位数系统偏移）', () => {
  it('换探头带来常数零偏时，拼接后无刚体台阶，变形连续', () => {
    // 旧探头：孔口已累计 4mm（变形在最底测段）
    const initial = mk(1, '2026-01-01T00:00:00Z', [0, 0, 0], 1, true);
    const preLast = mk(1, '2026-01-08T00:00:00Z', [0, 0, 0.008]);
    // 新探头带常数零偏：同样地层，读数倾斜整体 +0.01
    const probe2 = 2;
    const calibs2: CalibEntry[] = [
      ...calibs,
      { probeId: probe2, factor: 1, effectiveFrom: '2026-01-09T00:00:00Z' },
    ];
    const mkWithProbe = (measuredAt: string, bottomUp: number[], bias: number): Measurement => {
      const m = mk(1, measuredAt, [0, 0, 0]);
      m.rows = [...bottomUp].reverse().map((t, i) => ({
        depth: i * 0.5,
        a: 2 * (t + bias),
        b: 0,
        probeIdA: probe2,
        probeIdB: probe2,
      }));
      return m;
    };
    const firstNew = mkWithProbe('2026-01-10T00:00:00Z', [0, 0, 0.008], 0.01);
    const seg1: DatumSegment = {
      id: 2,
      holeId: 1,
      seq: 1,
      reason: 'probe_change',
      anchorMeasurementId: firstNew.id,
      startedAt: firstNew.measuredAt,
      note: null,
    };
    const r = computeHole([initial, preLast, firstNew], [seg0, seg1], calibs2, cfg, 'upload', firstNew.measuredAt);
    const byId = new Map(r.measurements.map((x) => [x.measurementId, x]));
    // 新段首测（地层没变，仅换探头）→ 相对孔底剖面应与旧段末测一致
    const dPrev = byId.get(preLast.id)!.displacementAtPoints;
    const dNew = byId.get(firstNew.id)!.displacementAtPoints;
    for (let j = 0; j < dPrev.length; j++) expect(dNew[j]).toBeCloseTo(dPrev[j]!, 6);
    // δ 标在新段首测上
    expect(byId.get(firstNew.id)!.spliceDelta).toBeCloseTo(0.01, 9);
  });
});
