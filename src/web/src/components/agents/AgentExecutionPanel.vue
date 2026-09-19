<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as taskApi from '@/api/tasks'
import { fetchAgents } from '@/api/agents'
import { ApiError, errorText } from '@/api/client'
import type { Agent, AgentState, Task } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import { useToastStore } from '@/stores/toast'
import AgentLogTimeline from './AgentLogTimeline.vue'
import AgentPickerSheet from './AgentPickerSheet.vue'
import AgentStatusTag from './AgentStatusTag.vue'

/**
 * 任务详情「智能体执行」区（v0.7.0，UXUI 5.4 / 7.1）。
 *
 * 指派即自动执行：界面只有「指派 / 更换代理 / 取消指派 / 重新执行」，
 * 不设任何二次触发或暂停类操作；
 * 指派采用乐观更新（立即显示「等待代理领取」），失败回滚并 toast 原因。
 */
const props = defineProps<{ task: Task }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const toast = useToastStore()
const router = useRouter()

/** 乐观态：指派/重新执行后立即呈现，父级任务刷新后由 watch 清除 */
const optimistic = ref<{ state: AgentState; agentName: string; online: boolean } | null>(null)
const displayState = computed<AgentState>(() => optimistic.value?.state ?? props.task.agent_state)
const displayAgentName = computed(() => optimistic.value?.agentName ?? props.task.agent_name ?? '')
const isOnline = computed(() =>
  optimistic.value ? optimistic.value.online : props.task.agent_connection === 'online'
)

const pickerVisible = ref(false)
const agents = ref<Agent[]>([])
const picking = ref(false)
const busy = ref(false)
const confirmUnassign = ref(false)
const reasonExpanded = ref(false)

watch(
  () => props.task.agent_state,
  () => {
    optimistic.value = null
  }
)

watch(
  () => props.task.id,
  () => {
    optimistic.value = null
    reasonExpanded.value = false
  }
)

