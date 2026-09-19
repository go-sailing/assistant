<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchAgents } from '@/api/agents'
import { errorText } from '@/api/client'
import type { Agent } from '@/types'
import AppIcon from '@/components/AppIcon.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateEmpty from '@/components/StateEmpty.vue'
import StateError from '@/components/StateError.vue'
import AgentCardRow from '@/components/agents/AgentCardRow.vue'

/**
 * 智能体列表（v0.7.0，UXUI 5.1）：
 * 排序「已连接 > 离线 > 未连接 > 已停用」，组内按最近活跃倒序；停用排最后并置灰；
 * 行点击 → 代理详情；空态主按钮 → 新建代理。
 */
const router = useRouter()

const agents = ref<Agent[]>([])
const loading = ref(true)
const error = ref('')
/** 骨架 >300ms 才出现 */
const showSkeleton = ref(false)
let skeletonTimer: number | undefined

const GROUP: Record<string, number> = { online: 0, offline: 1, never: 2, disabled: 3 }

function groupOf(agent: Agent): string {
  return agent.status === 'disabled' ? 'disabled' : agent.connection
}

function seenTime(agent: Agent): number {
  const t = agent.last_seen_at ? new Date(agent.last_seen_at).getTime() : 0
  return Number.isNaN(t) ? 0 : t
}

const sorted = computed(() =>
  [...agents.value].sort((a, b) => {
    const ga = GROUP[groupOf(a)] ?? 3
    const gb = GROUP[groupOf(b)] ?? 3
    if (ga !== gb) return ga - gb
    return seenTime(b) - seenTime(a)
  })
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  showSkeleton.value = false
  if (skeletonTimer) window.clearTimeout(skeletonTimer)
  skeletonTimer = window.setTimeout(() => {
    if (loading.value) showSkeleton.value = true
  }, 300)
  try {
    agents.value = await fetchAgents()
  } catch (e) {
    agents.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
    if (skeletonTimer) window.clearTimeout(skeletonTimer)
  }
}

function open(agent: Agent): void {
  router.push(`/agents/${agent.id}`)
}

onMounted(load)

onBeforeUnmount(() => {
  if (skeletonTimer) window.clearTimeout(skeletonTimer)
})
</script>

<template>
  <div class="page agents">
    <AppNavBar title="智能体">
      <template #right>
        <button
          class="agents__add pressable"
          type="button"
          aria-label="新建代理"
          @click="router.push('/agents/new')"
        >
          <AppIcon name="plus" :size="22" color="var(--color-primary)" />
        </button>
      </template>
    </AppNavBar>

    <div class="page-body agents__body">
      <SkeletonList v-if="loading && showSkeleton" :rows="3" />
      <p v-else-if="loading" class="agents__loading" aria-live="polite">加载中…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <StateEmpty
        v-else-if="!sorted.length"
        title="还没有智能体代理"
        text="创建代理后，把任务指派给它，工具会自动执行"
        action-text="＋ 新建代理"
        @action="router.push('/agents/new')"
      />

      <ul v-else class="agents__list">
        <AgentCardRow v-for="agent in sorted" :key="agent.id" :agent="agent" @open="open" />
      </ul>
    </div>
  </div>
</template>

<style scoped>
.agents__body {
  padding-bottom: calc(96px + var(--safe-bottom));
}
.agents__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-height: 44px;
  margin-right: -12px;
}
.agents__loading {
  padding: var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.agents__list {
  padding-top: var(--sp-1);
}
</style>
