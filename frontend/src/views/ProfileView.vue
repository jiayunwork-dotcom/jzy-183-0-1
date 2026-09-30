<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { ProfileOverlay } from '../types';
import EChart from '../components/EChart.vue';

const props = defineProps<{ id: string }>();
const holeId = computed(() => Number(props.id));
const data = ref<ProfileOverlay | null>(null);
const selected = ref<Set<number>>(new Set());

async function load() {
  data.value = await api.profile(holeId.value, 'all');
  if (selected.value.size === 0) {
    // 默认全选
    selected.value = new Set(data.value.series.map((s) => s.measurementId));
  }
}
onMounted(load);
watch(holeId, load);

const levelColor: Record<string, string> = {
  blue: '#2f7de1',
  yellow: '#e6a010',
  red: '#d8483b',
};

const option = computed<object>(() => {
  if (!data.value) return {};
  const picked = data.value.series.filter((s) => selected.value.has(s.measurementId));
  return {
    title: {
      text: `${data.value.hole.code} 位移剖面叠加（正方向 ${data.value.hole.positiveDirection}，单位 mm）`,
      textStyle: { fontSize: 14 },
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const ps = params as Array<{ axisValue: number; seriesName: string; value: number[]; marker: string }>;
        const depth = ps[0]?.axisValue;
        const lines = ps
          .map((p) => {
            const v = p.value?.[0];
            return `<div>${p.marker} ${p.seriesName}：${v === null || v === undefined ? '-' : Number(v).toFixed(2)} mm</div>`;
          })
          .join('');
        return `深度 ${depth} m${lines}`;
      },
    },
    legend: { top: 24, type: 'scroll' },
    grid: { left: 60, right: 30, top: 70, bottom: 40 },
    xAxis: {
      type: 'value',
      name: '累计位移 (mm)',
      nameLocation: 'middle',
      nameGap: 26,
    },
    yAxis: {
      type: 'value',
      name: '深度 (m)',
      inverse: true, // 孔口在上、孔底在下
      min: 0,
      max: data.value.hole.depthM,
    },
    series: picked.map((s) => {
      const points = s.displacement.map((d, j) => [d, data.value!.depths[j]]);
      const isSplice = s.spliceDelta !== null;
      return {
        type: 'line' as const,
        name: `${s.measuredAt.slice(0, 10)}${s.isInitial ? '(初)' : ''}${isSplice ? ' ⇄新基准' : ''}`,
        data: points,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, type: isSplice ? ('dashed' as const) : ('solid' as const) },
        itemStyle: { color: s.overallLevel ? levelColor[s.overallLevel] ?? '#777' : '#444' },
        markPoint: isSplice
          ? {
              symbol: 'pin',
              symbolSize: 46,
              label: { formatter: '基准\n切换', fontSize: 9, color: '#fff' },
              itemStyle: { color: '#7a3fb5' },
              data: [{ coord: [s.displacement[0], 0] }],
            }
          : undefined,
      };
    }),
  };
});

function toggle(id: number) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
</script>

<template>
  <div class="panel">
    <h2>
      位移剖面叠加
      <span class="muted small">（虚线＋图钉＝基准切换位置；曲线颜色＝该测整测等级）</span>
    </h2>
    <p v-if="data" class="small">
      选择测量：
      <label v-for="s in data.series" :key="s.measurementId" class="small" style="margin-right: 10px">
        <input
          type="checkbox"
          :checked="selected.has(s.measurementId)"
          @change="toggle(s.measurementId)"
        />
        {{ s.measuredAt.slice(0, 10) }}{{ s.isInitial ? '(初)' : '' }}{{ s.spliceDelta !== null ? ' ⇄' : '' }}
      </label>
    </p>
    <EChart :option="option" tall />
    <div v-if="data" class="small muted">
      基准段：
      <span v-for="seg in data.segments" :key="seg.id">
        第{{ seg.seq + 1 }}段({{ { initial: '初始', probe_change: '换探头', repair: '修复', reset: '重设' }[seg.reason] }}，
        起于 {{ seg.startedAt.slice(0, 10) }})；
      </span>
    </div>
    <p class="small"><RouterLink :to="`/holes/${holeId}`">← 返回测孔</RouterLink></p>
  </div>
</template>
