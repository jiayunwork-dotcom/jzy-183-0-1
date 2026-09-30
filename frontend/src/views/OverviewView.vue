<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type ApiError } from '../api';
import type { OverviewRow } from '../types';
import LevelBadge from '../components/LevelBadge.vue';

const rows = ref<OverviewRow[]>([]);
const err = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    rows.value = await api.overview();
  } catch (e) {
    err.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="panel">
    <h2>全部测孔当前预警等级 <button class="secondary" style="float: right" @click="load">刷新</button></h2>
    <div v-if="err" class="error-box">{{ err }}</div>
    <div v-if="loading" class="muted">加载中…</div>
    <table v-else>
      <thead>
        <tr><th>孔号</th><th>最近测量时间</th><th>当前整测等级</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.hole_id">
          <td><RouterLink :to="`/holes/${r.hole_id}`">{{ r.code }}</RouterLink></td>
          <td>{{ r.measured_at?.replace('T', ' ').slice(0, 16) }}</td>
          <td><LevelBadge :level="r.overall_level" /></td>
          <td>
            <RouterLink :to="`/holes/${r.hole_id}/profile`">剖面</RouterLink> ·
            <RouterLink :to="`/holes/${r.hole_id}/time-series`">时程</RouterLink> ·
            <RouterLink :to="`/measurements/${r.measurement_id}`">本次详情</RouterLink>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="4" class="muted">还没有测孔，<RouterLink to="/holes">去录入</RouterLink></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
