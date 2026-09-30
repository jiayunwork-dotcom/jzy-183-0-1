import pg from 'pg';

const { Pool, types } = pg;

// 业务表主键/外键用 BIGINT IDENTITY；本系统数量级远小于 2^53，
// 统一把 int8 解析为 number，避免到处出现 "1" !== 1 的隐患。
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://inclin:inclin@localhost:5432/inclin',
});

/** 每孔一把事务级咨询锁，串行化同一孔的所有写入（上传/更正/补录/基准变更） */
export async function lockHole(tx: pg.PoolClient, holeId: number): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(7331, $1)', [holeId]);
}

export async function withTx<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
