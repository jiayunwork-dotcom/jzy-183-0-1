<script setup lang="ts">
import { onMounted, ref } from 'vue';
import * as echarts from 'echarts';
import { api, ApiError } from '../api';
import type { MeasurementDetail, Probe } from '../types';
import LevelBadge from '../components/LevelBadge.vue';
import EChart from '../components/EChart.vue';

const props = defineProps<{ id: string }>();
const detail = ref<MeasurementDetail | null>(null);
const probes = ref<Probe[]>([]);
const err = ref('');
const ok = ref('');
const editing = ref(false);
const edit = ref({
  measuredAt: '',
  operator: '',
  note: '',
  text: '',
  defaultProbeId: undefined as number | undefined,
});
const busy = ref(false);

async function load() {
  detail.value = await api.measurement(Number(props.id));
  probes.value = await api.listProbes();
  const m = detail.value.measurement;
  edit.value.measuredAt = m.measuredAt.slice(0, 16);
  edit.value.operator = m.operator ?? '';
  edit.value.note = m.note ?? '';
  edit.value.text = m.rows.map((r) => `${r.depth}, ${r.a}, ${r.b}, ${r.probeIdA}, ${r.probeIdB}`).join('\n');
  edit.value.defaultProbeId = m.rows[0]?.probeIdA ?? probes.value[0]?.id;
}
onMounted(load);

function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

async function submitCorrection() {
  err.value = '';
  ok.value = '';
  busy.value = true;
  try {
    // expectedRevision 必须携带当前版本；并发时服务端返回 409
    await api.correctMeasurement(Number(props.id), {
      expectedRevision: detail.value!.measurement.revision,
      actor: edit.value.operator || 'anonymous',
      measuredAt: new Date(edit.value.measuredAt).toISOString(),
      note: edit.value.note || null,
      text: edit.value.text,
      defaultProbeId: edit.value.defaultProbeId,
    });
    ok.value = '更正已生效，全孔剖面/速率/预警已重算；旧判级保留在历史中。';
    editing.value = false;
    await load();
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409) {
        err.value = `⚠ ${e.message}\n请刷新页面获取最新数据后再提交，您的本次更正没有覆盖任何人。`;
      } else {
        err.value = e.fields?.map((f) => `• ${f.field}${f.index !== undefined ? `[${f.index}]` : ''}：${f.message}`).join('\n') ?? e.message;
      }
    }
  } finally {
    busy.value = false;
  }
}

