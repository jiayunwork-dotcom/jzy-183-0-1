import type {
  Hole,
  MeasurementDetail,
  MeasurementListItem,
  OverviewRow,
  ProfileOverlay,
  Probe,
  Segment,
  TimeSeries,
} from './types';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Array<{ field: string; message: string; index?: number }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? res.statusText, data?.fields);
  }
  return data as T;
}

export const api = {
  overview: () => request<OverviewRow[]>('/overview'),

  listHoles: () => request<Hole[]>('/holes'),
  createHole: (body: unknown) =>
    request<Hole>('/holes', { method: 'POST', body: JSON.stringify(body) }),
  updateHole: (id: number, body: unknown) =>
    request<Hole>(`/holes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  segments: (holeId: number) => request<Segment[]>(`/holes/${holeId}/segments`),

  listProbes: () => request<Probe[]>('/probes'),
  createProbe: (body: unknown) => request<Probe>('/probes', { method: 'POST', body: JSON.stringify(body) }),
  addCalibration: (body: unknown) =>
    request<unknown>('/calibrations', { method: 'POST', body: JSON.stringify(body) }),

  listMeasurements: (holeId: number) =>
    request<MeasurementListItem[]>(`/holes/${holeId}/measurements`),
  uploadMeasurement: (holeId: number, body: unknown) =>
    request<unknown>(`/holes/${holeId}/measurements`, { method: 'POST', body: JSON.stringify(body) }),
  measurement: (id: number) => request<MeasurementDetail>(`/measurements/${id}`),
  correctMeasurement: (id: number, body: unknown) =>
    request<unknown>(`/measurements/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  measurementHistory: (id: number) =>
    request<MeasurementDetail['thenNow']>(`/measurements/${id}/history`),

  profile: (holeId: number, ids: number[] | 'all') =>
    request<ProfileOverlay>(`/holes/${holeId}/profile${ids === 'all' ? '' : `?ids=${ids.join(',')}`}`),
  timeSeries: (holeId: number, depth: number) =>
    request<TimeSeries>(`/holes/${holeId}/time-series?depth=${depth}`),
};
