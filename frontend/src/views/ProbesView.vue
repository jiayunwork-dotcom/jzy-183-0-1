<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import type { Probe } from '../types';

const probes = ref<Probe[]>([]);
const err = ref('');
const ok = ref('');
const probeForm = ref({ code: '', note: '' });
const calForm = ref({ probeId: undefined as number | undefined, factor: 1, effectiveFrom: '', note: '' });

async function load() {
  probes.value = await api.listProbes();
  if (!calForm.value.probeId && probes.value[0]) calForm.value.probeId = probes.value[0].id;
}
onMounted(load);

function showError(e: unknown) {
  if (e instanceof ApiError) err.value = e.fields?.map((f) => `• ${f.field}：${f.message}`).join('\n') ?? e.message;
  else err.value = String(e);
}

async function createProbe() {
  err.value = '';
  try {
    await api.createProbe({ code: probeForm.value.code.trim(), note: probeForm.value.note || null });
    probeForm.value = { code: '', note: '' };
    await load();
  } catch (e) {
    showError(e);
  }
}

async function addCal() {
  err.value = '';
  ok.value = '';
  try {
    await api.addCalibration({
      probeId: calForm.value.probeId,
      factor: Number(calForm.value.factor),
      effectiveFrom: new Date(calForm.value.effectiveFrom).toISOString(),
      note: calForm.value.note || null,
    });
    ok.value = '标定版本已登记；历史测量所用系数按测量日期取对应版本，受影响的孔已全部重算。';
    calForm.value.effectiveFrom = '';
    calForm.value.note = '';
    await load();
  } catch (e) {
    showError(e);
  }
}
</script>

<template>
  <div class="panel">
    <h2>登记探头</h2>
    <div v-if="err" class="error-box">{{ err }}</div>
    <div v-if="ok" class="ok-box">{{ ok }}</div>
    <div class="row">
      <label class="field">探头编号
        <input v-model="probeForm.code" placeholder="如 CX-PROBE-A" />
      </label>
      <label class="field">备注
        <input v-model="probeForm.note" />
      </label>
      <button @click="createProbe">登记</button>
    </div>
  </div>

  <div class="panel">
    <h2>新增标定版本（按生效时间保留全部历史版本）</h2>
    <div class="row">
      <label class="field">探头
        <select v-model="calForm.probeId">
          <option v-for="p in probes" :key="p.id" :value="p.id">{{ p.code }}</option>
        </select>
      </label>
      <label class="field">系数（读数 → 倾斜正弦）
        <input type="number" step="any" v-model.number="calForm.factor" />
      </label>
      <label class="field">生效时间
        <input type="datetime-local" v-model="calForm.effectiveFrom" />
      </label>
      <label class="field">备注（如“年度送检重新标定”）
        <input v-model="calForm.note" />
      </label>
      <button @click="addCal">新增版本并重算受影响测孔</button>
    </div>
    <p class="small muted">
      某测量使用的系数 = 该探头 effective_from ≤ 测量日期 的最新一条。把新版本生效时间登记到过去，
      即视为“更正历史标定”，对应历史测量会被级联重算，判级差异可在测量详情的“当时/现在”里查到。
    </p>
  </div>

  <div class="panel">
    <h2>探头与标定记录</h2>
    <table>
      <thead><tr><th>探头编号</th><th>备注</th><th>标定版本（生效时间 / 系数 / 备注）</th></tr></thead>
      <tbody>
        <tr v-for="p in probes" :key="p.id">
          <td>{{ p.code }}</td>
          <td class="small">{{ p.note ?? '' }}</td>
          <td>
            <table>
              <tbody>
                <tr v-for="c in [...p.calibrations].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))" :key="c.id">
                  <td class="small">{{ c.effectiveFrom.replace('T', ' ').slice(0, 16) }}</td>
                  <td>{{ c.factor }}</td>
                  <td class="small muted">{{ c.note ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
