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
 * 任务/项目详情容器（v0.7.0，系统设计文档 9.1）：
 * - `/tasks/:id` 只承载普通任务；命中项目时重定向到 `/projects/:id`（query 透传）；
 * - `/projects/:id` 承载项目；命中普通任务时反向重定向到 `/tasks/:id`；
 * - 加载/错误态由容器统一承担，面板只接收已加载的 Task。
 */
const route = useRoute()
const router = useRouter()

const task = ref<Task | null>(null)
const loading = ref(true)
const error = ref('')

const taskId = computed(() => String(route.params.id))
const fromChat = computed(() => route.query.from === 'chat')
const isProjectRoute = computed(() => route.name === 'project-detail')
const isProject = computed(() => task.value?.task_type === 'project')

/** 详情编辑入口：项目走项目编辑页，普通任务走任务编辑页 */
const editPath = computed(() =>
  isProject.value ? `/projects/${taskId.value}/edit` : `/tasks/${taskId.value}/edit`
)

/**
 * silent=true：面板内部写操作后的静默刷新（保留已渲染内容，不闪「加载中」）。
 * 加载完成后按 task_type 与当前路由做一次分流（不渲染错形态的面板）。
 */
async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const data = await taskApi.fetchTask(taskId.value)
    // 形态与路由不匹配：重定向（透传 query，保留 from=chat 返回语义）
    if (data.task_type === 'project' && !isProjectRoute.value) {
      await router.replace({ path: `/projects/${data.id}`, query: route.query })
      return
    }
    if (data.task_type !== 'project' && isProjectRoute.value) {
      await router.replace({ path: `/tasks/${data.id}`, query: route.query })
      return
    }
    task.value = data
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
        @click="router.push(editPath)"
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
