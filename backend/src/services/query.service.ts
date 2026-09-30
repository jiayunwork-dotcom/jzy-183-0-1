import { withTx } from '../db/pool.js';
import * as holesRepo from '../db/holes.repo.js';
import * as mRepo from '../db/measurements.repo.js';
import * as snapRepo from '../db/snapshots.repo.js';

/** 任选几次测量叠在一起的位移剖面 */
export async function profileOverlay(holeId: number, measurementIds: number[] | 'all') {
  return withTx(async (tx) => {
    const hole = await holesRepo.getHole(tx, holeId);
    if (!hole) return null;
    const all = await mRepo.listMeasurements(tx, holeId);
    const derived = await snapRepo.listDerived(tx, holeId);
    const segments = await holesRepo.listSegments(tx, holeId);
    const dMap = new Map(derived.map((d) => [d.measurement_id, d]));
    const picked = measurementIds === 'all' ? all : all.filter((m) => measurementIds.includes(m.id));
    const depths = all[0] ? all[0].rows.map((r) => r.depth).concat(hole.depthM) : [];
    return {
      hole: {
        id: hole.id,
        code: hole.code,
        depthM: hole.depthM,
        spacingM: hole.spacingM,
        positiveDirection: hole.positiveDirection,
      },
      depths,
      segments: segments.map((s) => ({
        id: s.id,
        seq: s.seq,
        reason: s.reason,
        anchorMeasurementId: s.anchorMeasurementId,
        startedAt: s.startedAt,
        note: s.note,
      })),
      series: picked.map((m) => {
        const d = dMap.get(m.id)!;
        return {
          measurementId: m.id,
          measuredAt: m.measuredAt,
          operator: m.operator,
          isInitial: m.isInitial,
          datumSegmentId: d.datum_segment_id,
          spliceDelta: d.splice_delta,
          displacement: d.displacement,
          overallLevel: d.overall_level,
        };
      }),
    };
  });
}

/** 某深度随时间的位移与速率 */
export async function depthTimeSeries(holeId: number, depth: number) {
  return withTx(async (tx) => {
    const hole = await holesRepo.getHole(tx, holeId);
    if (!hole) return null;
    const all = await mRepo.listMeasurements(tx, holeId);
    const derived = await snapRepo.listDerived(tx, holeId);
    const dMap = new Map(derived.map((d) => [d.measurement_id, d]));
    const index = Math.round(depth / hole.spacingM);
    if (index < 0 || index > all[0]?.rows.length!) {
      return { hole, depth, index, points: [] as unknown[] };
    }
    const points = all.map((m) => {
      const d = dMap.get(m.id)!;
      return {
        measurementId: m.id,
        measuredAt: m.measuredAt,
        displacement: d.displacement[index] ?? null,
        rate: d.rates[index] ?? null,
        overallLevel: d.overall_level,
      };
    });
    const thresholds = { blue: hole.blue, yellow: hole.yellow, red: hole.red };
    return { hole, depth, index, thresholds, points };
  });
}

export async function overview() {
  return withTx(async (tx) => snapRepo.overview(tx));
}
