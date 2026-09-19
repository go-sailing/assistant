<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import * as listApi from '@/api/lists'
import { errorText } from '@/api/client'
import type { TaskList, TaskPayload, TaskPriority, TaskType } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
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

/** v0.6.0：任务类型（仅创建时可选，创建后不可变更） */
const taskType = ref<TaskType>('normal')
const isProject = computed(() => taskType.value === 'project')

const title = ref('')
const note = ref('')
const priority = ref<TaskPriority>('none')
const dueAt = ref<string | null>(null)
const listId = ref<string>('')
/** 所属项目：空串 = 无（独立任务） */
const parentId = ref<string>('')
const parentTitle = ref('')

const titleError = ref('')
const formError = ref('')
const saving = ref(false)
const shaking = ref(false)
const lists = ref<TaskList[]>([])
const loadError = ref('')
const loading = ref(false)
const listSheetVisible = ref(false)
const projectSheetVisible = ref(false)

const taskTypeOptions = [
  { label: '普通任务', value: 'normal' },
  { label: '项目', value: 'project' },
]

const priorityOptions = [
  { label: '无', value: 'none' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
]

const orderedLists = computed(() =>
  [...lists.value].sort((a, b) => Number(b.is_default) - Number(a.is_default))
)
const currentListName = computed(() => {
  const found = lists.value.find((l) => String(l.id) === String(listId.value))
  return found ? found.name : '默认清单'
})
/** 项目不挂父：项目形态下该行为空文案且不渲染 */
const projectText = computed(() =>
  parentId.value ? parentTitle.value || '项目' : '无（独立任务）'
)
const canSave = computed(() => title.value.trim() !== '' && !saving.value)
const headTitle = computed(() => {
  if (editId.value) return isProject.value ? '编辑项目' : '编辑任务'
  return isProject.value ? '新建项目' : '新建任务'
})
const titleLabel = computed(() => (isProject.value ? '项目名称 *' : '标题 *'))
const titlePlaceholder = computed(() => (isProject.value ? '请输入项目名称' : '请输入任务标题'))

async function loadLists(): Promise<void> {
  try {
    lists.value = await listApi.fetchLists()
    if (!listId.value) {
      const def = lists.value.find((l) => l.is_default) || lists.value[0]
      if (def) listId.value = String(def.id)
    }
  } catch (e) {
    loadError.value = errorText(e)
  }
}

/** 回填所属项目标题：祖先链的倒数第二项即直接父（项目） */
async function loadProjectTitle(id: string): Promise<void> {
  try {
    const chain = await taskApi.fetchAncestors(id)
    if (chain.length > 1) parentTitle.value = chain[chain.length - 2].title
  } catch {
    parentTitle.value = ''
  }
}

async function loadTask(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const t = await taskApi.fetchTask(editId.value)
    taskType.value = t.task_type
    title.value = t.title
    note.value = t.note || ''
    priority.value = t.priority
    dueAt.value = t.due_at
    listId.value = t.list_id ? String(t.list_id) : ''
    parentId.value = t.parent_id === null ? '' : String(t.parent_id)
    if (parentId.value) await loadProjectTitle(editId.value)
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

/** 新建时支持带入任务类型、所属项目与清单（项目详情「添加任务」/ 项目筛选新建） */
async function loadQueryPrefill(): Promise<void> {
  const qType = route.query.task_type
  const qParent = route.query.parent_id
  const qList = route.query.list_id
  if (qType === 'project') taskType.value = 'project'
  if (typeof qList === 'string' && qList) listId.value = qList
  if (typeof qParent === 'string' && qParent) {
    // 挂到项目下即普通任务（成员仅一层）
    taskType.value = 'normal'
    try {
      const parent = await taskApi.fetchTask(qParent)
      parentId.value = String(parent.id)
      parentTitle.value = parent.title
      // 成员与项目同清单
      if (parent.list_id) listId.value = String(parent.list_id)
    } catch (e) {
      formError.value = errorText(e)
    }
  }
}

/** 切换任务类型：项目不能挂父，切到项目时清空所属项目 */
function onTaskTypeChange(v: string): void {
  const next = v as TaskType
  if (next === taskType.value) return
  taskType.value = next
  if (next === 'project' && parentId.value) {
    parentId.value = ''
    parentTitle.value = ''
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
      // 接口要求 list_id 为数字，此处从选择器的字符串值转回数字
      list_id: listId.value ? Number(listId.value) : null,
    }
    if (!editId.value) {
      // 任务类型仅创建时下发（编辑携带会被服务端拒绝）
      payload.task_type = taskType.value
    }
    if (!isProject.value) {
      // 显式 null = 移出项目成为独立任务；项目不挂父，不下发该字段
      payload.parent_id = parentId.value ? Number(parentId.value) : null
    }
    if (editId.value) {
      const updated = await taskApi.updateTask(editId.value, payload)
      taskSync.markDirty()
      toast.show(
        updated.revived_parent ? `项目「${updated.revived_parent.title}」已自动恢复为未完成` : '已保存'
      )
      router.back()
    } else {
      const created = await taskApi.createTask(payload)
      taskSync.markDirty()
      toast.show(
        created.revived_parent
          ? `项目「${created.revived_parent.title}」已自动恢复为未完成`
          : '已保存'
      )
      // 项目直接进入详情，便于连续添加成员
      if (created.task_type === 'project') router.replace(`/tasks/${created.id}`)
      else router.replace({ path: '/tasks', query: { highlight: String(created.id) } })
    }
  } catch (e) {
    // 失败停留在当前页，表单内容保留在内存中
    formError.value = errorText(e)
  } finally {
    saving.value = false
  }
}

function onListSelect(v: string): void {
  listSheetVisible.value = false
  if (v === listId.value) return
  listId.value = v
  // 成员必须与项目同清单：换清单时清除已选项目
  if (parentId.value) {
    parentId.value = ''
    parentTitle.value = ''
    toast.show('已清除所属项目（成员需与项目同清单）')
  }
}

async function onProjectSelect(id: number | null): Promise<void> {
  projectSheetVisible.value = false
  if (id === null) {
    if (parentId.value) toast.show('已移出项目，成为独立任务')
    parentId.value = ''
    parentTitle.value = ''
    return
  }
  if (parentId.value && String(id) === parentId.value) return
  try {
    const parent = await taskApi.fetchTask(id)
    parentId.value = String(parent.id)
    parentTitle.value = parent.title
    // 跟随项目清单，避免跨清单校验失败
    if (parent.list_id) listId.value = String(parent.list_id)
  } catch (e) {
    toast.show(errorText(e))
  }
}

onMounted(async () => {
  await loadLists()
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
      <StateError v-if="loadError" :text="loadError" @retry="editId ? loadTask() : loadLists()" />

      <template v-else>
        <p v-if="formError" class="form__alert">{{ formError }}</p>

        <!-- v0.6.0：任务类型（仅创建时可选；项目 = 一组相关任务的容器） -->
        <section v-if="!editId" class="form__group form__group--plain">
          <p class="form__label">任务类型</p>
          <SegmentedControl
            :model-value="taskType"
            :options="taskTypeOptions"
            @update:model-value="onTaskTypeChange"
          />
        </section>

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
          <button class="form__row pressable" @click="listSheetVisible = true">
            <AppIcon name="folder" :size="20" color="#6B7080" />
            <span class="form__row-label">所属清单</span>
            <span class="form__row-value ellipsis">{{ currentListName }}</span>
            <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
          </button>
        </section>

        <!-- v0.6.0：所属项目行（仅普通任务可见；项目不能挂父） -->
        <section v-if="!isProject" class="form__group form__group--list">
          <button class="form__row pressable" @click="projectSheetVisible = true">
            <AppIcon name="list" :size="20" color="#6B7080" />
            <span class="form__row-label">所属项目</span>
            <span class="form__row-value ellipsis">{{ projectText }}</span>
            <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
          </button>
          <p v-if="parentId" class="form__row-hint">成员任务将与项目保持在同一清单</p>
        </section>

        <div class="form__submit">
          <AppButton type="primary" :disabled="!canSave" :loading="saving" @click="save">
            保 存
          </AppButton>
        </div>
      </template>
    </div>

    <AppActionSheet
      :visible="listSheetVisible"
      title="选择清单"
      :items="orderedLists.map((l) => ({ label: l.name, value: String(l.id) }))"
      @select="onListSelect"
      @cancel="listSheetVisible = false"
    />

    <!-- 移入项目 / 移出成为独立任务 -->
    <ProjectPickerSheet
      :visible="projectSheetVisible"
      :task-id="editId || null"
      :list-id="listId || null"
      :current-project-id="parentId || null"
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
.form__row-hint {
  padding: 0 var(--sp-4) var(--sp-3);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-disabled);
}
.form__submit {
  padding: var(--sp-6) var(--sp-4) 0;
}
</style>
