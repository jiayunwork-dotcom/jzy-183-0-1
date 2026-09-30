import type { Pool, PoolClient } from 'pg';
import type { Measurement, ReadingRow } from '../models/types.js';

type Db = PoolClient | Pool;

interface MRow {
  id: number;
  hole_id: number;
  measured_at: Date;
  is_initial: boolean;
  operator: string | null;
  note: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}
interface RRow {
  measurement_id?: number;
  depth: number;
  a: number;
  b: number;
  probe_id_a: number;
  probe_id_b: number;
}

export function mapMeasurement(m: MRow, rows: RRow[]): Measurement {
  return {
    id: m.id,
    holeId: m.hole_id,
    measuredAt: m.measured_at.toISOString(),
    isInitial: m.is_initial,
    operator: m.operator,
    note: m.note,
    revision: m.revision,
    createdAt: m.created_at.toISOString(),
    updatedAt: m.updated_at.toISOString(),
    rows: rows
      .map((r) => ({
        depth: r.depth,
        a: r.a,
        b: r.b,
        probeIdA: r.probe_id_a,
        probeIdB: r.probe_id_b,
      }))
      .sort((p, q) => p.depth - q.depth),
  };
}

export async function listMeasurements(db: Db, holeId: number): Promise<Measurement[]> {
  const { rows: mRows } = await db.query<MRow>(
    'SELECT * FROM measurements WHERE hole_id = $1 ORDER BY measured_at, created_at',
    [holeId],
  );
  if (mRows.length === 0) return [];
  const ids = mRows.map((m) => m.id);
  const { rows: rRows } = await db.query<RRow>(
    'SELECT measurement_id, depth, a, b, probe_id_a, probe_id_b FROM reading_rows WHERE measurement_id = ANY($1::bigint[])',
    [ids],
  );
  const byId = new Map<number, RRow[]>();
  for (const r of rRows) {
    const key = r.measurement_id;
    if (key === undefined) continue;
    const list = byId.get(key) ?? [];
    list.push(r);
    byId.set(key, list);
  }
  return mRows.map((m) => mapMeasurement(m, byId.get(m.id) ?? []));
}

export async function getMeasurement(db: Db, id: number): Promise<Measurement | null> {
  const { rows } = await db.query<MRow>('SELECT * FROM measurements WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const { rows: rRows } = await db.query<Omit<RRow, 'measurement_id'>>(
    'SELECT depth, a, b, probe_id_a, probe_id_b FROM reading_rows WHERE measurement_id = $1 ORDER BY depth',
    [id],
  );
  return mapMeasurement(rows[0], rRows);
}

export async function insertMeasurement(
  db: Db,
  i: {
    holeId: number;
    measuredAt: string;
    isInitial: boolean;
    operator: string | null;
    note: string | null;
    rows: ReadingRow[];
  },
): Promise<Measurement> {
  const { rows: mRows } = await db.query<MRow>(
    `INSERT INTO measurements(hole_id, measured_at, is_initial, operator, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [i.holeId, i.measuredAt, i.isInitial, i.operator, i.note],
  );
  const m = mRows[0]!;
  await insertRows(db, m.id, i.rows);
  return getMeasurement(db, m.id) as Promise<Measurement>;
}

async function insertRows(db: Db, measurementId: number, rows: ReadingRow[]): Promise<void> {
  const valueParts: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  rows.forEach((r) => {
    valueParts.push(`($${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`);
    vals.push(measurementId, r.depth, r.a, r.b, r.probeIdA, r.probeIdB);
  });
  await db.query(
    `INSERT INTO reading_rows(measurement_id, depth, a, b, probe_id_a, probe_id_b)
     VALUES ${valueParts.join(',')}`,
    vals,
  );
}

/** 乐观锁更正：仅当 revision 仍为 expectedRevision 时生效，返回 null 表示冲突 */
export async function updateMeasurementOptimistic(
  db: Db,
  id: number,
  expectedRevision: number,
  patch: { measuredAt?: string; operator?: string | null; note?: string | null; rows?: ReadingRow[] },
): Promise<Measurement | null> {
  const sets = ['revision = revision + 1', 'updated_at = now()'];
  const vals: unknown[] = [];
  let n = 1;
  if (patch.measuredAt !== undefined) {
    sets.push(`measured_at = $${n++}`);
    vals.push(patch.measuredAt);
  }
  if (patch.operator !== undefined) {
    sets.push(`operator = $${n++}`);
    vals.push(patch.operator);
  }
  if (patch.note !== undefined) {
    sets.push(`note = $${n++}`);
    vals.push(patch.note);
  }
  vals.push(id, expectedRevision);
  const { rows } = await db.query<MRow>(
    `UPDATE measurements SET ${sets.join(', ')}
      WHERE id = $${n} AND revision = $${n + 1} RETURNING *`,
    vals,
  );
  if (rows.length === 0) return null;
  if (patch.rows) {
    await db.query('DELETE FROM reading_rows WHERE measurement_id = $1', [id]);
    await insertRows(db, id, patch.rows);
  }
  return getMeasurement(db, id) as Promise<Measurement>;
}

export async function getRevision(db: Db, id: number): Promise<number | null> {
  const { rows } = await db.query<{ revision: number }>(
    'SELECT revision FROM measurements WHERE id = $1',
    [id],
  );
  return rows[0]?.revision ?? null;
}

export async function earliestInitialAt(db: Db, holeId: number): Promise<string | null> {
  const { rows } = await db.query<{ m: Date | null }>(
    `SELECT min(measured_at) AS m FROM measurements WHERE hole_id = $1 AND is_initial`,
    [holeId],
  );
  const v = rows[0]?.m;
  return v ? (v as Date).toISOString() : null;
}

export async function insertCorrection(
  db: Db,
  i: {
    measurementId: number;
    actor: string;
    baseRevision: number;
    newRevision: number;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO corrections(measurement_id, actor, base_revision, new_revision, payload_before, payload_after)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [i.measurementId, i.actor, i.baseRevision, i.newRevision, JSON.stringify(i.before), JSON.stringify(i.after)],
  );
}
