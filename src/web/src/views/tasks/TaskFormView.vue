<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as projectApi from '@/api/projects'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { TaskPayload, TaskPriority } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppInput from '@/components/AppInput.vue'
import DateTimeField from '@/components/DateTimeField.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StateError from '@/components/StateError.vue'
import ProjectPickerSheet from '@/components/tasks/ProjectPickerSheet.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

const editId = computed(() => (route.name === 'task-edit' ? String(route.params.id) : ''))

const title = ref('')
const note = ref('')
const priority = ref<TaskPriority>('none')
const dueAt = ref<string | null>(null)
/** 所属项目：null = 无（独立任务），数字 = 项目 ID */
const projectId = ref<number | null>(null)
const projectName = ref('')

const titleError = ref('')
const formError = ref('')
const saving = ref(false)
const shaking = ref(false)
const loadError = ref('')
const loading = ref(false)
const projectSheetVisible = ref(false)

const priorityOptions = [
  { label: '无', value: 'none' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
]

const projectText = computed(() =>
  projectId.value === null ? '无（独立任务）' : projectName.value || '项目'
)
const canSave = computed(() => title.value.trim() !== '' && !saving.value)
const headTitle = computed(() => (editId.value ? '编辑任务' : '新建任务'))
const titleLabel = '标题 *'
const titlePlaceholder = '请输入任务标题'

async function loadTask(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const t = await taskApi.fetchTask(editId.value)
    title.value = t.title
    note.value = t.note || ''
    priority.value = t.priority
    dueAt.value = t.due_at
    // v0.8.0：任务只以可空 project_id 表达「所属项目」，无类型维度
    projectId.value = t.project?.id ?? null
    projectName.value = t.project?.name ?? ''
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

/**
 * 新建时带入来源项目（项目详情「更多字段」→ /tasks/new?project_id=<id>）。
 * 来源项目已删除/无权限（fetchProject 失败）→ 清空所属项目并按普通新建降级（UXUI 7.2）。
 */
async function loadQueryPrefill(): Promise<void> {
  const qProject = route.query.project_id
  if (typeof qProject !== 'string' || !qProject) return
  try {
    const project = await projectApi.fetchProject(qProject)
    projectId.value = project.id
    projectName.value = project.name
  } catch {
    projectId.value = null
    projectName.value = ''
    toast.show('原项目已不可用，已按普通任务创建')
  }
}

/** 标题为空时抖动提示 */
function warnTitle(): void {
  titleError.value = '请输入任务标题'
  shaking.value = true
  window.setTimeout(() => {
    shaking.value = false
  }, 400)
}

async function save(): Promise<void> {
  if (saving.value) return
  formError.value = ''
  if (!title.value.trim()) {
    warnTitle()
    return
  }
  saving.value = true
  try {
    const payload: TaskPayload = {
      title: title.value.trim(),
      note: note.value.trim() || null,
      priority: priority.value,
      due_at: dueAt.value,
      // 显式 null = 无（独立任务）
      project_id: projectId.value,
    }
    if (editId.value) {
      await taskApi.updateTask(editId.value, payload)
      taskSync.markDirty()
      toast.show('已保存')
      // 编辑态落点不变
      router.back()
    } else {
      const created = await taskApi.createTask(payload)
      taskSync.markDirty()
      toast.show('已保存')
      // 回跳以最终所属项目为准：有项目回项目详情并高亮，否则回任务页（TASK-02）
      const target = projectId.value ?? null
      if (target === null) {
        router.replace({ path: '/tasks', query: { highlight: String(created.id) } })
      } else {
        router.replace(`/projects/${target}?highlight=${String(created.id)}`)
      }
    }
  } catch (e) {
    // 失败停留在当前页，表单内容保留在内存中
    formError.value = errorText(e)
  } finally {
    saving.value = false
  }
}

async function onProjectSelect(id: number | null): Promise<void> {
  projectSheetVisible.value = false
  if (id === null) {
    if (projectId.value !== null) toast.show('已移出项目，成为独立任务')
    projectId.value = null
    projectName.value = ''
    return
  }
  if (projectId.value === id) return
  try {
    const project = await projectApi.fetchProject(id)
    projectId.value = project.id
    projectName.value = project.name
  } catch (e) {
    toast.show(errorText(e))
  }
}

onMounted(async () => {
  if (editId.value) {
    await loadTask()
  } else {
    await loadQueryPrefill()
  }
})
</script>

<template>
  <div class="page form">
    <header class="form__head">
      <button class="form__cancel pressable" @click="router.back()">取消</button>
      <span class="form__title">{{ headTitle }}</span>
      <span class="form__placeholder" />
    </header>

    <div class="page-body form__body">
      <StateError v-if="loadError" :text="loadError" @retry="loadTask" />

      <template v-else>
        <p v-if="formError" class="form__alert">{{ formError }}</p>

        <section class="form__group" :class="{ 'form__group--shake': shaking }">
          <AppInput
            v-model="title"
            :label="titleLabel"
            :placeholder="titlePlaceholder"
            :maxlength="200"
            :error="titleError"
            @update:model-value="titleError = ''"
          />
        </section>

        <section class="form__group">
          <AppInput v-model="note" label="备注" type="textarea" placeholder="补充说明…" :maxlength="2000" />
        </section>

        <section class="form__group form__group--plain">
          <p class="form__label">优先级</p>
          <SegmentedControl
            :model-value="priority"
            :options="priorityOptions"
            @update:model-value="priority = $event as TaskPriority"
          />
        </section>

        <section class="form__group form__group--list">
          <DateTimeField v-model="dueAt" />
        </section>

        <section class="form__group form__group--list">
          <button class="form__row pressable" @click="projectSheetVisible = true">
            <AppIcon name="list" :size="20" color="#6B7080" />
            <span class="form__row-label">所属项目</span>
            <span class="form__row-value ellipsis">{{ projectText }}</span>
            <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
          </button>
        </section>

        <div class="form__submit">
          <AppButton type="primary" :disabled="!canSave" :loading="saving" @click="save">
            保 存
          </AppButton>
        </div>
      </template>
    </div>

    <!-- 移入项目 / 移出成为独立任务 -->
    <ProjectPickerSheet
      :visible="projectSheetVisible"
      :task-id="editId || null"
      :current-project-id="projectId"
      @select="onProjectSelect"
      @cancel="projectSheetVisible = false"
    />
  </div>
</template>

<style scoped>
.form__head {
  display: flex;
  align-items: center;
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.form__cancel {
  min-width: 44px;
  min-height: 44px;
  text-align: left;
  font-size: var(--font-body-l);
  color: var(--text-secondary);
}
.form__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  font-weight: 600;
}
.form__placeholder {
  min-width: 44px;
}
.form__body {
  /* 底部留白避让右下角 FAB */
  padding-bottom: calc(96px + var(--safe-bottom));
}
.form__alert {
  margin: var(--sp-3) var(--sp-4) 0;
  padding: var(--sp-3);
  background: #fff5f4;
  border-radius: var(--radius-control);
  color: var(--color-danger);
  font-size: var(--font-caption);
}
.form__group {
  margin-top: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.form__group--plain {
  padding: 0;
  overflow: hidden;
}
.form__group--list {
  padding: 0;
}
.form__group--shake {
  animation: shake 400ms ease;
}
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20%,
  60% {
    transform: translateX(-6px);
  }
  40%,
  80% {
    transform: translateX(6px);
  }
}
.form__label {
  padding: var(--sp-4) var(--sp-4) var(--sp-2);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.form__group--plain .form__label {
  padding-bottom: 0;
}
.form__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--sp-4);
  background: var(--bg-card);
}
.form__row-label {
  flex: 1;
  text-align: left;
  font-size: var(--font-body-l);
}
.form__row-value {
  max-width: 55%;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.form__submit {
  padding: var(--sp-6) var(--sp-4) 0;
}
</style>
