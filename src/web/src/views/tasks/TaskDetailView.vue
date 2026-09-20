<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchProject, fetchProjectMembers } from '@/api/projects'
import { fetchTask } from '@/api/tasks'
import { errorText } from '@/api/client'
import type { Project, Task } from '@/types'
import StateError from '@/components/StateError.vue'
import NormalTaskPanel from '@/components/tasks/NormalTaskPanel.vue'
import ProjectDetailPanel from '@/components/tasks/ProjectDetailPanel.vue'

/**
 * 任务/项目详情容器（v0.8.0，系统设计文档 10/11）：
 * - `/tasks/:id` 只服务任务（loadTask）；
 * - `/projects/:id` 只服务项目（loadProject + loadMembers，成员由容器加载后传入面板）；
 * - 已删除「按任务类型双向重定向」（模型上任务已无类型维度）；
 * - 加载/错误态由容器统一承担，面板只接收已加载数据。
 */
const route = useRoute()
const router = useRouter()

const task = ref<Task | null>(null)
const project = ref<Project | null>(null)
const members = ref<Task[]>([])
const loading = ref(true)
const error = ref('')

const detailId = computed(() => String(route.params.id))
const fromChat = computed(() => route.query.from === 'chat')
const isProjectRoute = computed(() => route.name === 'project-detail')

/** 详情编辑入口：项目走项目编辑页，任务走任务编辑页 */
const editPath = computed(() =>
  isProjectRoute.value ? `/projects/${detailId.value}/edit` : `/tasks/${detailId.value}/edit`
)

/**
 * silent=true：面板内部写操作后的静默刷新（保留已渲染内容，不闪「加载中」）。
 */
async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  error.value = ''
  try {
    if (isProjectRoute.value) {
      const [p, res] = await Promise.all([
        fetchProject(detailId.value),
        fetchProjectMembers(detailId.value, { page: 1, page_size: 200 }),
      ])
      project.value = p
      members.value = res.list || []
      task.value = null
    } else {
      task.value = await fetchTask(detailId.value)
      project.value = null
      members.value = []
    }
  } catch (e) {
    task.value = null
    project.value = null
    members.value = []
    error.value = errorText(e)
  } finally {
    if (!silent) loading.value = false
  }
}

onMounted(load)

// 同一组件承载两类详情：目标资源变化时重新加载
watch([() => route.name, () => route.params.id], () => void load())
</script>

<template>
  <div class="page detail">
    <header class="detail__head">
      <button class="detail__back pressable" aria-label="返回" @click="router.back()">
        ‹
        <span v-if="fromChat" class="detail__back-text">返回对话</span>
      </button>
      <span class="detail__head-title">{{ isProjectRoute ? '项目详情' : '任务详情' }}</span>
      <button
        v-if="isProjectRoute ? project : task"
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

      <ProjectDetailPanel
        v-else-if="isProjectRoute && project"
        :project="project"
        :members="members"
        @changed="load(true)"
      />
      <NormalTaskPanel v-else-if="task" :task="task" @changed="load(true)" />
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
