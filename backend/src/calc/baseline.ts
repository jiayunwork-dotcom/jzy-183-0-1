/**
 * 基准拼接（见 docs/ALGORITHM.md「基准与拼接」一节）。
 *
 * 选型：方案二——用换基准前后紧邻的两次测量，按深度估计一个「系统零偏」δ，
 * 再把新基准段的原始倾斜整体平移到旧段坐标系，而不是直接把旧段末测的
 * 整条累计剖面硬拷过来。
 *
 * δ_j = 新段首测原始倾斜_j − 旧段末测原始倾斜_j （rad，逐深度）
 * δ   = median_j(δ_j)
 *
 * 假设：换探头/修复瞬间地层未变，两次读数之差主要是探头零偏，
 * 且零偏对所有深度一视同仁；真正的变形只集中在少数深度，中位数将其排除。
 *
 * 代价：
 * - 若变化发生在多数深度（整体倾斜），中位数会把真实变形当成零偏吸收；
 * - 修复若改变了导管形状，多数深度都不同，δ 估计本身被污染，
 *   此时应在该段用 reason='repair' 并人工核对（系统仍给出 δ 并在剖面图标注）；
 * - 紧邻两次测量间隔内发生的局部变形，其深度点会在拼接处表现为台阶。
 */
import type { ReadingRow } from '../models/types.js';
import { median } from './math.js';

/** 某次测量逐深度（自上而下）的原始倾斜（rad），由读数与探头系数得出 */
export type RawTiltProfile = number[];

export function estimateSpliceBias(post: RawTiltProfile, pre: RawTiltProfile): number {
  const n = Math.min(post.length, pre.length);
  const diffs: number[] = [];
  for (let j = 0; j < n; j++) {
    diffs.push((post[j] as number) - (pre[j] as number));
  }
  return median(diffs);
}

/**
 * 计算各基准段相对 0 段坐标系的累积偏移 O_k（rad）：
 * O_0 = 0；O_k = O_{k-1} + δ_k。
 * 返回 segmentId -> { offset, delta(本段相对上段，0 段为 null) }。
 */
export function buildSegmentOffsets(
  orderedSegmentIds: number[],
  rawTiltBySegmentFirst: ReadonlyMap<number, RawTiltProfile>,
  rawTiltBySegmentLast: ReadonlyMap<number, RawTiltProfile>,
): Map<number, { offset: number; delta: number | null }> {
  const result = new Map<number, { offset: number; delta: number | null }>();
  let prevOffset = 0;
  orderedSegmentIds.forEach((segId, k) => {
    if (k === 0) {
      result.set(segId, { offset: 0, delta: null });
      return;
    }
    const post = rawTiltBySegmentFirst.get(segId);
    const preSegId = orderedSegmentIds[k - 1] as number;
    const pre = rawTiltBySegmentLast.get(preSegId);
    if (!post || !pre) {
      throw new Error(`基准段 ${segId} 缺少拼接所需的段首/上段末测数据`);
    }
    const delta = estimateSpliceBias(post, pre);
    prevOffset += delta;
    result.set(segId, { offset: prevOffset, delta });
  });
  return result;
}

/** 仅供测试与文档引用：逐深度拼接差（可用于展示离散程度） */
export function spliceResiduals(post: RawTiltProfile, pre: RawTiltProfile): number[] {
  const n = Math.min(post.length, pre.length);
  const out: number[] = [];
  for (let j = 0; j < n; j++) out.push((post[j] as number) - (pre[j] as number));
  return out;
}

export function _readingShapeGuard(rows: ReadingRow[]): void {
  if (rows.length === 0) throw new Error('测量没有任何读数行');
}
