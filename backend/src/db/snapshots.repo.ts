import type { Pool, PoolClient } from 'pg';
import type { AssessmentSnapshot, WarnColor } from '../models/types.js';

type Db = PoolClient | Pool;

interface SnapshotRow {
  id: number;
  measurement_id: number;
  hole_id: number;
  reason: AssessmentSnapshot['reason'];
  computed_at: Date;
  fingerprint: string;
  overall_level: WarnColor | null;
  points: AssessmentSnapshot['points'];
  checksums: AssessmentSnapshot['checksums'];
}

function mapSnapshot(r: SnapshotRow): AssessmentSnapshot & { id: number } {
  return {
    id: r.id,
    measurementId: r.measurement_id,
    holeId: r.hole_id,
    reason: r.reason,
    computedAt: r.computed_at.toISOString(),
    fingerprint: r.fingerprint,
    overallLevel: r.overall_level,
    points: r.points,
    checksums: r.checksums,
  };
}

/** 全孔重算后：删除该孔旧的派生缓存与旧快照，写入新一批（快照表用 ON 冲突策略保留历史）。 */
export async function replaceDerived(
  db: Db,
  holeId: number,
  snapshots: AssessmentSnapshot[],
  derived: Array<{
    measurementId: number;
    datumSegmentId: number;
    displacement: number[];
    rates: (number | null)[];
    overallLevel: WarnColor | null;
    spliceDelta: number | null;
  }>,
  computedAt: string,
): Promise<void> {
  // 快照是只追加的判级历史：不去重，直接插入
  const sVals: unknown[] = [];
  const sParts: string[] = [];
  let n = 1;
  for (const s of snapshots) {
    sParts.push(`($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`);
    sVals.push(
      s.measurementId,
      holeId,
      s.reason,
      computedAt,
      s.fingerprint,
      s.overallLevel,
      JSON.stringify(s.points),
      JSON.stringify(s.checksums),
    );
  }
  if (sParts.length) {
    await db.query(
      `INSERT INTO assessment_snapshots
         (measurement_id, hole_id, reason, computed_at, fingerprint, overall_level, points, checksums)
       VALUES ${sParts.join(',')}`,
      sVals,
    );
  }

  await db.query('DELETE FROM derived_profiles WHERE hole_id = $1', [holeId]);
  const dParts: string[] = [];
  const dVals: unknown[] = [];
  n = 1;
  for (const d of derived) {
    dParts.push(`($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`);
    dVals.push(
      d.measurementId,
      holeId,
      d.datumSegmentId,
      JSON.stringify(d.displacement),
      JSON.stringify(d.rates),
      d.overallLevel,
      d.spliceDelta,
      computedAt,
    );
  }
  if (dParts.length) {
    await db.query(
      `INSERT INTO derived_profiles
         (measurement_id, hole_id, datum_segment_id, displacement, rates, overall_level, splice_delta, computed_at)
       VALUES ${dParts.join(',')}`,
      dVals,
    );
  }
}

/** 最新快照（按现在的数据） */
export async function latestSnapshot(
  db: Db,
  measurementId: number,
): Promise<(AssessmentSnapshot & { id: number }) | null> {
  const { rows } = await db.query<SnapshotRow>(
    `SELECT * FROM assessment_snapshots WHERE measurement_id = $1
     ORDER BY computed_at DESC, id DESC LIMIT 1`,
    [measurementId],
  );
  return rows[0] ? mapSnapshot(rows[0]) : null;
}

/**
 * 「按当时」的判级：取某次更正发生之前、该测量最后一次重算得到的快照。
 * 更具体：返回截至 at 时刻（不含）最新一份；若不传 at，
 * 返回该测量的首份快照（即首次上传时「按当时的数据」）。
 */
export async function snapshotAt(
  db: Db,
  measurementId: number,
  at?: string,
): Promise<(AssessmentSnapshot & { id: number }) | null> {
  if (at) {
    const { rows } = await db.query<SnapshotRow>(
      `SELECT * FROM assessment_snapshots WHERE measurement_id = $1 AND computed_at < $2
       ORDER BY computed_at DESC, id DESC LIMIT 1`,
      [measurementId, at],
    );
    return rows[0] ? mapSnapshot(rows[0]) : null;
  }
  const { rows } = await db.query<SnapshotRow>(
    `SELECT * FROM assessment_snapshots WHERE measurement_id = $1
     ORDER BY computed_at ASC, id ASC LIMIT 1`,
    [measurementId],
  );
  return rows[0] ? mapSnapshot(rows[0]) : null;
}

export async function listSnapshotHistory(
  db: Db,
  measurementId: number,
): Promise<(AssessmentSnapshot & { id: number })[]> {
  const { rows } = await db.query<SnapshotRow>(
    'SELECT * FROM assessment_snapshots WHERE measurement_id = $1 ORDER BY computed_at, id',
    [measurementId],
  );
  return rows.map(mapSnapshot);
}

export interface DerivedRow {
  measurement_id: number;
  hole_id: number;
  datum_segment_id: number;
  displacement: number[];
  rates: (number | null)[];
  overall_level: WarnColor | null;
  splice_delta: number | null;
  computed_at: Date;
}

export async function listDerived(db: Db, holeId: number): Promise<DerivedRow[]> {
  const { rows } = await db.query<DerivedRow>(
    'SELECT * FROM derived_profiles WHERE hole_id = $1',
    [holeId],
  );
  return rows;
}

/** 全部测孔当前等级总览：每个孔取最新测量的整测等级 */
export async function overview(
  db: Db,
): Promise<Array<{ hole_id: number; code: string; measurement_id: number; measured_at: Date; overall_level: WarnColor | null }>> {
  const { rows } = await db.query(
    `SELECT h.id AS hole_id, h.code, m.id AS measurement_id, m.measured_at, d.overall_level
       FROM holes h
       JOIN LATERAL (
         SELECT id, measured_at FROM measurements
          WHERE hole_id = h.id ORDER BY measured_at DESC, created_at DESC LIMIT 1
       ) m ON true
       JOIN derived_profiles d ON d.measurement_id = m.id
      ORDER BY h.code`,
  );
  return rows;
}
