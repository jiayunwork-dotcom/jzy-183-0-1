import type { DatumReason, ThresholdSet } from '../models/types.js';
import { ValidationError } from '../validation/validate.js';
import { validateHole } from '../validation/validate.js';
import { lockHole, withTx } from '../db/pool.js';
import * as holesRepo from '../db/holes.repo.js';
import { recomputeHole } from './recompute.service.js';

export async function listHoles() {
  return withTx((tx) => holesRepo.listHoles(tx));
}

export async function createHole(input: Parameters<typeof validateHole>[0]) {
  const v = validateHole(input);
  return withTx(async (tx) => {
    const existing = await holesRepo.getHoleByCode(tx, v.code);
    if (existing) {
      throw new ValidationError([{ field: 'code', message: `编号 ${v.code} 已存在` }]);
    }
    const hole = await holesRepo.insertHole(tx, v);
    // 初始基准段（seq=0）；待初始测量上传后把 anchor 指到该测量
    await holesRepo.insertSegment(tx, {
      holeId: hole.id,
      seq: 0,
      reason: 'initial',
      anchorMeasurementId: null,
      startedAt: new Date(0).toISOString(),
      note: '初始基准段（首测上传前创建）',
    });
    return hole;
  });
}

export async function updateHoleThresholds(
  id: number,
  patch: {
    positiveDirection?: string;
    checksumTolerance?: number;
    thresholds?: Partial<ThresholdSet>;
  },
) {
  return withTx(async (tx) => {
    await lockHole(tx, id);
    const current = await holesRepo.getHole(tx, id);
    if (!current) throw new ValidationError([{ field: 'id', message: '测孔不存在' }]);
    const merged = {
      code: current.code,
      depthM: current.depthM,
      spacingM: current.spacingM,
      positiveDirection: patch.positiveDirection ?? current.positiveDirection,
      checksumTolerance: patch.checksumTolerance ?? current.checksumTolerance,
      thresholds: { ...{ blue: current.blue, yellow: current.yellow, red: current.red }, ...(patch.thresholds ?? {}) },
    };
    validateHole(merged);
    const hole = await holesRepo.updateHole(tx, id, {
      positiveDirection: merged.positiveDirection,
      checksumTolerance: merged.checksumTolerance,
      thresholds: merged.thresholds,
    });
    // 阈值改了：所有历史测量按新阈值重判，快照追加留痕
    await recomputeHole(tx, id, 'recalc', new Date());
    return hole;
  });
}

/**
 * 创建新基准段（换探头/导管修复/正式重设初始）。
 * startedAt = 新基准首次测量的测量时刻：该时刻（含）起的测量归入新段。
 * 必须在上传新基准首测的同一事务里调用，以便立即拼接。
 */
export async function createDatumSegment(
  tx: import('pg').PoolClient,
  holeId: number,
  i: { reason: DatumReason; anchorMeasurementId: number; startedAt: string; note?: string | null },
) {
  const seq = (await holesRepo.maxSegmentSeq(tx, holeId)) + 1;
  const seg = await holesRepo.insertSegment(tx, {
    holeId,
    seq,
    reason: i.reason,
    anchorMeasurementId: i.anchorMeasurementId,
    startedAt: i.startedAt,
    note: i.note ?? null,
  });
  return seg;
}

export async function listSegments(holeId: number) {
  return withTx((tx) => holesRepo.listSegments(tx, holeId));
}
