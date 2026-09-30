<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <nav class="topbar">
    <span class="brand">测斜监测管理系统</span>
    <RouterLink to="/">预警总览</RouterLink>
    <RouterLink to="/holes">测孔</RouterLink>
    <RouterLink to="/probes">探头 / 标定</RouterLink>
  </nav>
  <main>
    <RouterView />
  </main>
</template>
