<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import type { Hole, Probe } from '../types';

const holes = ref<Hole[]>([]);
const probes = ref<Probe[]>([]);
const err = ref('');
const form = ref({
  code: '',
  depthM: 20,
  spacingM: 0.5,
  positiveDirection: '',
  checksumTolerance: 0,
  blue: 2,
  yellow: 5,
  red: 10,
});
const saving = ref(false);

async function load() {
  holes.value = await api.listHoles();
  probes.value = await api.listProbes();
}
onMounted(load);

async function submit() {
  err.value = '';
  saving.value = true;
  try {
    await api.createHole({
      code: form.value.code.trim(),
      depthM: Number(form.value.depthM),
      spacingM: Number(form.value.spacingM),
      positiveDirection: form.value.positiveDirection.trim(),
      checksumTolerance: Number(form.value.checksumTolerance),
      thresholds: { blue: Number(form.value.blue), yellow: Number(form.value.yellow), red: Number(form.value.red) },
    });
    form.value.code = '';
    form.value.positiveDirection = '';
    await load();
  } catch (e) {
    if (e instanceof ApiError) err.value = e.fields?.map((f) => `• ${f.field}：${f.message}`).join('\n') ?? e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="panel">
    <h2>录入测孔与速率阈值（mm/d）</h2>
    <div v-if="err" class="error-box">{{ err }}</div>
    <div class="row">
      <label class="field">编号
        <input v-model="form.code" placeholder="如 ZK-03" />
      </label>
      <label class="field">孔深 (m)
        <input type="number" step="0.5" v-model.number="form.depthM" />
      </label>
      <label class="field">测点间距 (m)
        <input type="number" step="0.1" v-model.number="form.spacingM" />
      </label>
      <label class="field">正方向朝向
        <input v-model="form.positiveDirection" placeholder="如 N30°E" />
      </label>
      <label class="field">校核和可疑容差
        <input type="number" step="any" v-model.number="form.checksumTolerance" />
      </label>
      <label class="field">蓝警 ≥
        <input type="number" step="any" v-model.number="form.blue" />
      </label>
      <label class="field">黄警 ≥
        <input type="number" step="any" v-model.number="form.yellow" />
      </label>
      <label class="field">红警 ≥
        <input type="number" step="any" v-model.number="form.red" />
      </label>
      <button :disabled="saving" @click="submit">录入</button>
    </div>
  </div>

  <div class="panel">
    <h2>测孔列表</h2>
    <table>
      <thead>
        <tr>
          <th>编号</th><th>孔深</th><th>间距</th><th>正方向</th>
          <th>蓝/黄/红 (mm/d)</th><th>校核和容差</th><th>已登记探头</th><th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in holes" :key="h.id">
          <td>{{ h.code }}</td>
          <td>{{ h.depthM }}</td>
          <td>{{ h.spacingM }}</td>
          <td>{{ h.positiveDirection }}</td>
          <td>
            <span class="badge blue">{{ h.blue }}</span>
            <span class="badge yellow">{{ h.yellow }}</span>
            <span class="badge red">{{ h.red }}</span>
          </td>
          <td>{{ h.checksumTolerance }}</td>
          <td class="small muted">{{ probes.map((p) => p.code).join('、') || '尚未登记' }}</td>
          <td>
            <RouterLink :to="`/holes/${h.id}`">测量记录</RouterLink> ·
            <RouterLink :to="`/holes/${h.id}/profile`">剖面</RouterLink> ·
            <RouterLink :to="`/holes/${h.id}/time-series`">时程</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
