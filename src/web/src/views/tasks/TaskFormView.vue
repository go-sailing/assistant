<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import * as listApi from '@/api/lists'
import { errorText } from '@/api/client'
import type { TaskList, TaskPriority } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppInput from '@/components/AppInput.vue'
import DateTimeField from '@/components/DateTimeField.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StateError from '@/components/StateError.vue'
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
const listId = ref<string>('')

const titleError = ref('')
const formError = ref('')
const saving = ref(false)
const shaking = ref(false)
const lists = ref<TaskList[]>([])
const loadError = ref('')
const loading = ref(false)
const listSheetVisible = ref(false)

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
const canSave = computed(() => title.value.trim() !== '' && !saving.value)

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

async function loadTask(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const t = await taskApi.fetchTask(editId.value)
    title.value = t.title
    note.value = t.note || ''
    priority.value = t.priority
    dueAt.value = t.due_at
    listId.value = t.list_id ? String(t.list_id) : ''
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    loading.value = false
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
    const payload = {
      title: title.value.trim(),
      note: note.value.trim() || null,
      priority: priority.value,
      due_at: dueAt.value,
      // 接口要求 list_id 为数字，此处从选择器的字符串值转回数字
      list_id: listId.value ? Number(listId.value) : null,
    }
    if (editId.value) {
      await taskApi.updateTask(editId.value, payload)
      taskSync.markDirty()
      toast.show('已保存')
      router.back()
    } else {
      const created = await taskApi.createTask(payload)
      taskSync.markDirty()
      toast.show('已保存')
      router.replace({ path: '/tasks', query: { highlight: String(created.id) } })
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
  listId.value = v
}

onMounted(async () => {
  await loadLists()
  if (editId.value) await loadTask()
})
</script>

<template>
  <div class="page form">
    <header class="form__head">
      <button class="form__cancel pressable" @click="router.back()">取消</button>
      <span class="form__title">{{ editId ? '编辑任务' : '新建任务' }}</span>
      <span class="form__placeholder" />
    </header>

    <div class="page-body form__body">
      <StateError v-if="loadError" :text="loadError" @retry="editId ? loadTask() : loadLists()" />

      <template v-else>
        <p v-if="formError" class="form__alert">{{ formError }}</p>

        <section class="form__group" :class="{ 'form__group--shake': shaking }">
          <AppInput
            v-model="title"
            label="标题 *"
            placeholder="请输入任务标题"
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
            <span class="form__row-value">{{ currentListName }}</span>
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

    <AppActionSheet
      :visible="listSheetVisible"
      title="选择清单"
      :items="orderedLists.map((l) => ({ label: l.name, value: String(l.id) }))"
      @select="onListSelect"
      @cancel="listSheetVisible = false"
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
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
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
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.form__submit {
  padding: var(--sp-6) var(--sp-4) 0;
}
</style>