/** 相对时长：刚刚 / N 分钟 / N 小时 / N 天 */
function durationText(iso: string | null | undefined): string {
  if (!iso) return '刚刚'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '刚刚'
  const ms = Date.now() - t
  if (ms < 60_000) return '刚刚'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

const pendingSub = computed(
  () =>
    `已入队 ${durationText(props.task.agent_queued_at)} · ` +
    (isOnline.value ? '代理在线' : '代理离线，连接后自动领取')
)

const runningSub = computed(() => {
  const d = durationText(props.task.agent_claimed_at)
  return d === '刚刚' ? '领取于刚刚' : `领取于 ${d} 前`
})

const succeededSub = computed(() => {
  const start = props.task.agent_claimed_at ?? props.task.agent_queued_at
  const end = props.task.agent_finished_at
  if (!start || !end) return '已完成'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (Number.isNaN(ms) || ms < 0) return '已完成'
  return `用时 ${Math.max(1, Math.round(ms / 60_000))} 分钟`
})

const failReason = computed(() => props.task.agent_result || '未知原因')

async function openPicker(): Promise<void> {
  if (picking.value) return
  picking.value = true
  try {
    agents.value = await fetchAgents()
  } catch (e) {
    agents.value = []
    toast.show(errorText(e))
  } finally {
    picking.value = false
  }
  pickerVisible.value = true
}

/** 弹层内「新建代理」入口 */
function goCreate(): void {
  pickerVisible.value = false
  router.push('/agents/new')
}

/** 指派/更换代理：乐观呈现「等待代理领取」 */
async function onSelect(agentId: number): Promise<void> {
  const agent = agents.value.find((a) => a.id === agentId)
  pickerVisible.value = false
  if (busy.value) return
  busy.value = true
  optimistic.value = {
    state: 'pending',
    agentName: agent?.name ?? '',
    online: agent?.connection === 'online',
  }
  try {
    await taskApi.assignTaskAgent(props.task.id, agentId, props.task.agent_id !== null)
    emit('changed')
  } catch (e) {
    optimistic.value = null
    toast.show(errorText(e))
  } finally {
    busy.value = false
  }
}

function askUnassign(): void {
  if (displayState.value === 'running') {
    confirmUnassign.value = true
    return
  }
  void doUnassign(false)
}

async function doUnassign(confirm: boolean): Promise<void> {
  if (busy.value) return
  busy.value = true
  confirmUnassign.value = false
  try {
    await taskApi.unassignTaskAgent(props.task.id, confirm)
    optimistic.value = null
    emit('changed')
  } catch (e) {
    // 服务端要求二次确认（执行中）时补弹确认
    if (e instanceof ApiError && e.code === 4021) {
      const need = (e.details as { need_confirm?: boolean } | null)?.need_confirm
      if (need) {
        confirmUnassign.value = true
        return
      }
    }
    toast.show(errorText(e))
  } finally {
    busy.value = false
  }
}

/** 失败后重新执行：重新入队，代理自动再次领取（不自动重试） */
async function retry(): Promise<void> {
  if (busy.value) return
  busy.value = true
  optimistic.value = { state: 'pending', agentName: displayAgentName.value, online: isOnline.value }
  try {
    await taskApi.retryTaskAgent(props.task.id)
    emit('changed')
  } catch (e) {
    optimistic.value = null
    toast.show(errorText(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="ep">
    <h2 class="ep__title">智能体执行</h2>

    <!-- 形态 A：未指派 -->
    <div v-if="displayState === 'none'" class="ep__guide">
      <AppIcon name="agent" :size="24" color="var(--color-primary)" />
      <div class="ep__guide-main">
        <p class="ep__guide-title">把任务交给智能体执行</p>
        <p class="ep__guide-text">指派后代理会自动领取并执行，执行结果会记录在这里。</p>
      </div>
      <AppButton type="secondary" block :loading="picking" @click="openPicker">指派给智能体</AppButton>
    </div>

    <!-- 形态 B：已指派（待领取 / 执行中 / 已完成 / 失败） -->
    <div
      v-else
      class="ep__card"
      :class="{ 'ep__card--failed': displayState === 'failed' }"
      aria-live="polite"
    >
      <div class="ep__card-top">
        <span class="ep__card-icon" aria-hidden="true">
          <AppIcon name="agent" :size="20" color="var(--color-primary)" />
        </span>
        <span class="ep__card-name ellipsis">{{ displayAgentName || '代理' }}</span>
        <AgentStatusTag kind="exec" :state="displayState" />
      </div>

      <p v-if="displayState === 'pending'" class="ep__card-sub">{{ pendingSub }}</p>
      <p v-else-if="displayState === 'running'" class="ep__card-sub">{{ runningSub }}</p>
      <p v-else-if="displayState === 'succeeded'" class="ep__card-sub">{{ succeededSub }}</p>
      <p
        v-else-if="displayState === 'failed'"
        class="ep__card-sub ep__card-sub--danger"
        :class="{ 'ep__card-sub--clamp': !reasonExpanded }"
        role="button"
        tabindex="0"
        @click="reasonExpanded = !reasonExpanded"
        @keydown.enter="reasonExpanded = !reasonExpanded"
      >
        原因：{{ failReason }}
      </p>

      <div class="ep__actions">
        <template v-if="displayState === 'pending'">
          <AppButton size="small" type="secondary" :loading="picking" @click="openPicker">更换代理</AppButton>
          <AppButton size="small" type="text" :disabled="busy" @click="askUnassign">取消指派</AppButton>
        </template>
        <template v-else-if="displayState === 'running'">
          <AppButton size="small" type="secondary" :disabled="busy" @click="askUnassign">取消指派</AppButton>
        </template>
        <template v-else-if="displayState === 'succeeded'">
          <AppButton size="small" type="secondary" :loading="picking" @click="openPicker">更换代理</AppButton>
          <AppButton size="small" type="text" :disabled="busy" @click="askUnassign">取消指派</AppButton>
        </template>
        <template v-else-if="displayState === 'failed'">
          <AppButton size="small" type="primary" :disabled="busy" @click="retry">重新执行</AppButton>
          <AppButton size="small" type="text" :disabled="busy" @click="askUnassign">取消指派</AppButton>
        </template>
      </div>
    </div>

    <template v-if="displayState !== 'none'">
      <h2 class="ep__title ep__title--logs">执行记录</h2>
      <AgentLogTimeline :task-id="task.id" />
    </template>

    <AgentPickerSheet
      :visible="pickerVisible"
      :agents="agents"
      :current-agent-id="task.agent_id"
      @select="onSelect"
      @create="goCreate"
      @cancel="pickerVisible = false"
    />

    <AppModal
      :visible="confirmUnassign"
      title="取消指派？"
      text="代理可能仍在执行，取消后该代理的回报将被拒绝"
      confirm-text="取消指派"
      cancel-text="继续等待"
      danger
      :loading="busy"
      @confirm="doUnassign(true)"
      @cancel="confirmUnassign = false"
    />
  </section>
</template>

<style scoped>
.ep {
  background: var(--bg-card);
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
}
.ep__title {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.ep__title--logs {
  margin-top: var(--sp-4);
}
.ep__guide {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}
.ep__guide-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ep__guide-title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
}
.ep__guide-text {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.ep__card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-card);
  background: var(--bg-card);
}
.ep__card--failed {
  border-color: var(--color-danger);
}
.ep__card-top {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.ep__card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--color-primary-light);
}
.ep__card-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
}
.ep__card-sub {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.ep__card-sub--danger {
  color: var(--color-danger);
}
.ep__card-sub--clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.ep__actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.ep__actions :deep(.btn) {
  min-height: 44px;
  width: auto;
}
.ep__actions :deep(.btn--block) {
  width: auto;
}
</style>
