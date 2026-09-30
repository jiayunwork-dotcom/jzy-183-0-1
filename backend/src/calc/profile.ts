/**
 * 单孔全量重算管线（唯一的剖面/速率/判级计算入口）。
 *
 * 增量更新与全量重算共用本函数：服务层在任何写入（上传、更正、补录、
 * 标定改期、基准变更）之后，以该孔当前全部输入调用本函数，
 * 得到的结果即为权威结果，并整体写回派生缓存。因此「增量 == 全量」
 * 由构造保证，测试用例 profile-consistency.test.ts 负责验证。
 */
import type {
  AssessmentSnapshot,
  ChecksumPoint,
  DatumSegment,
  LevelPoint,
  Measurement,
  ReadingRow,
  ThresholdSet,
  WarnColor,
} from '../models/types.js';
import { WARN_ORDER } from '../models/types.js';
import { factorAt, type CalibEntry } from './calibration.js';
import { daysBetween, maxWarn, robustResiduals } from './math.js';
import { buildSegmentOffsets, type RawTiltProfile } from './baseline.js';

export interface HoleCalcConfig {
  depthM: number;
  spacingM: number;
  thresholds: ThresholdSet;
  checksumTolerance: number;
}

export interface MeasurementComputeResult {
  measurementId: number;
  datumSegmentId: number;
  depths: number[]; // 行深度（测段顶端），自上而下
  /** 各测点累计位移剖面 mm，长度 = 行数+1：包含最底固定点 0 */
  displacementAtPoints: number[];
  /** 与各测点对应（长度=行数+1）的速率 mm/d；首测/同日为 null */
  ratesAtPoints: (number | null)[];
  levelPoints: LevelPoint[];
  checksums: ChecksumPoint[];
  overallLevel: WarnColor | null;
  rawTilt: RawTiltProfile;
  spliceDelta: number | null;
  /** 该测点行的逐行正反测系数（留痕/调试用） */
  factors: { fa: number; fb: number }[];
}

export interface HoleComputeResult {
  measurements: MeasurementComputeResult[];
  snapshots: AssessmentSnapshot[];
  segmentSplice: { segmentId: number; delta: number | null; offset: number }[];
}

function checkFinite(v: unknown, msg: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(msg);
  return v;
}

/**
 * 一行读数 → 该测段原始倾斜（rad 量级，按弧长≈弦长直接当正弦值用）。
 * 正反测读数本应大小相等、符号相反（在探头顶轮方向相反的意义下），
 * 故倾斜 = (a·fa − b·fb) / 2。
 */
export function rowTilt(row: ReadingRow, fa: number, fb: number): number {
  return (row.a * fa - row.b * fb) / 2;
}

/** 校核和：a·fa + b·fb（零偏时本应近似常数） */
export function rowChecksum(row: ReadingRow, fa: number, fb: number): number {
  return row.a * fa + row.b * fb;
}

function classify(rate: number | null, t: ThresholdSet): WarnColor | null {
  if (rate === null) return null;
  const v = Math.abs(rate);
  if (v >= t.red) return 'red';
  if (v >= t.yellow) return 'yellow';
  if (v >= t.blue) return 'blue';
  return null;
}

function simpleFingerprint(obj: unknown): string {
  // 不引入加密依赖：输入 JSON + 长度的 FNV-1a 足够识别「输入是否变了」
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length.toString(36);
}

