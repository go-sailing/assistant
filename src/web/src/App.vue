<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppTabBar from '@/components/AppTabBar.vue'
import AppToast from '@/components/AppToast.vue'

const route = useRoute()
// 底部 Tab 仅在一级页面常驻
const tab = computed(() => (route.meta.tab as 'tasks' | 'chat' | undefined) || null)
</script>

<template>
  <div class="app-shell">
    <router-view v-slot="{ Component }">
      <component :is="Component" :key="route.fullPath" />
    </router-view>
    <AppTabBar v-if="tab" :active="tab" />
    <AppToast />
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  height: 100%;
  /* 纵向 flex：页面占满剩余高度，底部 Tab 栏始终可见 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>