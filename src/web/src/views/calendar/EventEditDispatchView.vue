<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import { errorText } from '@/api/client'
import StateError from '@/components/StateError.vue'

/**
 * 统一编辑入口（v0.6.0，FRM-01）：/calendar/:id/edit
 * 先加载事件，按 event_type 分流到普通日程表单或任务日程表单；
 * scope / occurrence_key 等 query 原样透传。
 */
const route = useRoute()
const router = useRouter()

const error = ref('')
const eventId = computed(() => String(route.params.id))

async function dispatch(): Promise<void> {
  error.value = ''
  const occKey = typeof route.query.occurrence_key === 'string' ? route.query.occurrence_key : undefined
  try {
    const ev = await eventApi.fetchEvent(eventId.value, occKey)
    const kind = ev.event_type === 'task' ? 'task' : 'normal'
    await router.replace({
      path: `/calendar/${eventId.value}/edit/${kind}`,
      query: { ...route.query },
    })
  } catch (e) {
    error.value = errorText(e)
  }
}

onMounted(dispatch)
</script>

<template>
  <div class="page dispatch">
    <header class="dispatch__head">
      <button class="dispatch__back pressable" aria-label="返回" @click="router.back()">‹</button>
      <span class="dispatch__title">编辑日程</span>
      <span class="dispatch__placeholder" />
    </header>
    <div class="page-body dispatch__body">
      <p v-if="!error" class="dispatch__loading">加载中…</p>
      <StateError v-else :text="error" @retry="dispatch" />
    </div>
  </div>
</template>

<style scoped>
.dispatch__head {
  display: flex;
  align-items: center;
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.dispatch__back {
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  text-align: left;
  font-size: 26px;
  color: var(--color-primary);
}
.dispatch__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  font-weight: 600;
}
.dispatch__placeholder {
  min-width: 44px;
}
.dispatch__loading {
  padding: var(--sp-6);
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
</style>
