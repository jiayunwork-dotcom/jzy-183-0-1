import type { DatumReason, ReadingRow } from '../models/types.js';
import { ValidationError, validateMeasurementRows } from '../validation/validate.js';
import { lockHole, withTx } from '../db/pool.js';
import * as holesRepo from '../db/holes.repo.js';
import * as mRepo from '../db/measurements.repo.js';
import * as pRepo from '../db/probes.repo.js';
import * as snapRepo from '../db/snapshots.repo.js';
import { ConflictError, recomputeHole, thenNowAssessment } from './recompute.service.js';
import { createDatumSegment } from './holes.service.js';

export interface UploadInput {
  holeId: number;
  measuredAt: string;
  operator?: string | null;
  note?: string | null;
  isInitial?: boolean;
  rows: Array<Partial<ReadingRow>>;
  /** 本次测量即新基准首测（换探头/修复/重设） */
  newDatum?: { reason: DatumReason; note?: string | null };
}

async function loadValidationContext(tx: import('pg').PoolClient, holeId: number, measuredAt: string) {
  const hole = await holesRepo.getHole(tx, holeId);
  if (!hole) throw new ValidationError([{ field: 'holeId', message: '测孔不存在' }]);
  const probes = await pRepo.listProbes(tx);
  const registered = new Set(probes.map((p) => p.id));
  const readyMap = await pRepo.earliestCalibrationByProbe(tx);
  const initialAt = await mRepo.earliestInitialAt(tx, holeId);
  return { hole, registered, readyMap, initialAt };
}

export async function uploadMeasurement(input: UploadInput) {
  if (Number.isNaN(Date.parse(input.measuredAt))) {
    throw new ValidationError([{ field: 'measuredAt', message: '测量日期无法解析' }]);
  }
  return withTx(async (tx) => {
    await lockHole(tx, input.holeId);
    const ctx = await loadValidationContext(tx, input.holeId, input.measuredAt);
    const rows = validateMeasurementRows({
      rows: input.rows,
      measuredAt: input.measuredAt,
      hole: ctx.hole,
      registeredProbeIds: ctx.registered,
      calibrationReadyAt: ctx.readyMap,
      initialMeasuredAt: ctx.initialAt,
    });

    // 孔的第一测自动视为初始测量；显式 isInitial 也接受（但不得早于已有初始）
    const existing = await mRepo.listMeasurements(tx, input.holeId);
    const autoInitial = existing.length === 0;
    const isInitial = autoInitial || input.isInitial === true;

    const created = await mRepo.insertMeasurement(tx, {
      holeId: input.holeId,
      measuredAt: input.measuredAt,
      isInitial,
      operator: input.operator ?? null,
      note: input.note ?? null,
      rows,
    });

    if (autoInitial) {
      const seg0 = (await holesRepo.listSegments(tx, input.holeId))[0]!;
      await holesRepo.updateSegmentAnchor(tx, seg0.id, created.id);
    }

    if (input.newDatum && !autoInitial) {
      // 新基准段：段起点 = 本次测量时刻；anchor 指向本次测量
      await createDatumSegment(tx, input.holeId, {
        reason: input.newDatum.reason,
        anchorMeasurementId: created.id,
        startedAt: created.measuredAt,
        note: input.newDatum.note ?? null,
      });
    }

    await recomputeHole(tx, input.holeId, 'upload', new Date());
    return mRepo.getMeasurement(tx, created.id);
  });
}

export interface CorrectInput {
  measurementId: number;
  /** 客户端必须携带它读到的 revision；服务端不一致即冲突 */
  expectedRevision: number;
  actor: string;
  measuredAt?: string;
  operator?: string | null;
  note?: string | null;
  rows?: Array<Partial<ReadingRow>>;
}

