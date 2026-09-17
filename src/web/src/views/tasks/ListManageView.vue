<script setup lang="ts">
import { onMounted, ref } from 'vue'
import * as listApi from '@/api/lists'
import * as taskApi from '@/api/tasks'
import { errorText } from '@/api/client'
import type { TaskList } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import StateError from '@/components/StateError.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import ListFormSheet from '@/components/tasks/ListFormSheet.vue'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const lists = ref<TaskList[]>([])
const loading = ref(true)
const error = ref('')

/** v0.3.0：新建/重命名统一走底部表单弹层（原行内输入已移除） */
const sheetOpen = ref(false)
const sheetMode = ref<'create' | 'rename'>('create')
const sheetTarget = ref<TaskList | null>(null)
const sheetRef = ref<InstanceType<typeof ListFormSheet> | null>(null)

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
  sheetMode.value = 'create'
  sheetTarget.value = null
  sheetOpen.value = true
}

function startEdit(list: TaskList): void {
  sheetMode.value = 'rename'
  sheetTarget.value = list
  sheetOpen.value = true
}

/** 弹层确认：成功关闭并就地更新；失败内联报错（弹层不关、输入不丢） */
async function submitSheet(name: string): Promise<void> {
  const target = sheetTarget.value
  try {
    if (sheetMode.value === 'create') {
      const created = await listApi.createList(name)
      lists.value = [...lists.value, created]
      toast.show('已新建清单')
    } else if (target) {
      const updated = await listApi.renameList(target.id, name)
      const i = lists.value.findIndex((l) => String(l.id) === String(target.id))
      if (i >= 0) lists.value[i] = updated
      toast.show('已重命名')
    }
    sheetRef.value?.done()
    sheetOpen.value = false
  } catch (e) {
    sheetRef.value?.fail(errorText(e))
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
        <ul class="lists__list">
          <li v-for="l in ordered()" :key="String(l.id)" class="lists__row">
            <span class="lists__name ellipsis">{{ l.name }}</span>
            <span v-if="l.is_default" class="lists__badge">默认</span>
            <template v-else>
              <button class="lists__action pressable" aria-label="重命名清单" @click="startEdit(l)">
                <AppIcon name="edit" :size="18" color="#6B7080" />
              </button>
              <button class="lists__action pressable" aria-label="删除清单" @click="askDelete(l)">
                <AppIcon name="trash" :size="18" color="#F5483B" />
              </button>
            </template>
          </li>
        </ul>
      </template>
    </div>

    <ListFormSheet
      ref="sheetRef"
      :visible="sheetOpen"
      :mode="sheetMode"
      :initial-name="sheetTarget?.name ?? ''"
      @confirm="submitSheet"
      @cancel="sheetOpen = false"
    />

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
.lists__name {
  flex: 1;
  font-size: var(--font-body-l);
}
.lists__badge {
  font-size: var(--font-caption);
  color: var(--text-disabled);
}
.lists__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
}
</style>