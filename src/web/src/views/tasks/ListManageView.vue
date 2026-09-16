<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import * as listApi from '@/api/lists'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { TaskList } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import StateError from '@/components/StateError.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const lists = ref<TaskList[]>([])
const loading = ref(true)
const error = ref('')

/** 新建/重命名行内输入 */
const creating = ref(false)
const createName = ref('')
const createInput = ref<HTMLInputElement | null>(null)
const editingId = ref('')
const editName = ref('')
const submitting = ref(false)

const deleteTarget = ref<TaskList | null>(null)
const deleteCount = ref<number | null>(null)
const deleteVisible = ref(false)

const ordered = () => [...lists.value].sort((a, b) => Number(b.is_default) - Number(a.is_default))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    lists.value = await listApi.fetchLists()
  } catch (e) {
    lists.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

function startCreate(): void {
  creating.value = true
  createName.value = ''
  void nextTick(() => createInput.value?.focus())
}

async function submitCreate(): Promise<void> {
  const name = createName.value.trim()
  if (!name || submitting.value) return
  submitting.value = true
  try {
    const created = await listApi.createList(name)
    lists.value = [...lists.value, created]
    creating.value = false
    createName.value = ''
    toast.show('已新建清单')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    submitting.value = false
  }
}

/** 行内输入聚焦（v-for 内使用函数式 ref） */
function focusInput(el: unknown): void {
  const input = el as HTMLInputElement | null
  if (input && typeof input.focus === 'function') window.setTimeout(() => input.focus(), 0)
}

function startEdit(list: TaskList): void {
  editingId.value = String(list.id)
  editName.value = list.name
}

async function submitEdit(): Promise<void> {
  const id = editingId.value
  const name = editName.value.trim()
  if (!id || !name || submitting.value) return
  submitting.value = true
  try {
    const updated = await listApi.renameList(id, name)
    const i = lists.value.findIndex((l) => String(l.id) === id)
    if (i >= 0) lists.value[i] = updated
    editingId.value = ''
    toast.show('已重命名')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    submitting.value = false
  }
}

async function askDelete(list: TaskList): Promise<void> {
  deleteTarget.value = list
  deleteCount.value = null
  deleteVisible.value = true
  try {
    const res = await taskApi.fetchTasks({ list_id: list.id, page: 1, page_size: 1 })
    deleteCount.value = res.total
  } catch {
    // 数量获取失败时用通用文案，不阻塞删除确认
    deleteCount.value = null
  }
}

const deleteText = () => {
  if (deleteCount.value === null) {
    return '删除清单后，其中的任务将移至『默认清单』，任务不会被删除。'
  }
  return `删除清单后，其中 ${deleteCount.value} 个任务将移至『默认清单』，不会被删除。`
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  deleteVisible.value = false
  if (!target) return
  try {
    await listApi.deleteList(target.id)
    lists.value = lists.value.filter((l) => String(l.id) !== String(target.id))
    toast.show('已删除清单')
  } catch (e) {
    toast.show(errorText(e))
  }
}

onMounted(load)
</script>

<template>
  <div class="page lists">
    <header class="lists__head">
      <button class="lists__back pressable" aria-label="返回" @click="$router.back()">‹</button>
      <span class="lists__title">清单管理</span>
      <button class="lists__add pressable" aria-label="新建清单" @click="startCreate">
        <AppIcon name="plus" :size="22" color="#3D5AFE" />
      </button>
    </header>

    <div class="page-body">
      <SkeletonList v-if="loading" :rows="3" />

      <StateError v-else-if="error" :text="error" @retry="load" />

      <template v-else>
        <!-- 新建清单：顶部滑入行内输入 -->
        <div v-if="creating" class="lists__row lists__row--input">
          <input
            ref="createInput"
            v-model="createName"
            class="lists__input"
            placeholder="清单名称…"
            aria-label="新清单名称"
            maxlength="50"
            @keydown.enter="submitCreate"
          />
          <AppButton type="text" :loading="submitting" @click="submitCreate">确认</AppButton>
          <AppButton type="text" @click="creating = false">取消</AppButton>
        </div>

        <ul class="lists__list">
          <li v-for="l in ordered()" :key="String(l.id)" class="lists__row">
            <template v-if="editingId === String(l.id)">
              <input
                :ref="focusInput"
                v-model="editName"
                class="lists__input"
                aria-label="清单名称"
                maxlength="50"
                @keydown.enter="submitEdit"
              />
              <AppButton type="text" :loading="submitting" @click="submitEdit">确认</AppButton>
              <AppButton type="text" @click="editingId = ''">取消</AppButton>
            </template>
            <template v-else>
              <span class="lists__name ellipsis">{{ l.name }}</span>
              <span v-if="l.is_default" class="lists__badge">默认</span>
              <template v-else>
                <button
                  class="lists__action pressable"
                  aria-label="重命名清单"
                  @click="startEdit(l)"
                >
                  <AppIcon name="edit" :size="18" color="#6B7080" />
                </button>
                <button
                  class="lists__action pressable"
                  aria-label="删除清单"
                  @click="askDelete(l)"
                >
                  <AppIcon name="trash" :size="18" color="#F5483B" />
                </button>
              </template>
            </template>
          </li>
        </ul>
      </template>
    </div>

    <AppModal
      :visible="deleteVisible"
      :title="deleteTarget ? `删除清单「${deleteTarget.name}」？` : '删除清单？'"
      :text="deleteText()"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="deleteVisible = false"
    />
  </div>
</template>

<style scoped>
.lists__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.lists__back {
  min-width: 32px;
  min-height: 44px;
  margin-left: -8px;
  font-size: 26px;
  color: var(--color-primary);
  text-align: left;
}
.lists__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  font-weight: 600;
}
.lists__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -10px;
}
.lists__list {
  background: var(--bg-card);
  margin-top: var(--sp-2);
}
.lists__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 52px;
  padding: var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--border-color);
}
.lists__row--input {
  background: var(--bg-card);
  margin-top: var(--sp-2);
}
.lists__name {
  flex: 1;
  font-size: var(--font-body-l);
}
.lists__badge {
  font-size: var(--font-caption);
  color: var(--text-disabled);
}
.lists__input {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  outline: none;
  font-size: var(--font-body-m);
}
.lists__input:focus {
  border-color: var(--color-primary);
}
.lists__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
}
</style>