export function computeHole(
  measurements: Measurement[],
  segments: DatumSegment[],
  calibrations: CalibEntry[],
  config: HoleCalcConfig,
  snapshotReason: AssessmentSnapshot['reason'] = 'recalc',
  computedAt: string = new Date(0).toISOString(),
): HoleComputeResult {
  if (measurements.length === 0) return { measurements: [], snapshots: [], segmentSplice: [] };
  if (segments.length === 0) throw new Error('该孔没有基准段');

  // 1) 测量按 (measured_at, created_at) 排序；归属基准段：段区间内。
  const sorted = [...measurements].sort(
    (p, q) => Date.parse(p.measuredAt) - Date.parse(q.measuredAt) || Date.parse(p.createdAt) - Date.parse(q.createdAt),
  );
  const segOrdered = [...segments].sort((p, q) => p.seq - q.seq);
  const segStartMs = segOrdered.map((s) => Date.parse(s.startedAt));

  const segOf = (m: Measurement): number => {
    const t = Date.parse(m.measuredAt);
    let idx = 0;
    for (let k = 0; k < segOrdered.length; k++) {
      if ((segStartMs[k] as number) <= t) idx = k;
    }
    return segOrdered[idx]!.id;
  };

  // 2) 逐测：行系数、原始倾斜、校核和。
  interface MIntermediate extends MeasurementComputeResult {
    measuredAt: string;
    createdAt: string;
  }
  const inter: MIntermediate[] = sorted.map((m) => {
    const rows = [...m.rows].sort((p, q) => p.depth - q.depth);
    const rawTilt: number[] = [];
    const checks: number[] = [];
    const factors: { fa: number; fb: number }[] = [];
    for (const r of rows) {
      const fa = factorAt(calibrations, r.probeIdA, m.measuredAt);
      const fb = factorAt(calibrations, r.probeIdB, m.measuredAt);
      checkFinite(fa, '标定系数非法');
      checkFinite(fb, '标定系数非法');
      rawTilt.push(rowTilt(r, fa, fb));
      checks.push(rowChecksum(r, fa, fb));
      factors.push({ fa, fb });
    }
    const depths = rows.map((r) => r.depth);
    const { residuals } = robustResiduals(checks);
    const checksums: ChecksumPoint[] = rows.map((r, j) => ({
      depth: r.depth,
      sum: checks[j]!,
      residual: residuals[j]!,
      suspicious: Math.abs(residuals[j]!) > config.checksumTolerance,
    }));
    return {
      measurementId: m.id,
      datumSegmentId: segOf(m),
      depths,
      displacementAtPoints: [],
      ratesAtPoints: [],
      levelPoints: [],
      checksums,
      overallLevel: null,
      rawTilt,
      spliceDelta: null,
      factors,
      measuredAt: m.measuredAt,
      createdAt: m.createdAt,
    };
  });

  // 3) 基准段偏移：每段第一测（新坐标系）与上一段最后一测（旧坐标系）。
  const firstBySeg = new Map<number, RawTiltProfile>();
  const lastBySeg = new Map<number, RawTiltProfile>();
  for (const mi of inter) {
    if (!firstBySeg.has(mi.datumSegmentId)) firstBySeg.set(mi.datumSegmentId, mi.rawTilt);
    lastBySeg.set(mi.datumSegmentId, mi.rawTilt);
  }
  const offsets = buildSegmentOffsets(
    segOrdered.map((s) => s.id),
    firstBySeg,
    lastBySeg,
  );

  // 4) 段基底拼接（方案二：中位数系统偏移，见 baseline.ts 文档）：
  //    base_0 = 0
  //    base_k(j) = base_{k-1}(j)
  //      + L·Σ_{r≥j}[raw_last_{k-1} − raw_first_{k-1}]_r        （上段末测自身变形）
  //      + L·Σ_{r≥j}[raw_first_k − raw_last_{k-1} − δ_k]_r      （换基准台阶的残差部分）
  //    δ_k = median_j(raw_first_k − raw_last_{k-1})，常数部分被减掉，
  //    即新探头零偏被吸收，段间不因换探头产生刚体台阶。
  const anchorRaw = new Map<number, RawTiltProfile>();
  for (const mi of inter) {
    if (!anchorRaw.has(mi.datumSegmentId)) anchorRaw.set(mi.datumSegmentId, mi.rawTilt);
  }

  const L = config.spacingM * 1000; // mm
  const nRows = inter[0]!.rawTilt.length;
  const pointsCount = nRows + 1;
  const cumsumBottom = (diff: number[]): number[] => {
    // diff[j] 为测段 j（顶端在测点 j）相对倾斜；自孔底测点 nRows 起向上累加
    const out = new Array<number>(pointsCount).fill(0);
    let acc = 0;
    for (let j = nRows - 1; j >= 0; j--) {
      acc += diff[j]! * L;
      out[j] = acc;
    }
    return out;
  };
  const addTo = (a: number[], b: number[]): number[] => a.map((v, j) => v + b[j]!);

  const segBaseProfile = new Map<number, number[]>();
  segBaseProfile.set(segOrdered[0]!.id, new Array<number>(pointsCount).fill(0));
  for (let k = 1; k < segOrdered.length; k++) {
    const seg = segOrdered[k]!;
    const prevSeg = segOrdered[k - 1]!;
    const firstNew = firstBySeg.get(seg.id)!;
    const lastPrev = lastBySeg.get(prevSeg.id)!;
    const firstPrev = firstBySeg.get(prevSeg.id)!;
    const delta = offsets.get(seg.id)!.delta!;
    let base = segBaseProfile.get(prevSeg.id)!.slice();
    const relPrev = cumsumBottom(lastPrev.map((v, j) => v - firstPrev[j]!));
    const stitch = cumsumBottom(firstNew.map((v, j) => v - lastPrev[j]! - delta));
    base = addTo(base, relPrev);
    base = addTo(base, stitch);
    base[nRows] = 0; // 孔底固定点恒为 0
    segBaseProfile.set(seg.id, base);
  }

  // 5) 逐测点累计位移：段内相对首测 + 段基底
  for (const mi of inter) {
    const anchor = anchorRaw.get(mi.datumSegmentId)!;
    const base = segBaseProfile.get(mi.datumSegmentId)!;
    const rel = cumsumBottom(mi.rawTilt.map((v, j) => v - anchor[j]!));
    mi.displacementAtPoints = addTo(base, rel);
  }

  // 6) 段拼接 δ 挂到各段第一测上（前端剖面图标注用）
  const firstMeasurements = new Set<number>();
  for (const mi of inter) {
    if (firstBySeg.get(mi.datumSegmentId) === mi.rawTilt) firstMeasurements.add(mi.measurementId);
  }
  for (const mi of inter) {
    if (firstMeasurements.has(mi.measurementId)) {
      mi.spliceDelta = offsets.get(mi.datumSegmentId)!.delta;
    }
  }

  // 7) 速率与判级（相对上一测，按天数折算；同日不折速率）
  for (let i = 0; i < inter.length; i++) {
    const mi = inter[i]!;
    const rates: (number | null)[] = new Array(pointsCount).fill(null);
    if (i > 0) {
      const prev = inter[i - 1]!;
      const dt = daysBetween(prev.measuredAt, mi.measuredAt);
      if (dt > 0) {
        for (let j = 0; j < pointsCount; j++) {
          rates[j] = (mi.displacementAtPoints[j]! - prev.displacementAtPoints[j]!) / dt;
        }
      }
    }
    mi.ratesAtPoints = rates;
    const levelPoints: LevelPoint[] = [];
    let overall: WarnColor | null = null;
    for (let j = 0; j < nRows; j++) {
      // 行深度对应测点 j（测段顶端），孔底点不出现在行列表中
      const rate = rates[j] ?? null;
      const level = classify(rate, config.thresholds);
      levelPoints.push({
        depth: mi.depths[j]!,
        displacement: mi.displacementAtPoints[j]!,
        rate,
        level,
      });
      overall = maxWarn(overall, level);
    }
    mi.levelPoints = levelPoints;
    mi.overallLevel = overall;
  }

  // 8) 快照（每次重算每个测量一份，判级留痕）
  const snapshots: AssessmentSnapshot[] = inter.map((mi) => ({
    measurementId: mi.measurementId,
    holeId: sorted.find((m) => m.id === mi.measurementId)!.holeId,
    reason: snapshotReason,
    computedAt,
    fingerprint: simpleFingerprint({
      m: sorted.find((m) => m.id === mi.measurementId),
      cal: calibrations,
      seg: segOrdered,
      cfg: config,
    }),
    overallLevel: mi.overallLevel,
    points: mi.levelPoints,
    checksums: mi.checksums,
  }));

  return {
    measurements: inter.map(({ measuredAt: _a, createdAt: _b, ...rest }) => rest),
    snapshots,
    segmentSplice: segOrdered.map((s) => ({
      segmentId: s.id,
      delta: offsets.get(s.id)!.delta,
      offset: offsets.get(s.id)!.offset,
    })),
  };
}

export { WARN_ORDER };
