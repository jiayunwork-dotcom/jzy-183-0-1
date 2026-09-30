/**
 * 测量文本解析：支持逐行文本或表格粘贴。
 * 每行 3~5 列（空白、逗号、Tab、分号均可分隔）：
 *   depth, a, b [, probeIdA [, probeIdB]]
 * 未给探头列时使用默认探头（表单选择的当前探头）。
 * 以 #、// 开头或无法解析的行忽略（空行同理），表头行若非纯数字自动跳过。
 */
import type { ReadingRow } from '../models/types.js';

export interface ParseResult {
  rows: Array<Partial<ReadingRow>>;
  skippedLines: number;
}

export function parseReadingText(text: string, defaultProbeId?: number): ParseResult {
  const rows: Array<Partial<ReadingRow>> = [];
  let skippedLines = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(/[\t,;\s]+/).filter(Boolean);
    if (parts.length < 3) {
      skippedLines++;
      continue;
    }
    const nums = parts.map(Number);
    if (!nums.every((n) => Number.isFinite(n))) {
      // 表头或其它非数字行
      skippedLines++;
      continue;
    }
    const [depth, a, b, pa, pb] = nums;
    rows.push({
      depth,
      a,
      b,
      probeIdA: pa ?? defaultProbeId,
      probeIdB: pb ?? pa ?? defaultProbeId,
    });
  }
  return { rows, skippedLines };
}