const checksumOption = ref<echarts.EChartsOption>({} as echarts.EChartsOption);
function buildChecksumChart() {
  if (!detail.value?.latest) return;
  const cs = detail.value.latest.checksums;
  const option: Record<string, unknown> = {
    title: { text: '逐深度校核和（a·fa + b·fb），高亮＝偏离中位数可疑点', textStyle: { fontSize: 13 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 70, right: 60, top: 50, bottom: 40 },
    xAxis: { type: 'value', name: '校核和' },
    yAxis: { type: 'value', name: '深度 (m)', inverse: true },
    series: [
      {
        type: 'scatter',
        symbolSize: (_v: unknown, p: { data: unknown[] }) => (p.data[3] ? 14 : 8),
        data: cs.map((c) => [c.sum, c.depth, c.residual, c.suspicious]),
        itemStyle: {
          color: (p: { data: unknown[] }) => (p.data[3] ? '#e8820c' : '#5b8cbe'),
        },
        label: {
          show: true,
          position: 'right',
          formatter: (p: { data: unknown[] }) => (p.data[3] ? `可疑 Δ=${Number(p.data[2]).toExponential(1)}` : ''),
          fontSize: 10,
          color: '#e8820c',
        },
      },
    ],
  };
  checksumOption.value = option as echarts.EChartsOption;
}
onMounted(() => setTimeout(buildChecksumChart, 0));

const reasonText: Record<string, string> = { upload: '上传', correct: '更正后重算', recalc: '联动重算' };
</script>

<template>
  <div v-if="detail" class="panel">
    <h2>
      测量 #{{ detail.measurement.id }}
      <span class="muted small">
        {{ detail.measurement.measuredAt.slice(0, 10) }} · revision {{ detail.measurement.revision }}
        <span v-if="detail.measurement.isInitial">· 初始测量</span>
      </span>
      <span style="float: right"><LevelBadge :level="detail.latest?.overallLevel ?? null" /></span>
    </h2>

    <div class="grid2">
      <div>
        <h3>按当时的数据判的级</h3>
        <p><LevelBadge :level="detail.thenNow.thenOverall" /></p>
        <h3>按现在的数据应判的级</h3>
        <p><LevelBadge :level="detail.thenNow.nowOverall" /></p>
        <div v-if="detail.thenNow.changed" class="error-box">
          两者不同。差异深度：
          <table style="margin-top: 6px">
            <thead><tr><th>深度</th><th>当时</th><th>现在</th><th>当时速率</th><th>现在速率</th></tr></thead>
            <tbody>
              <tr v-for="d in detail.thenNow.diffs" :key="d.depth">
                <td>{{ d.depth }} m</td>
                <td class="diff-del"><LevelBadge :level="d.thenLevel" /></td>
                <td class="diff-add"><LevelBadge :level="d.nowLevel" /></td>
                <td>{{ d.thenRate === null ? '—' : d.thenRate.toFixed(3) }}</td>
                <td>{{ d.nowRate === null ? '—' : d.nowRate.toFixed(3) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="ok-box">历史判级与当前一致。</div>
      </div>
      <div>
        <h3>判级留痕时间线（只追加，永不覆盖）</h3>
        <table>
          <thead><tr><th>重算时间</th><th>触发</th><th>整测等级</th></tr></thead>
          <tbody>
            <tr v-for="s in detail.history" :key="s.id">
              <td class="small">{{ s.computedAt.replace('T', ' ').slice(0, 19) }}</td>
              <td>{{ reasonText[s.reason] }}</td>
              <td><LevelBadge :level="s.overallLevel" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div v-if="detail" class="panel">
    <h2>校核和与可疑点</h2>
    <p class="small muted">
      校核和 = 正测×系数 + 反测×系数，理想情况逐深度近似常数；残差超过该孔容差（{{ detail.measurement.note ? '' : '' }}）标可疑，不自动剔除。
    </p>
    <EChart :option="checksumOption" />
    <table>
      <thead><tr><th>深度 (m)</th><th>校核和</th><th>相对中位数残差</th><th>判定</th></tr></thead>
      <tbody>
        <tr v-for="c in detail.latest?.checksums ?? []" :key="c.depth" :class="{ suspicious: c.suspicious }">
          <td>{{ c.depth }}</td>
          <td>{{ c.sum.toExponential(4) }}</td>
          <td>{{ c.residual.toExponential(3) }}</td>
          <td>{{ c.suspicious ? '⚠ 可疑（保留参与计算）' : '正常' }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="detail" class="panel">
    <h2>原始读数与事后更正</h2>
    <div v-if="err" class="error-box">{{ err }}</div>
    <div v-if="ok" class="ok-box">{{ ok }}</div>
    <button v-if="!editing" @click="editing = true">更正本次测量</button>
    <div v-else>
      <div class="row" style="margin-bottom: 10px">
        <label class="field">测量日期时间
          <input type="datetime-local" v-model="edit.measuredAt" />
        </label>
        <label class="field">操作人
          <input v-model="edit.operator" />
        </label>
        <label class="field">默认探头（无探头列的行用）
          <select v-model="edit.defaultProbeId">
            <option v-for="p in probes" :key="p.id" :value="p.id">{{ p.code }}</option>
          </select>
        </label>
        <button :disabled="busy" @click="submitCorrection">提交更正（基于 revision {{ detail.measurement.revision }}）</button>
        <button class="secondary" @click="editing = false">取消</button>
      </div>
      <textarea class="raw" v-model="edit.text"></textarea>
      <p class="small muted">
        若别人在您打开页面后已更正同一测量，提交会收到 409 冲突提示，本次不生效、不覆盖。
      </p>
    </div>
  </div>

  <p v-if="detail"><RouterLink :to="`/holes/${detail.measurement.holeId}`">← 返回测孔</RouterLink></p>
</template>
