<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as convApi from '@/api/conversations'
import { errorText } from '@/api/client'
import type { Conversation } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import { useChatStore } from '@/stores/chat'
import { useDrawerStore } from '@/stores/drawer'
import { useToastStore } from '@/stores/toast'
import { formatListTime } from '@/utils/time'

const router = useRouter()
const toast = useToastStore()
const chat = useChatStore()
const drawer = useDrawerStore()

const conversations = ref<Conversation[]>([])
const loading = ref(true)
const error = ref('')
const creating = ref(false)

const actionTarget = ref<Conversation | null>(null)
const actionVisible = ref(false)
const renameVisible = ref(false)
const renameName = ref('')
const deleteVisible = ref(false)

const actionItems = [
  { label: '重命名会话', value: 'rename' },
  { label: '删除会话', value: 'delete', danger: true },
]

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    conversations.value = await convApi.fetchConversations()
  } catch (e) {
    conversations.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function createConversation(): Promise<void> {
  if (creating.value) return
  creating.value = true
  try {
    const conv = await convApi.createConversation()
    router.push(`/chat/${conv.id}`)
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    creating.value = false
  }
}

function openConversation(c: Conversation): void {
  router.push(`/chat/${c.id}`)
}

function openActions(c: Conversation): void {
  actionTarget.value = c
  actionVisible.value = true
}

function onActionSelect(v: string): void {
  actionVisible.value = false
  const target = actionTarget.value
  if (!target) return
  if (v === 'rename') {
    renameName.value = target.title
    renameVisible.value = true
  } else if (v === 'delete') {
    deleteVisible.value = true
  }
}

async function submitRename(): Promise<void> {
  const target = actionTarget.value
  const name = renameName.value.trim()
  if (!target || !name) return
  try {
    const updated = await convApi.renameConversation(target.id, name)
    const i = conversations.value.findIndex((c) => String(c.id) === String(target.id))
    if (i >= 0) conversations.value[i] = updated
    renameVisible.value = false
    toast.show('已重命名')
  } catch (e) {
    toast.show(errorText(e))
  }
}

async function confirmDelete(): Promise<void> {
  const target = actionTarget.value
  deleteVisible.value = false
  if (!target) return
  try {
    await convApi.deleteConversation(target.id)
    conversations.value = conversations.value.filter((c) => String(c.id) !== String(target.id))
    chat.clearConversation(target.id)
    toast.show('已删除会话')
  } catch (e) {
    toast.show(errorText(e))
  }
}

onMounted(load)
</script>

<template>
  <div class="page convs">
    <header class="convs__head">
      <button class="convs__menu pressable" aria-label="打开菜单" @click="drawer.openDrawer('hamburger')">
        <AppIcon name="list" :size="22" />
      </button>
      <h1 class="convs__title">助手</h1>
      <button
        class="convs__add pressable"
        aria-label="发起新对话"
        :disabled="creating"
        @click="createConversation"
      >
        <AppIcon name="plus" :size="24" color="#1A1D26" />
      </button>
    </header>

    <div class="page-body">
      <SkeletonList v-if="loading" :rows="3" />

      <StateError v-else-if="error" :text="error" @retry="load" />

      <StateEmpty
        v-else-if="!conversations.length"
        title="开始和助手对话吧"
        text="一句话就能记录、修改、查询任务"
        action-text="发起新对话"
        @action="createConversation"
      />

      <ul v-else class="convs__list">
        <li v-for="c in conversations" :key="String(c.id)" class="convs__item">
          <button class="convs__main pressable" @click="openConversation(c)">
            <span class="convs__icon" aria-hidden="true">
              <AppIcon name="chat" :size="20" color="#3D5AFE" />
            </span>
            <span class="convs__text">
              <span class="convs__name ellipsis">{{ c.title }}</span>
              <span class="convs__sub">更新于 {{ formatListTime(c.updated_at) }}</span>
            </span>
          </button>
          <button class="convs__more pressable" aria-label="会话操作" @click="openActions(c)">
            <AppIcon name="more" :size="20" color="#6B7080" />
          </button>
        </li>
      </ul>
    </div>

    <AppActionSheet
      :visible="actionVisible"
      :items="actionItems"
      @select="onActionSelect"
      @cancel="actionVisible = false"
    />

    <AppModal
      :visible="renameVisible"
      title="重命名会话"
      confirm-text="保存"
      @confirm="submitRename"
      @cancel="renameVisible = false"
    >
      <input v-model="renameName" class="convs__rename" maxlength="100" aria-label="会话标题" />
    </AppModal>

    <AppModal
      :visible="deleteVisible"
      title="删除该会话？"
      text="会话中的所有消息将被删除，且不可恢复。"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="deleteVisible = false"
    />
  </div>
</template>

<style scoped>
.convs__head {
  display: flex;
  align-items: center;
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
}
.convs__menu {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  color: var(--text-primary);
}
.convs__title {
  flex: 1;
  font-size: var(--font-heading-m);
  font-weight: 600;
}
.convs__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -10px;
}
.convs__list {
  background: var(--bg-card);
}
.convs__item {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
}
.convs__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-2) var(--sp-3) var(--sp-4);
  min-height: 64px;
  text-align: left;
}
.convs__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-primary-light);
  flex-shrink: 0;
}
.convs__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.convs__name {
  font-size: var(--font-body-l);
  color: var(--text-primary);
}
.convs__sub {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.convs__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
}
.convs__rename {
  width: 100%;
  margin-top: var(--sp-4);
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  outline: none;
  font-size: var(--font-body-m);
}
.convs__rename:focus {
  border-color: var(--color-primary);
}
</style>