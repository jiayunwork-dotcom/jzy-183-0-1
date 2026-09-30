<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api';
import type { Hole, MeasurementListItem, Probe } from '../types';
import LevelBadge from '../components/LevelBadge.vue';

const props = defineProps<{ id: string }>();
const holeId = computed(() => Number(props.id));

const hole = ref<Hole | null>(null);
const measurements = ref<MeasurementListItem[]>([]);
const probes = ref<Probe[]>([]);
const err = ref('');
const ok = ref('');

const upload = ref({
  measuredAt: '',
  operator: '',
  note: '',
  text: '',
  defaultProbeId: undefined as number | undefined,
  newDatum: false,
  datumReason: 'probe_change' as 'probe_change' | 'repair' | 'reset',
});
const busy = ref(false);

async function load() {
  [hole.value, measurements.value, probes.value] = await Promise.all([
    api.listHoles().then((hs) => hs.find((h) => h.id === holeId.value) ?? null),
    api.listMeasurements(holeId.value),
    api.listProbes(),
  ]);
  if (!upload.value.defaultProbeId && probes.value[0]) upload.value.defaultProbeId = probes.value[0].id;
}
onMounted(load);
watch(holeId, load);

function sampleTemplate(): string {
  if (!hole.value) return '';
  const n = Math.round(hole.value.depthM / hole.value.spacingM);
  return Array.from({ length: n }, (_, k) => `${(k * hole.value!.spacingM).toFixed(1)}, 0, 0`).join('\n');
}

async function submitUpload() {
  err.value = '';
  ok.value = '';
  busy.value = true;
  try {
    await api.uploadMeasurement(holeId.value, {
      measuredAt: new Date(upload.value.measuredAt).toISOString(),
      operator: upload.value.operator || null,
      note: upload.value.note || null,
      text: upload.value.text,
      defaultProbeId: upload.value.defaultProbeId,
      newDatum: upload.value.newDatum
        ? { reason: upload.value.datumReason, note: upload.value.note || null }
        : undefined,
    });
    ok.value = '上传成功，剖面/速率/预警已重算。';
    upload.value.text = '';
    await load();
  } catch (e) {
    if (e instanceof ApiError) err.value = e.fields?.map((f) => `• ${f.field}${f.index !== undefined ? `[${f.index}]` : ''}：${f.message}`).join('\n') ?? e.message;
  } finally {
    busy.value = false;
  }
}

function fmt(t: string) {
  return t?.replace('T', ' ').slice(0, 16);
}
</script>

<template>
  <div v-if="hole" class="panel">
    <h2>
      {{ hole.code }}
      <span class="muted small">
        孔深 {{ hole.depthM }} m · 间距 {{ hole.spacingM }} m · 正方向 {{ hole.positiveDirection }} ·
        阈值 <span class="badge blue">{{ hole.blue }}</span>
        <span class="badge yellow">{{ hole.yellow }}</span>
        <span class="badge red">{{ hole.red }}</span> mm/d
      </span>
    </h2>
    <p class="small">
      <RouterLink :to="`/holes/${hole.id}/profile`">位移剖面叠加图</RouterLink> ·
      <RouterLink :to="`/holes/${hole.id}/time-series`">深度-时程曲线</RouterLink>
    </p>
  </div>

  <div class="panel">
    <h2>上传一次测量（逐行文本或表格粘贴：深度, 正测, 反测[, 探头A, 探头B]）</h2>
    <div v-if="err" class="error-box">{{ err }}</div>
    <div v-if="ok" class="ok-box">{{ ok }}</div>
    <div class="row" style="margin-bottom: 10px">
      <label class="field">测量日期时间
        <input type="datetime-local" v-model="upload.measuredAt" />
      </label>
      <label class="field">默认探头（行内不填探头时用）
        <select v-model="upload.defaultProbeId">
          <option v-for="p in probes" :key="p.id" :value="p.id">{{ p.code }}</option>
        </select>
      </label>
      <label class="field">测量人
        <input v-model="upload.operator" />
      </label>
      <label class="field" style="flex-direction: row; align-items: center; gap: 6px">
        <input type="checkbox" v-model="upload.newDatum" /> 本次为新基准首测
      </label>
      <label class="field" v-if="upload.newDatum">换基准原因
        <select v-model="upload.datumReason">
          <option value="probe_change">更换探头</option>
          <option value="repair">测斜管修复</option>
          <option value="reset">正式重设初始</option>
        </select>
      </label>
      <button class="secondary" type="button" @click="upload.text = sampleTemplate()">填入深度模板</button>
    </div>
    <textarea class="raw" v-model="upload.text" placeholder="0, 12.3, -12.1&#10;0.5, 12.0, -11.9&#10;…"></textarea>
    <div style="margin-top: 8px">
      <button :disabled="busy" @click="submitUpload">上传并计算</button>
    </div>
  </div>

  <div class="panel">
    <h2>测量记录（{{ measurements.length }}）</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>测量时间</th><th>测量人</th><th>基准段</th>
          <th>整测等级</th><th>revision</th><th>备注</th><th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(m, i) in measurements" :key="m.id">
          <td>{{ i + 1 }}<span v-if="m.isInitial" class="small muted">（初始）</span></td>
          <td>{{ fmt(m.measuredAt) }}</td>
          <td>{{ m.operator ?? '' }}</td>
          <td>第 {{ (m.segmentSeq ?? 0) + 1 }} 段<span v-if="m.spliceDelta !== null" class="small muted">（基准切换点）</span></td>
          <td><LevelBadge :level="m.overallLevel" /></td>
          <td>{{ m.revision }}</td>
          <td class="small">{{ m.note ?? '' }}</td>
          <td>
            <RouterLink :to="`/measurements/${m.id}`">校核和 / 更正 / 历史判级</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="small muted" style="margin-bottom: 0">
      补录：在中间日期直接上传即自动按时间插入，前后两次速率会按新顺序重算；
      补录早于初始测量的日期会被拒收。
    </p>
  </div>
</template>
