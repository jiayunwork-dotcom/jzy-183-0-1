import type { Pool, PoolClient } from 'pg';
import type { DatumSegment, Hole, ThresholdSet } from '../models/types.js';

type Db = PoolClient | Pool;

interface HoleRow {
  id: number;
  code: string;
  depth_m: number;
  spacing_m: number;
  positive_direction: string;
  checksum_tolerance: number;
  threshold_blue: number;
  threshold_yellow: number;
  threshold_red: number;
  created_at: Date;
}

export function mapHole(r: HoleRow): Hole & ThresholdSet {
  return {
    id: r.id,
    code: r.code,
    depthM: r.depth_m,
    spacingM: r.spacing_m,
    positiveDirection: r.positive_direction,
    checksumTolerance: r.checksum_tolerance,
    createdAt: r.created_at.toISOString(),
    blue: r.threshold_blue,
    yellow: r.threshold_yellow,
    red: r.threshold_red,
  };
}

export function thresholdsOf(h: Hole & ThresholdSet): ThresholdSet {
  return { blue: h.blue, yellow: h.yellow, red: h.red };
}

export async function listHoles(db: Db) {
  const { rows } = await db.query<HoleRow>('SELECT * FROM holes ORDER BY code');
  return rows.map(mapHole);
}

export async function getHole(db: Db, id: number) {
  const { rows } = await db.query<HoleRow>('SELECT * FROM holes WHERE id = $1', [id]);
  return rows[0] ? mapHole(rows[0]) : null;
}

export async function getHoleByCode(db: Db, code: string) {
  const { rows } = await db.query<HoleRow>('SELECT * FROM holes WHERE code = $1', [code]);
  return rows[0] ? mapHole(rows[0]) : null;
}

export async function insertHole(
  db: Db,
  i: {
    code: string;
    depthM: number;
    spacingM: number;
    positiveDirection: string;
    checksumTolerance: number;
    thresholds: ThresholdSet;
  },
): Promise<Hole & ThresholdSet> {
  const { rows } = await db.query<HoleRow>(
    `INSERT INTO holes(code, depth_m, spacing_m, positive_direction, checksum_tolerance,
                       threshold_blue, threshold_yellow, threshold_red)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      i.code,
      i.depthM,
      i.spacingM,
      i.positiveDirection,
      i.checksumTolerance,
      i.thresholds.blue,
      i.thresholds.yellow,
      i.thresholds.red,
    ],
  );
  return mapHole(rows[0]!);
}

/** 阈值/属性更正。调用方负责之后重算所有测量（阈值改了，历史判级也会变）。 */
export async function updateHole(
  db: Db,
  id: number,
  patch: Partial<{
    depthM: number;
    spacingM: number;
    positiveDirection: string;
    checksumTolerance: number;
    thresholds: ThresholdSet;
  }>,
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = $${n++}`);
    vals.push(v);
  };
  if (patch.depthM !== undefined) add('depth_m', patch.depthM);
  if (patch.spacingM !== undefined) add('spacing_m', patch.spacingM);
  if (patch.positiveDirection !== undefined) add('positive_direction', patch.positiveDirection);
  if (patch.checksumTolerance !== undefined) add('checksum_tolerance', patch.checksumTolerance);
  if (patch.thresholds) {
    add('threshold_blue', patch.thresholds.blue);
    add('threshold_yellow', patch.thresholds.yellow);
    add('threshold_red', patch.thresholds.red);
  }
  if (sets.length === 0) return getHole(db, id);
  vals.push(id);
  const { rows } = await db.query<HoleRow>(
    `UPDATE holes SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
    vals,
  );
  return rows[0] ? mapHole(rows[0]) : null;
}

// ---------- 基准段 ----------

interface SegmentRow {
  id: number;
  hole_id: number;
  seq: number;
  reason: DatumSegment['reason'];
  anchor_measurement_id: number | null;
  started_at: Date;
  note: string | null;
}

function mapSegment(r: SegmentRow): DatumSegment {
  return {
    id: r.id,
    holeId: r.hole_id,
    seq: r.seq,
    reason: r.reason,
    anchorMeasurementId: r.anchor_measurement_id,
    startedAt: r.started_at.toISOString(),
    note: r.note,
  };
}

export async function listSegments(db: Db, holeId: number): Promise<DatumSegment[]> {
  const { rows } = await db.query<SegmentRow>(
    'SELECT * FROM datum_segments WHERE hole_id = $1 ORDER BY seq',
    [holeId],
  );
  return rows.map(mapSegment);
}

export async function maxSegmentSeq(db: Db, holeId: number): Promise<number> {
  const { rows } = await db.query<{ m: number | null }>(
    'SELECT max(seq)::int AS m FROM datum_segments WHERE hole_id = $1',
    [holeId],
  );
  return rows[0]?.m ?? -1;
}

export async function insertSegment(
  db: Db,
  i: {
    holeId: number;
    seq: number;
    reason: DatumSegment['reason'];
    anchorMeasurementId: number | null;
    startedAt: string;
    note?: string | null;
  },
): Promise<DatumSegment> {
  const { rows } = await db.query<SegmentRow>(
    `INSERT INTO datum_segments(hole_id, seq, reason, anchor_measurement_id, started_at, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [i.holeId, i.seq, i.reason, i.anchorMeasurementId, i.startedAt, i.note ?? null],
  );
  return mapSegment(rows[0]!);
}

export async function updateSegmentAnchor(
  db: Db,
  segmentId: number,
  anchorMeasurementId: number,
) {
  await db.query('UPDATE datum_segments SET anchor_measurement_id = $2 WHERE id = $1', [
    segmentId,
    anchorMeasurementId,
  ]);
}
