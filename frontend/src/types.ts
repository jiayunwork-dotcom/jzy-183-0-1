export type WarnColor = 'blue' | 'yellow' | 'red' | null;

export interface Hole {
  id: number;
  code: string;
  depthM: number;
  spacingM: number;
  positiveDirection: string;
  checksumTolerance: number;
  createdAt: string;
  blue: number;
  yellow: number;
  red: number;
}

export interface Probe {
  id: number;
  code: string;
  note: string | null;
  calibrations: Calibration[];
}

export interface Calibration {
  id: number;
  probeId: number;
  factor: number;
  effectiveFrom: string;
  createdAt: string;
  note?: string | null;
}

export interface ReadingRow {
  depth: number;
  a: number;
  b: number;
  probeIdA: number;
  probeIdB: number;
}

export interface MeasurementListItem {
  id: number;
  holeId: number;
  measuredAt: string;
  isInitial: boolean;
  operator: string | null;
  note: string | null;
  revision: number;
  datumSegmentId: number | null;
  overallLevel: WarnColor;
  spliceDelta: number | null;
  displacement: number[] | null;
  rates: (number | null)[] | null;
  segmentSeq: number | null;
}

export interface Segment {
  id: number;
  seq: number;
  reason: 'initial' | 'probe_change' | 'repair' | 'reset';
  anchorMeasurementId: number | null;
  startedAt: string;
  note: string | null;
}

export interface ProfileSeries {
  measurementId: number;
  measuredAt: string;
  operator: string | null;
  isInitial: boolean;
  datumSegmentId: number;
  spliceDelta: number | null;
  displacement: number[];
  overallLevel: WarnColor;
}

export interface ProfileOverlay {
  hole: Pick<Hole, 'id' | 'code' | 'depthM' | 'spacingM' | 'positiveDirection'>;
  depths: number[];
  segments: Segment[];
  series: ProfileSeries[];
}

export interface TimePoint {
  measurementId: number;
  measuredAt: string;
  displacement: number | null;
  rate: number | null;
  overallLevel: WarnColor;
}

export interface TimeSeries {
  hole: Hole;
  depth: number;
  index: number;
  thresholds: { blue: number; yellow: number; red: number };
  points: TimePoint[];
}

export interface ChecksumPoint {
  depth: number;
  sum: number;
  residual: number;
  suspicious: boolean;
}

export interface LevelPoint {
  depth: number;
  displacement: number;
  rate: number | null;
  level: WarnColor;
}

export interface Snapshot {
  id: number;
  measurementId: number;
  holeId: number;
  reason: 'upload' | 'correct' | 'recalc';
  computedAt: string;
  fingerprint: string;
  overallLevel: WarnColor;
  points: LevelPoint[];
  checksums: ChecksumPoint[];
}

export interface MeasurementDetail {
  measurement: MeasurementListItem & {
    rows: ReadingRow[];
    createdAt: string;
    updatedAt: string;
  };
  latest: Snapshot | null;
  thenNow: {
    then: Snapshot | null;
    now: Snapshot | null;
    thenOverall: WarnColor;
    nowOverall: WarnColor;
    changed: boolean;
    diffs: Array<{
      depth: number;
      thenLevel: WarnColor;
      nowLevel: WarnColor;
      thenRate: number | null;
      nowRate: number | null;
    }>;
  };
  history: Snapshot[];
}

export interface OverviewRow {
  hole_id: number;
  code: string;
  measurement_id: number;
  measured_at: string;
  overall_level: WarnColor;
}
