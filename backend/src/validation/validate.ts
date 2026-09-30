/**
 * 录入校验。所有拒收错误都带具体字段与原因，由路由层转 400。
 */
import type { Hole, ReadingRow, ThresholdSet } from '../models/types.js';

export interface FieldError {
  field: string;
  message: string;
  index?: number;
}

export class ValidationError extends Error {
  constructor(public errors: FieldError[]) {
    super(errors.map((e) => `${e.field}${e.index !== undefined ? `[${e.index}]` : ''}: ${e.message}`).join('; '));
    this.name = 'ValidationError';
  }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 阈值必须严格递增且为有限正数（blue < yellow < red） */
export function validateThresholds(t: Partial<ThresholdSet>): ThresholdSet {
  const errs: FieldError[] = [];
  const vals = [
    ['blue', t.blue],
    ['yellow', t.yellow],
    ['red', t.red],
  ] as const;
  for (const [name, v] of vals) {
    if (!finite(v)) errs.push({ field: `thresholds.${name}`, message: '必须是有限数' });
  }
  if (errs.length === 0) {
    const blue = t.blue as number;
    const yellow = t.yellow as number;
    const red = t.red as number;
    if (!(blue > 0)) errs.push({ field: 'thresholds.blue', message: '必须大于 0' });
    if (!(blue < yellow)) errs.push({ field: 'thresholds.yellow', message: `必须大于蓝色阈值 ${blue}` });
    if (!(yellow < red)) errs.push({ field: 'thresholds.red', message: `必须大于黄色阈值 ${yellow}` });
  }
  if (errs.length) throw new ValidationError(errs);
  return { blue: t.blue as number, yellow: t.yellow as number, red: t.red as number };
}

/** 测孔属性校验 */
export function validateHole(input: {
  code?: unknown;
  depthM?: unknown;
  spacingM?: unknown;
  positiveDirection?: unknown;
  checksumTolerance?: unknown;
  thresholds?: Partial<ThresholdSet>;
}): { code: string; depthM: number; spacingM: number; positiveDirection: string; checksumTolerance: number; thresholds: ThresholdSet } {
  const errs: FieldError[] = [];
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!code) errs.push({ field: 'code', message: '编号不能为空' });
  if (!finite(input.depthM) || input.depthM <= 0) errs.push({ field: 'depthM', message: '孔深必须是正数' });
  if (!finite(input.spacingM) || input.spacingM <= 0) errs.push({ field: 'spacingM', message: '测点间距必须是正数' });
  const dir = typeof input.positiveDirection === 'string' ? input.positiveDirection.trim() : '';
  if (!dir) errs.push({ field: 'positiveDirection', message: '正方向朝向不能为空' });
  if (input.checksumTolerance !== undefined && (!finite(input.checksumTolerance) || input.checksumTolerance < 0)) {
    errs.push({ field: 'checksumTolerance', message: '校核和容差必须是非负数' });
  }
  let thresholds!: ThresholdSet;
  try {
    thresholds = validateThresholds(input.thresholds ?? {});
  } catch (e) {
    if (e instanceof ValidationError) errs.push(...e.errors);
    else throw e;
  }
  if (errs.length) throw new ValidationError(errs);
  return {
    code,
    depthM: input.depthM as number,
    spacingM: input.spacingM as number,
    positiveDirection: dir,
    checksumTolerance: (input.checksumTolerance as number | undefined) ?? 0,
    thresholds,
  };
}

const EPS = 1e-9;

/**
 * 一次测量的读数行校验：
 * - 深度等间距（等于 spacingM）、覆盖 0 .. depthM-spacingM（行数 = depthM/spacingM）；
 * - 同一深度只出现一次；
 * - 读数必须是有限数；
 * - 探头必须已登记（registeredProbeIds）且在 measuredAt 有生效标定（probeReadyAt 给出每探头最早生效时间）；
 * - 测量日期不得早于该孔初始测量。
 */
