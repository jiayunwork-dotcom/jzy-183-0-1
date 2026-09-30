<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps<{ option: object; tall?: boolean }>();
const el = ref<HTMLDivElement>();
let chart: echarts.ECharts | null = null;

onMounted(() => {
  chart = echarts.init(el.value!);
  chart.setOption(props.option as echarts.EChartsOption);
  const ro = new ResizeObserver(() => chart?.resize());
  ro.observe(el.value!);
  onBeforeUnmount(() => {
    ro.disconnect();
    chart?.dispose();
  });
});

watch(
  () => props.option,
  (opt) => {
    chart?.setOption(opt as echarts.EChartsOption, true);
  },
  { deep: true },
);
</script>

<template>
  <div ref="el" :class="['chart', { tall }]"></div>
</template>
