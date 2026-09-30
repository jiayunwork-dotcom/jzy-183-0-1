<script setup lang="ts">
import { computed } from 'vue';
import type { WarnColor } from '../types';

const props = defineProps<{ level: WarnColor; label?: string }>();
const cls = computed(() => `badge ${props.level ?? 'none'}`);
const text = computed(() => {
  if (props.label) return props.label;
  const map: Record<string, string> = { blue: '蓝', yellow: '黄', red: '红' };
  return (props.level && map[props.level]) || '正常';
});
</script>

<template>
  <span :class="cls">{{ text }}</span>
</template>