export async function correctMeasurement(input: CorrectInput) {
  return withTx(async (tx) => {
    const before = await mRepo.getMeasurement(tx, input.measurementId);
    if (!before) throw new ValidationError([{ field: 'measurementId', message: '测量不存在' }]);
    await lockHole(tx, before.holeId);

    // 锁内重新读 revision，确保乐观锁判断基于最新值
    const currentRev = await mRepo.getRevision(tx, input.measurementId);
    if (currentRev !== input.expectedRevision) {
      throw new ConflictError(
        'revision',
        `并发更正冲突：该测量已被别人更新（当前 revision=${currentRev}，您基于 revision=${input.expectedRevision}），本次更正未生效`,
      );
    }

    const measuredAt = input.measuredAt ?? before.measuredAt;
    let rows: ReadingRow[] | undefined;
    if (input.rows) {
      const ctx = await loadValidationContext(tx, before.holeId, measuredAt);
      rows = validateMeasurementRows({
        rows: input.rows,
        measuredAt,
        hole: ctx.hole,
        registeredProbeIds: ctx.registered,
        calibrationReadyAt: ctx.readyMap,
        initialMeasuredAt: ctx.initialAt,
      });
    } else if (input.measuredAt) {
      const ctx = await loadValidationContext(tx, before.holeId, measuredAt);
      rows = validateMeasurementRows({
        rows: before.rows,
        measuredAt,
        hole: ctx.hole,
        registeredProbeIds: ctx.registered,
        calibrationReadyAt: ctx.readyMap,
        initialMeasuredAt: ctx.initialAt,
      });
    }

    const updated = await mRepo.updateMeasurementOptimistic(
      tx,
      input.measurementId,
      input.expectedRevision,
      { measuredAt: input.measuredAt, operator: input.operator, note: input.note, rows },
    );
    if (!updated) {
      // advisory lock 已串行化同孔写入，理论上不会到这里；兜底仍按冲突处理
      throw new ConflictError('revision', '并发更正冲突：本次更正未生效');
    }

    await mRepo.insertCorrection(tx, {
      measurementId: input.measurementId,
      actor: input.actor,
      baseRevision: input.expectedRevision,
      newRevision: updated.revision,
      before: { measuredAt: before.measuredAt, rows: before.rows, note: before.note },
      after: { measuredAt: updated.measuredAt, rows: updated.rows, note: updated.note },
    });

    // 受影响的是整孔：补录/改日期会改变排序，故全部测量的剖面与速率一律重算
    await recomputeHole(tx, before.holeId, 'correct', new Date());
    return updated;
  });
}

export async function listMeasurements(holeId: number) {
  return withTx(async (tx) => {
    const measurements = await mRepo.listMeasurements(tx, holeId);
    const segments = await holesRepo.listSegments(tx, holeId);
    const derived = await snapRepo.listDerived(tx, holeId);
    const dMap = new Map(derived.map((d) => [d.measurement_id, d]));
    return measurements.map((m) => {
      const d = dMap.get(m.id);
      return {
        ...m,
        datumSegmentId: d?.datum_segment_id ?? null,
        overallLevel: d?.overall_level ?? null,
        spliceDelta: d?.splice_delta ?? null,
        displacement: d?.displacement ?? null,
        rates: d?.rates ?? null,
        segmentSeq: segments.find((s) => s.id === d?.datum_segment_id)?.seq ?? null,
      };
    });
  });
}

export async function getMeasurementDetail(measurementId: number) {
  return withTx(async (tx) => {
    const m = await mRepo.getMeasurement(tx, measurementId);
    if (!m) return null;
    const snap = await snapRepo.latestSnapshot(tx, measurementId);
    const thenNow = await thenNowAssessment(tx, measurementId);
    const history = await snapRepo.listSnapshotHistory(tx, measurementId);
    return { measurement: m, latest: snap, thenNow, history };
  });
}

export async function measurementHistory(measurementId: number) {
  return withTx((tx) => thenNowAssessment(tx, measurementId));
}

export { ConflictError };
