/**
 * Vitest 全局环境：
 * - 若已提供 DATABASE_URL，直接用（CI / docker compose 场景）；
 * - 否则尝试用 embedded-postgres 拉起一个临时 PostgreSQL 16。
 *   拉起失败（如离线拿不到二进制）时只警告，集成测试会自行 skip。
 */
import type { GlobalSetupContext } from 'vitest/node';

export default async function setup(_ctx: GlobalSetupContext) {
  if (process.env.DATABASE_URL) return;
  try {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const pg = new EmbeddedPostgres({
      version: 16,
      databaseDir: `/tmp/epg-vitest-${process.pid}`,
      user: 'postgres',
      password: 'postgres',
      port: 55433,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('inclin_test');
    process.env.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:55433/inclin_test';
    return async () => {
      await pg.stop();
    };
  } catch (e) {
    console.warn('[vitest] 无法启动 embedded-postgres，集成测试将跳过：', (e as Error).message);
  }
}
