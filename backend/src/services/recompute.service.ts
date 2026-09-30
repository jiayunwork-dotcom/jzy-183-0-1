/**
 * 重算服务：任何影响某孔输入的写入之后调用 recomputeHole。
 * 实现方式恒为「取当前全部输入 → computeHole → 整体替换派生缓存 + 追加快照」，
 * 因此按当前数据增量更新与从头全量重算必然逐位一致（同一函数、同一份输入）。
 */
import type { PoolClient } from 'pg';
import { computeHole, type HoleCalcConfig } from '../calc/profile.js';
import type { CalibEntry } from '../calc/calibration.js';
import type { AssessmentSnapshot, WarnColor } from '../models/types.js';
import * as holesRepo from '../db/holes.repo.js';
import * as mRepo from '../db/measurements.repo.js';
import * as pRepo from '../db/probes.repo.js';
import * as snapRepo from '../db/snapshots.repo.js';

export class ConflictError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export async function recomputeHole(
  tx: PoolClient,
  holeId: number,
  reason: AssessmentSnapshot['reason'],
  computedAt: Date,
): Promise<void> {
  const hole = await holesRepo.getHole(tx, holeId);
  if (!hole) throw new Error(`孔 ${holeId} 不存在`);
  const measurements = await mRepo.listMeasurements(tx, holeId);
  if (measurements.length === 0) {
    await snapRepo.replaceDerived(tx, holeId, [], [], computedAt.toISOString());
    return;
  }
  const segments = await holesRepo.listSegments(tx, holeId);
  const probeIds = new Set<number>();
  for (const m of measurements) for (const r of m.rows) probeIds.add(r.probeIdA), probeIds.add(r.probeIdB);
  const calibrations = await pRepo.listCalibrationsForProbes(tx, [...probeIds]);
  const entries: CalibEntry[] = calibrations.map((c) => ({
    probeId: c.probeId,
    factor: c.factor,
    effectiveFrom: c.effectiveFrom,
  }));

  const config: HoleCalcConfig = {
    depthM: hole.depthM,
    spacingM: hole.spacingM,
    thresholds: { blue: hole.blue, yellow: hole.yellow, red: hole.red },
    checksumTolerance: hole.checksumTolerance,
  };

  const result = computeHole(measurements, segments, entries, config, reason, computedAt.toISOString());
  await snapRepo.replaceDerived(
    tx,
    holeId,
    result.snapshots,
    result.measurements.map((mi) => ({
      measurementId: mi.measurementId,
      datumSegmentId: mi.datumSegmentId,
      displacement: mi.displacementAtPoints,
      rates: mi.ratesAtPoints,
      overallLevel: mi.overallLevel,
      spliceDelta: mi.spliceDelta,
    })),
    computedAt.toISOString(),
  );
}

export interface LevelDiffEntry {
  depth: number;
  thenLevel: WarnColor | null;
  nowLevel: WarnColor | null;
  thenRate: number | null;
  nowRate: number | null;
}

export interface ThenNow {
  then: (AssessmentSnapshot & { id: number }) | null;
  now: (AssessmentSnapshot & { id: number }) | null;
  thenOverall: WarnColor | null;
  nowOverall: WarnColor | null;
  changed: boolean;
  diffs: LevelDiffEntry[];
}

/**
 * 历史判级对比：
 * - then：该测量首次上传/更正发生时「按当时数据」的快照；
 * - now：最新一次重算（按现在数据）的快照。
 */
export async function thenNowAssessment(
  tx: PoolClient,
  measurementId: number,
): Promise<ThenNow> {
  const then = await snapRepo.snapshotAt(tx, measurementId);
  const now = await snapRepo.latestSnapshot(tx, measurementId);
  const diffs: LevelDiffEntry[] = [];
  if (then && now) {
    const nowByDepth = new Map(now.points.map((p) => [p.depth, p]));
    for (const p of then.points) {
      const q = nowByDepth.get(p.depth);
      if (q && (q.level !== p.level || num(q.rate) !== num(p.rate))) {
        diffs.push({
          depth: p.depth,
          thenLevel: p.level,
          nowLevel: q.level,
          thenRate: p.rate,
          nowRate: q.rate,
        });
      }
    }
  }
  return {
    then,
    now,
    thenOverall: then?.overallLevel ?? null,
    nowOverall: now?.overallLevel ?? null,
    changed: (then?.overallLevel ?? null) !== (now?.overallLevel ?? null) || diffs.length > 0,
    diffs,
  };
}

function num(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1e9) / 1e9;
}
