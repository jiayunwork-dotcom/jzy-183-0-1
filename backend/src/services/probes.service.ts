import { ValidationError } from '../validation/validate.js';
import { lockHole, withTx } from '../db/pool.js';
import * as pRepo from '../db/probes.repo.js';
import { recomputeHole } from './recompute.service.js';

export async function listProbes() {
  return withTx(async (tx) => {
    const probes = await pRepo.listProbes(tx);
    const cals = await pRepo.listCalibrations(tx);
    return probes.map((p) => ({
      ...p,
      calibrations: cals.filter((c) => c.probeId === p.id),
    }));
  });
}

export async function createProbe(code: string, note: string | null) {
  if (!code || !code.trim()) {
    throw new ValidationError([{ field: 'code', message: '探头编号不能为空' }]);
  }
  return withTx((tx) => pRepo.insertProbe(tx, code.trim(), note));
}

export async function addCalibration(input: {
  probeId: number;
  factor: unknown;
  effectiveFrom: string;
  note?: string | null;
}) {
  if (typeof input.factor !== 'number' || !Number.isFinite(input.factor) || input.factor === 0) {
    throw new ValidationError([
      { field: 'factor', message: '标定系数必须是非零有限数' },
    ]);
  }
  if (Number.isNaN(Date.parse(input.effectiveFrom))) {
    throw new ValidationError([{ field: 'effectiveFrom', message: '生效时间无法解析' }]);
  }
  const factor = input.factor as number;
  return withTx(async (tx) => {
    const probe = await pRepo.getProbe(tx, input.probeId);
    if (!probe) throw new ValidationError([{ field: 'probeId', message: '探头未登记' }]);
    const cal = await pRepo.insertCalibration(tx, {
      probeId: input.probeId,
      factor,
      effectiveFrom: input.effectiveFrom,
      note: input.note ?? null,
    });
    // 级联：所有用过该探头的孔按新标定版本重算（历史测量是否变化取决于生效时间）
    const holeIds = await pRepo.holesUsingProbe(tx, input.probeId);
    // 逐孔加锁重算，保证与其它写入串行
    for (const holeId of holeIds) {
      await lockHole(tx, holeId);
    }
    for (const holeId of holeIds) {
      await recomputeHole(tx, holeId, 'recalc', new Date());
    }
    return cal;
  });
}