export function validateMeasurementRows(input: {
  rows: Array<Partial<ReadingRow>>;
  measuredAt: string;
  hole: Pick<Hole, 'depthM' | 'spacingM'>;
  registeredProbeIds: Set<number>;
  calibrationReadyAt: Map<number, string>;
  initialMeasuredAt: string | null;
}): ReadingRow[] {
  const errs: FieldError[] = [];
  const { rows, hole } = input;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ValidationError([{ field: 'rows', message: '至少需要一行读数' }]);
  }

  const expectedCount = Math.round(hole.depthM / hole.spacingM);
  if (Math.abs(expectedCount * hole.spacingM - hole.depthM) > 1e-6) {
    errs.push({
      field: 'depthM',
      message: `孔深 ${hole.depthM} 不是测点间距 ${hole.spacingM} 的整数倍，无法形成等间距深度序列`,
    });
  }

  // 逐行字段校验
  rows.forEach((r, i) => {
    if (!finite(r.depth)) errs.push({ field: 'depth', index: i, message: '深度必须是有限数' });
    if (!finite(r.a)) errs.push({ field: 'a', index: i, message: '正测读数必须是有限数' });
    if (!finite(r.b)) errs.push({ field: 'b', index: i, message: '反测读数必须是有限数' });
    if (typeof r.probeIdA !== 'number' || !input.registeredProbeIds.has(r.probeIdA)) {
      errs.push({ field: 'probeIdA', index: i, message: `探头编号 ${r.probeIdA} 未登记` });
    }
    if (typeof r.probeIdB !== 'number' || !input.registeredProbeIds.has(r.probeIdB)) {
      errs.push({ field: 'probeIdB', index: i, message: `探头编号 ${r.probeIdB} 未登记` });
    }
  });

  // 结构校验需要合法深度
  const validDepthRows = rows.filter((r): r is ReadingRow => finite(r.depth) && finite(r.a) && finite(r.b));
  const seen = new Map<number, number>();
  for (const r of validDepthRows) {
    const key = Math.round(r.depth / hole.spacingM);
    const prior = seen.get(key);
    if (prior !== undefined) {
      errs.push({ field: 'depth', message: `深度 ${r.depth} 与第 ${prior} 行重复：同一深度出现两次` });
    } else {
      seen.set(key, rows.indexOf(r));
    }
  }
  if (validDepthRows.length === rows.length && errs.filter((e) => e.field === 'depthM').length === 0) {
    const depths = validDepthRows.map((r) => r.depth).sort((p, q) => p - q);
    if (depths.length !== expectedCount) {
      errs.push({
        field: 'rows',
        message: `读数行数 ${depths.length} 与孔深不符：按间距 ${hole.spacingM} m 应有 ${expectedCount} 个测点`,
      });
    } else {
      for (let k = 0; k < expectedCount; k++) {
        const expected = +(k * hole.spacingM).toFixed(6);
        const got = +(depths[k] as number).toFixed(6);
        if (Math.abs(got - expected) > EPS) {
          errs.push({
            field: 'depth',
            message: `深度序列不等间距或与孔深不符：第 ${k} 个测点应为 ${expected} m，实际 ${got} m`,
          });
          break;
        }
      }
    }
  }

  // 探头在测量日期是否有生效标定
  if (!Number.isNaN(Date.parse(input.measuredAt))) {
    for (const r of validDepthRows) {
      for (const pid of [r.probeIdA, r.probeIdB]) {
        const ready = input.calibrationReadyAt.get(pid);
        if (ready !== undefined && Date.parse(ready) > Date.parse(input.measuredAt)) {
          errs.push({
            field: 'probeIdA',
            message: `探头 ${pid} 在 ${input.measuredAt} 尚无生效标定（最早 ${ready}）`,
          });
        }
      }
    }
    if (input.initialMeasuredAt && Date.parse(input.measuredAt) < Date.parse(input.initialMeasuredAt)) {
      errs.push({
        field: 'measuredAt',
        message: `测量日期 ${input.measuredAt} 早于该孔初始测量 ${input.initialMeasuredAt}`,
      });
    }
  } else {
    errs.push({ field: 'measuredAt', message: '测量日期无法解析' });
  }

  if (errs.length) throw new ValidationError(errs);
  return validDepthRows.map((r) => ({ ...r })).sort((p, q) => p.depth - q.depth);
}
