/**
 * 领域模型（与存储无关）。
 *
 * 约定（详见 docs/ALGORITHM.md）：
 * - 测点深度统一按「从孔口往下」递增排列，间距必须等于测点间距 s（通常 0.5 m）。
 * - 第 j 行读数代表测段 j 的倾斜：该测段为「测点 j → 测点 j+1」，
 *   即其顶端在深度 d_j、底端在 d_j+1。最底一行对应贴底测段。
 * - 孔底为固定点（位移 0），从孔底向上逐段累加。
 */

export type WarnColor = 'blue' | 'yellow' | 'red';
export const WARN_ORDER: WarnColor[] = ['blue', 'yellow', 'red'];

export interface ThresholdSet {
  /** 严格递增；长度 3，蓝 < 黄 < 红，单位 mm/d */
  blue: number;
  yellow: number;
  red: number;
}

export interface Hole {
  id: number;
  code: string;
  /** 孔深 m（孔口到孔底固定点） */
  depthM: number;
  /** 测点间距 m，通常 0.5 */
  spacingM: number;
  /** 正方向朝向，自由文本，如 N30°E */
  positiveDirection: string;
  /** 校核和可疑判定容差：|残差| 超过该值判可疑，单位与读数一致（无量纲读数单位） */
  checksumTolerance: number;
  createdAt: string;
}

export interface Probe {
  id: number;
  code: string;
  note: string | null;
}

export interface Calibration {
  id: number;
  probeId: number;
  /** 标定系数：读数（角度制或格值）→ 倾斜正弦 的换算因子，单位 1/读数单位 */
  factor: number;
  /** 生效时刻（含） */
  effectiveFrom: string;
  createdAt: string;
}

export type DatumReason = 'initial' | 'probe_change' | 'repair' | 'reset';

export interface DatumSegment {
  id: number;
  holeId: number;
  /** 段序号，从 0 开始递增 */
  seq: number;
  reason: DatumReason;
  /** 产生该基准的那次测量（initial/reset 段：以此为零基准；probe_change：旧段末测仍在旧段） */
  anchorMeasurementId: number | null;
  startedAt: string;
  note: string | null;
}

/** 一行读数（某深度的正反测） */
export interface ReadingRow {
  /** 深度 m，从孔口往下 */
  depth: number;
  /** 正测读数 */
  a: number;
  /** 反测读数 */
  b: number;
  /** 正测所用探头 */
  probeIdA: number;
  /** 反测所用探头 */
  probeIdB: number;
}

export interface Measurement {
  id: number;
  holeId: number;
  /** 业务测量日期（同日补录靠 created_at 排序） */
  measuredAt: string;
  /** 初始测量标记 */
  isInitial: boolean;
  /** 上传/录入者 */
  operator: string | null;
  note: string | null;
  /** 乐观锁版本号 */
  revision: number;
  createdAt: string;
  updatedAt: string;
  rows: ReadingRow[];
}

/** 某深度点的校核和结果 */
export interface ChecksumPoint {
  depth: number;
  sum: number;
  residual: number;
  suspicious: boolean;
}

/** 某深度点的当次快照判级 */
export interface LevelPoint {
  depth: number;
  /** mm，相对初始（已拼接）的累计位移 */
  displacement: number;
  /** mm/d，与上一测的速率；首测或同日为 null */
  rate: number | null;
  /** 该深度达到的颜色；未达阈值或无速率为 null */
  level: WarnColor | null;
}

/** 一次测量的计算快照（判级留痕用） */
export interface AssessmentSnapshot {
  measurementId: number;
  holeId: number;
  /** 本次重算的触发原因 */
  reason: 'upload' | 'correct' | 'recalc';
  /** 重算发生时刻（作为「当时判级」的时间轴） */
  computedAt: string;
  /** 输入指纹，便于辨别差异来源 */
  fingerprint: string;
  /** 整测判级：各深度速率等级取最高 */
  overallLevel: WarnColor | null;
  points: LevelPoint[];
  checksums: ChecksumPoint[];
}

export interface MeasurementView extends Measurement {
  datumSegmentId: number;
  /** 拼接后相对初始的累计位移剖面（按深度自上而下，长度 = 行数+1，末点为孔底 0） */
  displacement: number[];
  /** 与上一测速率（mm/d），与行数对应；首测/同日 null */
  rates: (number | null)[];
  overallLevel: WarnColor | null;
  checksums: ChecksumPoint[];
  /** 该测参与的基准拼接 δ（rad），非段首为 null */
  spliceBias: number | null;
}
