<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Task } from '@/types'
import StateError from '@/components/StateError.vue'
import NormalTaskPanel from '@/components/tasks/NormalTaskPanel.vue'
import ProjectDetailPanel from '@/components/tasks/ProjectDetailPanel.vue'

/**
 * 任务/项目详情容器（v0.6.0，系统设计文档 3.3）：
 * 不新增独立路由，按 task_type 分流到项目面板或普通任务面板；
 * 加载/错误/骨架由容器统一承担，面板只接收已加载的 Task。
 */
const route = useRoute()
const router = useRouter()

const task = ref<Task | null>(null)
const loading = ref(true)
const error = ref('')

const taskId = computed(() => String(route.params.id))
const fromChat = computed(() => route.query.from === 'chat')
const isProject = computed(() => task.value?.task_type === 'project')

/**
 * silent=true：面板内部写操作后的静默刷新（保留已渲染内容，不闪「加载中」）。
 */
async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  error.value = ''
  try {
    task.value = await taskApi.fetchTask(taskId.value)
  } catch (e) {
    task.value = null
    error.value = errorText(e)
  } finally {
    if (!silent) loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page detail">
    <header class="detail__head">
      <button class="detail__back pressable" aria-label="返回" @click="router.back()">
        ‹
        <span v-if="fromChat" class="detail__back-text">返回对话</span>
      </button>
      <span class="detail__head-title">{{ isProject ? '项目详情' : '任务详情' }}</span>
      <button
        v-if="task"
        class="detail__edit pressable"
        @click="router.push(`/tasks/${taskId}/edit`)"
      >
        编辑
      </button>
      <span v-else class="detail__edit" />
    </header>

    <div class="page-body detail__body">
      <p v-if="loading" class="detail__loading">加载中…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <template v-else-if="task">
        <ProjectDetailPanel
          v-if="task.task_type === 'project'"
          :task="task"
          @changed="load(true)"
        />
        <NormalTaskPanel v-else :task="task" @changed="load(true)" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.detail__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.detail__back {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  font-size: 26px;
  color: var(--color-primary);
}
.detail__back-text {
  font-size: var(--font-body-m);
  white-space: nowrap;
}
.detail__head-title {
  flex: 1;
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.detail__edit {
  min-width: 44px;
  min-height: 44px;
  text-align: right;
  font-size: var(--font-body-l);
  color: var(--color-primary);
}
.detail__body {
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
}
.detail__loading {
  padding: var(--sp-6);
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-body-m);
}
</style>
