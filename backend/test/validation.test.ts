import { describe, expect, it } from 'vitest';
import { ValidationError, validateMeasurementRows, validateThresholds, validateHole } from '../src/validation/validate.js';
import { parseReadingText } from '../src/validation/parseText.js';
import type { ReadingRow } from '../src/models/types.js';

const hole = { depthM: 1.5, spacingM: 0.5 } as const;
const registered = new Set([7]);
const ready = new Map([[7, '2020-01-01T00:00:00Z']]);

const row = (depth: number, patch: Partial<ReadingRow> = {}): Partial<ReadingRow> => ({
  depth,
  a: 1,
  b: -1,
  probeIdA: 7,
  probeIdB: 7,
  ...patch,
});

function expectErrors(fn: () => unknown, fields: string[]) {
  try {
    fn();
    throw new Error('应当拒收，但通过了');
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    const errs = (e as ValidationError).errors.map((x) => x.field);
    for (const f of fields) expect(errs).toContain(f);
  }
}

describe('阈值校验', () => {
  it('阈值不是严格递增时给出具体字段', () => {
    expectErrors(() => validateThresholds({ blue: 5, yellow: 5, red: 10 }), ['thresholds.yellow']);
    expectErrors(() => validateThresholds({ blue: 6, yellow: 5, red: 10 }), ['thresholds.yellow']);
    expectErrors(() => validateThresholds({ blue: 1, yellow: 8, red: 8 }), ['thresholds.red']);
    expectErrors(() => validateThresholds({ blue: NaN, yellow: 5, red: 10 }), ['thresholds.blue']);
  });

  it('合法阈值通过', () => {
    expect(validateThresholds({ blue: 2, yellow: 5, red: 10 })).toEqual({ blue: 2, yellow: 5, red: 10 });
  });

  it('测孔其它字段', () => {
    expectErrors(
      () => validateHole({ code: ' ', depthM: 0, spacingM: 0.5, positiveDirection: '', thresholds: { blue: 2, yellow: 5, red: 10 } }),
      ['code', 'depthM', 'positiveDirection'],
    );
  });
});

describe('测量行校验（六类拒收）', () => {
  it('深度序列不等间距或与孔深不符', () => {
    expectErrors(
      () =>
        validateMeasurementRows({
          rows: [row(0), row(0.4), row(1.0)],
          measuredAt: '2026-01-02T00:00:00Z',
          hole,
          registeredProbeIds: registered,
          calibrationReadyAt: ready,
          initialMeasuredAt: null,
        }),
      ['depth'],
    );
    expectErrors(
      () =>
        validateMeasurementRows({
          rows: [row(0), row(0.5)],
          measuredAt: '2026-01-02T00:00:00Z',
          hole,
          registeredProbeIds: registered,
          calibrationReadyAt: ready,
          initialMeasuredAt: null,
        }),
      ['rows'],
    );
  });

  it('同一深度出现两次', () => {
    expectErrors(
      () =>
        validateMeasurementRows({
          rows: [row(0), row(0.5), row(0.5)],
          measuredAt: '2026-01-02T00:00:00Z',
          hole,
          registeredProbeIds: registered,
          calibrationReadyAt: ready,
          initialMeasuredAt: null,
        }),
      ['depth'],
    );
  });

  it('读数不是有限数', () => {
    expectErrors(
      () =>
        validateMeasurementRows({
          rows: [row(0, { a: NaN }), row(0.5, { b: Infinity }), row(1.0)],
          measuredAt: '2026-01-02T00:00:00Z',
          hole,
          registeredProbeIds: registered,
          calibrationReadyAt: ready,
          initialMeasuredAt: null,
        }),
      ['a', 'b'],
    );
  });

  it('测量日期早于该孔初始测量', () => {
    expectErrors(
      () =>
        validateMeasurementRows({
          rows: [row(0), row(0.5), row(1.0)],
          measuredAt: '2025-12-31T00:00:00Z',
          hole,
          registeredProbeIds: registered,
          calibrationReadyAt: ready,
          initialMeasuredAt: '2026-01-01T00:00:00Z',
        }),
      ['measuredAt'],
    );
  });

  it('探头编号没有登记', () => {
    expectErrors(
      () =>
        validateMeasurementRows({
          rows: [row(0, { probeIdA: 99 }), row(0.5, { probeIdB: 98 }), row(1.0)],
          measuredAt: '2026-01-02T00:00:00Z',
          hole,
          registeredProbeIds: registered,
          calibrationReadyAt: ready,
          initialMeasuredAt: null,
        }),
      ['probeIdA', 'probeIdB'],
    );
  });

  it('合法输入通过并排序', () => {
    const out = validateMeasurementRows({
      rows: [row(1.0), row(0.5), row(0)],
      measuredAt: '2026-01-02T00:00:00Z',
      hole,
      registeredProbeIds: registered,
      calibrationReadyAt: ready,
      initialMeasuredAt: null,
    });
    expect(out.map((r) => r.depth)).toEqual([0, 0.5, 1.0]);
  });
});

describe('文本解析', () => {
  it('支持逗号/空白/Tab 分隔与默认探头', () => {
    const text = `depth a b
0, 1.2, -1.1
0.5  1.3 -1.2
1.0;1.4;-1.3`;
    const { rows, skippedLines } = parseReadingText(text, 7);
    expect(skippedLines).toBe(1); // 表头
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ depth: 0, a: 1.2, b: -1.1, probeIdA: 7, probeIdB: 7 });
  });

  it('支持显式探头列', () => {
    const { rows } = parseReadingText('0 1 2 8\n0.5 1 2 8 9', 7);
    expect(rows[0]).toMatchObject({ probeIdA: 8, probeIdB: 8 });
    expect(rows[1]).toMatchObject({ probeIdA: 8, probeIdB: 9 });
  });
});
