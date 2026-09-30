import type { Pool, PoolClient, QueryResult } from 'pg';
import type { Calibration, Probe } from '../models/types.js';

type Db = PoolClient | Pool;

interface ProbeRow {
  id: number;
  code: string;
  note: string | null;
  created_at: Date;
}
interface CalRow {
  id: number;
  probe_id: number;
  factor: number;
  effective_from: Date;
  created_at: Date;
  note: string | null;
}

export function mapProbe(r: ProbeRow): Probe {
  return { id: r.id, code: r.code, note: r.note };
}

export async function listProbes(db: Db): Promise<Probe[]> {
  const { rows } = await db.query<ProbeRow>('SELECT * FROM probes ORDER BY code');
  return rows.map(mapProbe);
}

export async function getProbe(db: Db, id: number): Promise<Probe | null> {
  const { rows } = await db.query<ProbeRow>('SELECT * FROM probes WHERE id = $1', [id]);
  return rows[0] ? mapProbe(rows[0]) : null;
}

export async function insertProbe(db: Db, code: string, note: string | null): Promise<Probe> {
  const { rows } = await db.query<ProbeRow>(
    'INSERT INTO probes(code, note) VALUES ($1,$2) RETURNING *',
    [code, note],
  );
  return mapProbe(rows[0]!);
}

export function mapCalibration(r: CalRow): Calibration {
  return {
    id: r.id,
    probeId: r.probe_id,
    factor: r.factor,
    effectiveFrom: r.effective_from.toISOString(),
    createdAt: r.created_at.toISOString(),
  };
}

export async function listCalibrations(db: Db): Promise<Calibration[]> {
  const { rows } = await db.query<CalRow>('SELECT * FROM calibrations ORDER BY probe_id, effective_from');
  return rows.map(mapCalibration);
}

export async function listCalibrationsForProbes(db: Db, probeIds: number[]): Promise<Calibration[]> {
  if (probeIds.length === 0) return [];
  const { rows } = await db.query<CalRow>(
    'SELECT * FROM calibrations WHERE probe_id = ANY($1::bigint[]) ORDER BY probe_id, effective_from',
    [probeIds],
  );
  return rows.map(mapCalibration);
}

/** 每个探头最早生效标定的时间（录入校验用） */
export async function earliestCalibrationByProbe(
  db: Db,
): Promise<Map<number, string>> {
  const { rows } = await db.query<{ probe_id: number; earliest: Date }>(
    'SELECT probe_id, min(effective_from) AS earliest FROM calibrations GROUP BY probe_id',
  );
  return new Map(rows.map((r) => [r.probe_id, r.earliest.toISOString()]));
}

/** 哪些孔的测量用到了某探头（标定改期后要重算这些孔） */
export async function holesUsingProbe(db: Db, probeId: number): Promise<number[]> {
  const { rows } = await db.query<{ hole_id: number }>(
    `SELECT DISTINCT m.hole_id
       FROM reading_rows r JOIN measurements m ON m.id = r.measurement_id
      WHERE r.probe_id_a = $1 OR r.probe_id_b = $1`,
    [probeId],
  );
  return rows.map((r) => r.hole_id);
}

export async function insertCalibration(
  db: Db,
  i: { probeId: number; factor: number; effectiveFrom: string; note?: string | null },
): Promise<Calibration> {
  const { rows } = await db.query<CalRow>(
    `INSERT INTO calibrations(probe_id, factor, effective_from, note)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [i.probeId, i.factor, i.effectiveFrom, i.note ?? null],
  );
  return mapCalibration(rows[0]!);
}

export async function deleteCalibration(db: Db, id: number): Promise<QueryResult<never>> {
  return db.query('DELETE FROM calibrations WHERE id = $1', [id]);
}
