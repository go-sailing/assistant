<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { clearMemories, deleteMemory, listMemories } from '@/api/memories'
import { errorText } from '@/api/client'
import type { Memory } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import MemoryCard from '@/components/MemoryCard.vue'
import StateError from '@/components/StateError.vue'
import { useToastStore } from '@/stores/toast'

/**
 * v0.5.0 长期记忆管理页 /me/memories（UXUI 5.4 / SDD 3.4）。
 *
 * - 进入即拉取；失败给错误占位 + 重试（云端无缓存，不展示陈旧列表）；
 * - 单条删除：轻确认一次即生效（删除后下一轮模型请求不再注入）；
 * - 全部删除：危险二次确认，文案带实际条数；
 * - 空态提供「去助手」引导；内容按纯文本渲染（XSS 面无新增）。
 */
const router = useRouter()
const toast = useToastStore()

const list = ref<Memory[]>([])
const loading = ref(true)
const error = ref('')
const removingId = ref<number | null>(null)

/** 单条删除确认 */
const oneOpen = ref(false)
const oneTarget = ref<Memory | null>(null)
const oneWorking = ref(false)
/** 全部删除确认 */
const allOpen = ref(false)
const allWorking = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await listMemories()
    list.value = res.list || []
  } catch (e) {
    list.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function askRemove(memory: Memory): void {
  oneTarget.value = memory
  oneOpen.value = true
}

async function confirmRemove(): Promise<void> {
  const target = oneTarget.value
  if (!target || oneWorking.value) return
  oneWorking.value = true
  try {
    await deleteMemory(target.id)
    // 离场动画后从列表移除（不做撤销，删除即生效）
    removingId.value = target.id
    window.setTimeout(() => {
      list.value = list.value.filter((m) => m.id !== target.id)
      removingId.value = null
    }, 200)
    oneOpen.value = false
    toast.show('已删除')
  } catch (e) {
    // 失败保留卡片，不改变列表
    toast.show(errorText(e))
  } finally {
    oneWorking.value = false
  }
}

async function confirmClearAll(): Promise<void> {
  if (allWorking.value) return
  allWorking.value = true
  try {
    await clearMemories()
    list.value = []
    allOpen.value = false
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    allWorking.value = false
  }
}
</script>

<template>
  <div class="page memories">
    <AppNavBar title="长期记忆" fallback="/settings" />

    <div class="page-body memories__body">
      <p class="memories__intro">归档聊天记录时自动提炼，用于让助手更了解你的长期情况。</p>

      <p v-if="loading" class="memories__loading">正在加载…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <div v-else-if="!list.length" class="memories__empty">
        <AppIcon name="brain" :size="56" color="#B5B9C4" />
        <p class="memories__empty-title">还没有长期记忆</p>
        <p class="memories__empty-tip">在助手页归档一次聊天记录，助手会帮你提炼。</p>
        <AppButton type="primary" class="memories__empty-btn" @click="router.push('/chat')">
          去助手
        </AppButton>
      </div>

      <template v-else>
        <ul class="memories__list">
          <li v-for="m in list" :key="m.id">
            <MemoryCard
              :memory="m"
              :removing="removingId === m.id"
              @remove="askRemove"
            />
          </li>
        </ul>
        <AppButton type="secondary" class="memories__clear" @click="allOpen = true">
          全部删除
        </AppButton>
      </template>
    </div>

    <AppModal
      :visible="oneOpen"
      title="删除这条记忆？"
      text="删除后助手将不再参考它。"
      confirm-text="删除"
      danger
      :loading="oneWorking"
      @confirm="confirmRemove"
      @cancel="oneOpen = false"
    />

    <AppModal
      :visible="allOpen"
      title="删除全部长期记忆？"
      :text="`将删除全部 ${list.length} 条记忆，之后助手将完全不了解你的历史偏好，且不可恢复。`"
      confirm-text="全部删除"
      danger
      :loading="allWorking"
      @confirm="confirmClearAll"
      @cancel="allOpen = false"
    />
  </div>
</template>

<style scoped>
.memories__body {
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
}
.memories__intro {
  padding: var(--sp-4);
  font-size: 13px;
  line-height: 20px;
  color: var(--text-secondary);
}
.memories__loading {
  padding: var(--sp-6);
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.memories__list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: 0 var(--sp-4);
}
.memories__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-8) var(--sp-6);
  text-align: center;
}
.memories__empty-title {
  margin-top: var(--sp-3);
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.memories__empty-tip {
  font-size: 13px;
  line-height: 20px;
  color: var(--text-secondary);
}
.memories__empty-btn {
  margin-top: var(--sp-4);
  min-width: 160px;
}
.memories__clear {
  margin: var(--sp-6) var(--sp-4) 0;
}
</style>