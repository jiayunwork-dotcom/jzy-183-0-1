/**
 * 探头标定版本：系数按生效时间保留版本。
 * 某次测量某行某方向使用的系数 = 该探头 effective_from <= measuredAt
 * 的最新一条标定。测量时行内记录探头编号，系数取值只取决于「测量日期」。
 *
 * 因此重新标定（新版本生效时间在未来）不会改写历史测量；
 * 若要更正历史标定，应新增一条 effective_from 指向过去的版本，
 * 系统随后对受影响测量做级联重算并留痕。
 */

export interface CalibEntry {
  probeId: number;
  factor: number;
  effectiveFrom: string;
}

export function factorAt(entries: CalibEntry[], probeId: number, at: string): number {
  let chosen: CalibEntry | null = null;
  for (const e of entries) {
    if (e.probeId !== probeId) continue;
    if (Date.parse(e.effectiveFrom) <= Date.parse(at)) {
      if (!chosen || Date.parse(e.effectiveFrom) > Date.parse(chosen.effectiveFrom)) chosen = e;
    }
  }
  if (!chosen) throw new UnknownCalibrationError(probeId, at);
  return chosen.factor;
}

export class UnknownCalibrationError extends Error {
  constructor(
    public probeId: number,
    public at: string,
  ) {
    super(`探头 ${probeId} 在 ${at} 没有生效的标定记录`);
    this.name = 'UnknownCalibrationError';
  }
}
