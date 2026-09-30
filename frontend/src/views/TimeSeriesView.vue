<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import type { TimeSeries } from '../types';
import EChart from '../components/EChart.vue';

const props = defineProps<{ id: string }>();
const holeId = computed(() => Number(props.id));
const data = ref<TimeSeries | null>(null);
const depth = ref(0);

async function load() {
  data.value = await api.timeSeries(holeId.value, depth.value);
}
onMounted(load);
watch([holeId, depth], load);

const depthOptions = computed(() => {
  if (!data.value) return [] as number[];
  const n = Math.round(data.value.hole.depthM / data.value.hole.spacingM);
  return Array.from({ length: n }, (_, k) => +(k * data.value!.hole.spacingM).toFixed(2));
});

const option = computed<object>(() => {
  if (!data.value || data.value.points.length === 0) return {};
  const d0 = data.value;
  const t = d0.points.map((p) => p.measuredAt.slice(0, 10));
  const barColor = (p: unknown) => {
    const v = Math.abs(Number((p as { value?: number | null }).value ?? 0));
    if (v >= d0.thresholds.red) return '#d8483b';
    if (v >= d0.thresholds.yellow) return '#e6a010';
    if (v >= d0.thresholds.blue) return '#2f7de1';
    return '#9fb3c8';
  };
  return {
    title: {
      text: `${d0.hole.code} 深度 ${d0.depth} m 处位移 / 速率时程`,
      textStyle: { fontSize: 14 },
    },
    tooltip: { trigger: 'axis' },
    legend: { top: 24, data: ['累计位移 (mm)', '速率 (mm/d)', '蓝警', '黄警', '红警'] },
    grid: { left: 60, right: 60, top: 70, bottom: 40 },
    xAxis: { type: 'category', data: t, name: '测量日期' },
    yAxis: [
      { type: 'value', name: '位移 (mm)' },
      { type: 'value', name: '速率 (mm/d)' },
    ],
    series: [
      {
        name: '累计位移 (mm)',
        type: 'line',
        yAxisIndex: 0,
        data: d0.points.map((p) => p.displacement),
        symbolSize: 7,
        lineStyle: { width: 2, color: '#333' },
        itemStyle: { color: '#333' },
      },
      {
        name: '速率 (mm/d)',
        type: 'bar',
        yAxisIndex: 1,
        data: d0.points.map((p) => p.rate),
        itemStyle: { color: barColor },
      },
      {
        name: '蓝警',
        type: 'line',
        yAxisIndex: 1,
        data: t.map(() => d0.thresholds.blue),
        symbol: 'none',
        lineStyle: { color: '#2f7de1', type: 'dashed' },
      },
      {
        name: '黄警',
        type: 'line',
        yAxisIndex: 1,
        data: t.map(() => d0.thresholds.yellow),
        symbol: 'none',
        lineStyle: { color: '#e6a010', type: 'dashed' },
      },
      {
        name: '红警',
        type: 'line',
        yAxisIndex: 1,
        data: t.map(() => d0.thresholds.red),
        symbol: 'none',
        lineStyle: { color: '#d8483b', type: 'dashed' },
      },
    ],
  };
});
</script>

<template>
  <div class="panel">
    <h2>深度时程曲线</h2>
    <label class="field" style="max-width: 200px">
      选择深度
      <select v-model.number="depth">
        <option v-for="d in depthOptions" :key="d" :value="d">{{ d }} m</option>
      </select>
    </label>
    <EChart :option="option" />
    <p class="small"><RouterLink :to="`/holes/${holeId}`">← 返回测孔</RouterLink></p>
  </div>
</template>
