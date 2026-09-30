/** 小工具数学函数 */
import type { WarnColor } from '../models/types.js';
import { WARN_ORDER } from '../models/types.js';

export function median(values: number[]): number {
  const xs = [...values].filter((v) => Number.isFinite(v)).sort((p, q) => p - q);
  const n = xs.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? (xs[mid] as number) : ((xs[mid - 1] as number) + (xs[mid] as number)) / 2;
}

/**
 * 校核和居中：残差 = 该深度校核和 − 本次测量各深度校核和中位数。
 * 可疑判定（|残差| > 容差）放在上层，容差按孔配置。
 */
export function robustResiduals(values: number[]): { center: number; residuals: number[] } {
  const center = median(values);
  return { center, residuals: values.map((v) => v - center) };
}

export function daysBetween(t1: string, t2: string): number {
  return (Date.parse(t2) - Date.parse(t1)) / 86_400_000;
}

export function maxWarn(a: WarnColor | null, b: WarnColor | null): WarnColor | null {
  const rank = (c: WarnColor | null) => (c === null ? -1 : WARN_ORDER.indexOf(c));
  return rank(b) > rank(a) ? b : a;
}
