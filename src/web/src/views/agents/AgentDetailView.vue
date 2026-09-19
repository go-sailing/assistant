<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  deleteAgent,
  fetchAgent,
  fetchAgentTasks,
  rotateAgentToken,
  updateAgent,
} from '@/api/agents'
import { ApiError, BASE_URL, errorText } from '@/api/client'
import type { Agent, AgentStatus, Task } from '@/types'
import { formatShort } from '@/utils/time'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateError from '@/components/StateError.vue'
import AgentConnectGuide from '@/components/agents/AgentConnectGuide.vue'
import AgentCredentialCard from '@/components/agents/AgentCredentialCard.vue'
import AgentStatusTag from '@/components/agents/AgentStatusTag.vue'
import CopyField from '@/components/agents/CopyField.vue'
import { useAgentTokenStore } from '@/stores/agentToken'
import { useToastStore } from '@/stores/toast'

/**
 * 代理详情（v0.7.0，UXUI 5.3）：
 * 头部卡 + 一次性凭据卡（read-once）/ 常态凭据行 + 连接指引 + 绑定任务筛选分页 + 操作区。
 */
const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const agentToken = useAgentTokenStore()

const id = computed(() => String(route.params.id))
/** MCP 接入地址（代理对象不含该字段，按服务端基址推导） */
const MCP_ENDPOINT = `${window.location.origin}${BASE_URL}/mcp`

const PAGE_SIZE = 10
const stateTabs = [
  { label: '全部', value: '' },
  { label: '待领取', value: 'pending' },
  { label: '执行中', value: 'running' },
  { label: '已完成', value: 'succeeded' },
  { label: '失败', value: 'failed' },
]

const agent = ref<Agent | null>(null)
const loading = ref(true)
const loadError = ref('')
const notFound = ref(false)
/** 一次性凭据（read-once）：仅本次会话创建/重置后渲染 */
const oneTimeToken = ref('')

const actionLoading = ref(false)
const disableOpen = ref(false)
const rotateOpen = ref(false)
const deleteOpen = ref(false)
const deleteCounts = ref<{ pending: number; running: number } | null>(null)
const configCopied = ref(false)
let configTimer: number | undefined

const activeState = ref('')
const tasks = ref<Task[]>([])
const taskTotal = ref(0)
const taskPage = ref(1)
const tasksLoading = ref(false)
const tasksError = ref('')

const disabled = computed(() => agent.value?.status === 'disabled')
const connectState = computed(() => {
  if (!agent.value) return 'never'
  return disabled.value ? 'disabled' : agent.value.connection
})

const CONNECT_TEXT: Record<string, string> = {
  online: '已连接',
  offline: '离线',
  never: '未连接',
  disabled: '已停用',
}

const lastSeenText = computed(() => {
  const iso = agent.value?.last_seen_at
  if (!iso) return '从未连接'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '从未连接'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return formatShort(iso)
})

const deleteText = computed(() => {
  const c = deleteCounts.value
  if (!c) return ''
  return `将解除 ${c.pending} 个待领取任务、${c.running} 个执行中任务的指派，且不可恢复`
})

const configText = computed(() => {
  if (!agent.value) return ''
  const slug =
    agent.value.kind_label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'personal-assistant'
  return JSON.stringify(
    {
      mcpServers: {
        [slug]: {
          type: 'http',
          url: MCP_ENDPOINT,
          headers: { Authorization: `Bearer ${oneTimeToken.value || '<凭据>'}` },
        },
      },
    },
    null,
    2
  )
})

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  loadError.value = ''
  try {
    agent.value = await fetchAgent(id.value)
    notFound.value = false
  } catch (e) {
    agent.value = null
    if (e instanceof ApiError && e.status === 404) notFound.value = true
    else loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

async function loadTasks(page = 1, reset = false): Promise<void> {
  tasksLoading.value = true
  tasksError.value = ''
  try {
    const res = await fetchAgentTasks(id.value, {
      state: activeState.value || undefined,
      page,
      page_size: PAGE_SIZE,
    })
    tasks.value = reset || page === 1 ? res.list : [...tasks.value, ...res.list]
    taskTotal.value = res.total
    taskPage.value = res.page ?? page
  } catch (e) {
    tasksError.value = errorText(e)
    if (reset) tasks.value = []
  } finally {
    tasksLoading.value = false
  }
}

function switchTab(value: string): void {
  if (activeState.value === value) return
  activeState.value = value
  void loadTasks(1, true)
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(area)
  return ok
}

async function copyConfig(): Promise<void> {
  const text = configText.value
  if (!text) return
  const done = (): void => {
    configCopied.value = true
    if (configTimer) window.clearTimeout(configTimer)
    configTimer = window.setTimeout(() => {
      configCopied.value = false
    }, 800)
    toast.show('已复制')
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      done()
      return
    }
  } catch {
    /* 走降级路径 */
  }
  if (legacyCopy(text)) {
    done()
    return
  }
  toast.show('请长按复制')
}

function onToggleStatus(): void {
  if (!agent.value) return
  if (agent.value.status === 'enabled') {
    disableOpen.value = true
    return
  }
  void patchStatus('enabled')
}

async function patchStatus(status: AgentStatus): Promise<void> {
  if (!agent.value || actionLoading.value) return
  disableOpen.value = false
  actionLoading.value = true
  try {
    agent.value = await updateAgent(agent.value.id, { status })
    toast.show(status === 'enabled' ? '已启用代理' : '已停用代理')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

async function confirmRotate(): Promise<void> {
  if (!agent.value || actionLoading.value) return
  rotateOpen.value = false
  actionLoading.value = true
  try {
    const res = await rotateAgentToken(agent.value.id)
    agent.value = res.agent
    oneTimeToken.value = res.token
    agentToken.setOneTimeToken(res.agent.id, res.token)
    toast.show('已重置凭据')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

/** 删除前分别取待领取/执行中计数作为确认文案（服务端权威计数） */
async function askDelete(): Promise<void> {
  if (!agent.value) return
  try {
    const [pending, running] = await Promise.all([
      fetchAgentTasks(id.value, { state: 'pending', page: 1, page_size: 1 }),
      fetchAgentTasks(id.value, { state: 'running', page: 1, page_size: 1 }),
    ])
    deleteCounts.value = { pending: pending.total, running: running.total }
  } catch {
    deleteCounts.value = {
      pending: agent.value.pending_count,
      running: agent.value.running_count,
    }
  }
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  if (actionLoading.value) return
  deleteOpen.value = false
  actionLoading.value = true
  try {
    await deleteAgent(id.value)
    toast.show('已删除代理')
    router.replace('/agents')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    actionLoading.value = false
  }
}

function goList(): void {
  router.replace('/agents')
}

onMounted(() => {
  oneTimeToken.value = agentToken.takeOneTimeToken(Number(id.value)) ?? ''
  void load()
  void loadTasks(1, true)
})

onBeforeUnmount(() => {
  oneTimeToken.value = ''
  agentToken.clear()
  if (configTimer) window.clearTimeout(configTimer)
})
</script>

<template>
  <div class="page detail">
    <AppNavBar title="代理详情" fallback="/agents">
      <template #right>
        <button
          class="detail__edit pressable"
          type="button"
          @click="router.push(`/agents/${id}/edit`)"
        >
          编辑
        </button>
      </template>
    </AppNavBar>

    <div class="page-body detail__body">
      <SkeletonList v-if="loading" :rows="3" />

      <StateError
        v-else-if="notFound"
        title="代理不存在或已被删除"
        text="该代理可能已被删除，请返回列表查看"
        @retry="goList"
      >
        <template #action>返回代理列表</template>
      </StateError>

      <StateError v-else-if="loadError" :text="loadError" @retry="load()" />

      <template v-else-if="agent">
        <!-- 头部卡 -->
        <section class="detail__head">
          <span class="detail__head-icon" aria-hidden="true">
            <AppIcon
              name="agent"
              :size="24"
              :color="disabled ? 'var(--text-disabled)' : 'var(--color-primary)'"
            />
          </span>
          <div class="detail__head-main">
            <div class="detail__head-top">
              <h1 class="detail__name ellipsis">{{ agent.name }}</h1>
              <AgentStatusTag kind="connect" :state="connectState" />
            </div>
            <p class="detail__sub">{{ agent.kind_label }} · {{ lastSeenText }}</p>
            <p class="detail__sub">
              进行中 <span class="detail__num">{{ agent.running_count }}</span> · 待领取
              <span class="detail__num">{{ agent.pending_count }}</span>
            </p>
          </div>
        </section>

        <p class="detail__sr" aria-live="polite">{{ CONNECT_TEXT[connectState] ?? '未连接' }}</p>

        <!-- 形态 A：一次性凭据卡 -->
        <AgentCredentialCard
          v-if="oneTimeToken"
          :token="oneTimeToken"
          :endpoint="MCP_ENDPOINT"
          :kind-label="agent.kind_label"
        />

        <!-- 形态 B：常态凭据行 -->
        <section v-else class="detail__group">
          <h2 class="detail__section-title">
            <AppIcon name="key" :size="16" color="#6B7080" />
            接入凭据
          </h2>
          <div class="cred">
            <div class="cred__row">
              <span class="cred__label">凭据</span>
              <span class="cred__value">{{ agent.token_prefix }}…</span>
              <AppButton
                size="small"
                type="secondary"
                :disabled="actionLoading"
                @click="rotateOpen = true"
              >
                重置
              </AppButton>
            </div>
            <CopyField label="接入地址" :value="MCP_ENDPOINT" copy-label="复制接入地址" />
            <AppButton type="secondary" block :disabled="actionLoading" @click="copyConfig">
              <AppIcon
                :name="configCopied ? 'check' : 'copy'"
                :size="16"
                :color="configCopied ? 'var(--color-success)' : 'var(--color-primary)'"
              />
              {{ configCopied ? '已复制' : '复制接入配置' }}
            </AppButton>
          </div>
        </section>

        <AgentConnectGuide :kind-label="agent.kind_label" />

        <!-- 绑定任务 -->
        <section class="detail__group">
          <h2 class="detail__section-title">绑定任务</h2>
          <div class="tabs" role="tablist" aria-label="绑定任务筛选">
            <button
              v-for="tab in stateTabs"
              :key="tab.value"
              class="tabs__item pressable"
              :class="{ 'tabs__item--on': activeState === tab.value }"
              type="button"
              role="tab"
              :aria-selected="activeState === tab.value"
              @click="switchTab(tab.value)"
            >
              {{ tab.label }}
            </button>
          </div>

          <p v-if="tasksLoading && !tasks.length" class="detail__state">加载中…</p>
          <p v-else-if="tasksError" class="detail__state detail__state--error">
            {{ tasksError }}
            <button class="detail__retry pressable" type="button" @click="loadTasks(1, true)">重试</button>
          </p>
          <div v-else-if="!tasks.length" class="detail__empty">
            <p>{{ activeState ? '当前筛选下没有被指派的任务' : '还没有被指派的任务' }}</p>
            <p v-if="!activeState" class="detail__empty-hint">在任务详情点「指派给智能体」即可</p>
          </div>
          <ul v-else class="bd">
            <li v-for="t in tasks" :key="String(t.id)">
              <button
                class="bd__row pressable"
                type="button"
                :aria-label="`查看任务 ${t.title}`"
                @click="router.push(`/tasks/${t.id}`)"
              >
                <span class="bd__dot" :class="`bd__dot--${t.agent_state}`" aria-hidden="true" />
                <span class="bd__title ellipsis">{{ t.title }}</span>
                <AgentStatusTag kind="exec" :state="t.agent_state" />
                <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
              </button>
            </li>
          </ul>
          <button
            v-if="tasks.length && tasks.length < taskTotal"
            class="detail__more pressable"
            type="button"
            @click="loadTasks(taskPage + 1)"
          >
            加载更多
          </button>
        </section>

        <!-- 操作区 -->
        <section class="ops">
          <button
            class="ops__row pressable"
            type="button"
            :disabled="actionLoading"
            @click="onToggleStatus"
          >
            <span class="ops__label">{{ agent.status === 'enabled' ? '停用代理' : '启用代理' }}</span>
            <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
          </button>
          <button
            class="ops__row pressable"
            type="button"
            :disabled="actionLoading"
            @click="rotateOpen = true"
          >
            <span class="ops__label">重置凭据</span>
            <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
          </button>
          <button
            class="ops__row ops__row--danger pressable"
            type="button"
            :disabled="actionLoading"
            @click="askDelete"
          >
            <span class="ops__label">删除代理</span>
            <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
          </button>
        </section>
      </template>
    </div>

    <AppModal
      :visible="disableOpen"
      title="停用代理？"
      text="停用后该代理将无法再接取新任务，已接入的工具调用会失败"
      confirm-text="停用"
      cancel-text="取消"
      danger
      :loading="actionLoading"
      @confirm="patchStatus('disabled')"
      @cancel="disableOpen = false"
    />

    <AppModal
      :visible="rotateOpen"
      title="重置凭据？"
      text="旧凭据将立即失效，已接入的工具需要更新配置"
      confirm-text="重置"
      cancel-text="取消"
      danger
      :loading="actionLoading"
      @confirm="confirmRotate"
      @cancel="rotateOpen = false"
    />

    <AppModal
      :visible="deleteOpen"
      title="删除代理？"
      :text="deleteText"
      confirm-text="删除"
      cancel-text="取消"
      danger
      :loading="actionLoading"
      @confirm="confirmDelete"
      @cancel="deleteOpen = false"
    />
  </div>
</template>

<style scoped>
.detail__body {
  padding-bottom: calc(96px + var(--safe-bottom));
}
.detail__edit {
  min-width: 44px;
  min-height: 44px;
  margin-right: -12px;
  font-size: var(--font-body-l);
  color: var(--color-primary);
}
.detail__head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.detail__head-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--color-primary-light);
}
.detail__head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.detail__head-top {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.detail__name {
  flex: 1;
  min-width: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}
.detail__sub {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.detail__num {
  font-variant-numeric: tabular-nums;
}
.detail__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.detail__group {
  margin-top: var(--sp-2);
  padding: var(--sp-3) var(--sp-4) var(--sp-4);
  background: var(--bg-card);
}
.detail__section-title {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.cred {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.cred__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
}
.cred__label {
  flex-shrink: 0;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.cred__value {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}
.tabs {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.tabs__item {
  flex-shrink: 0;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border-bottom: 2px solid transparent;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.tabs__item--on {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 500;
}
.detail__state {
  padding: var(--sp-3) 0;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.detail__state--error {
  color: var(--color-danger);
}
.detail__retry {
  margin-left: var(--sp-1);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
.detail__empty {
  padding: var(--sp-3) 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.detail__empty-hint {
  color: var(--text-disabled);
}
.bd {
  display: flex;
  flex-direction: column;
}
.bd__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 52px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}
.bd__dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--color-timeline);
}
.bd__dot--pending {
  background: var(--color-timeline);
}
.bd__dot--running {
  background: var(--color-primary);
}
.bd__dot--succeeded {
  background: var(--color-success);
}
.bd__dot--failed {
  background: var(--color-danger);
}
.bd__title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.detail__more {
  margin-top: var(--sp-3);
  min-height: 44px;
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.ops {
  margin-top: var(--sp-2);
  background: var(--bg-card);
}
.ops__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-body-l);
  text-align: left;
}
.ops__row:last-child {
  border-bottom: none;
}
.ops__row--danger .ops__label {
  color: var(--color-danger);
}
.ops__row:disabled {
  opacity: 0.5;
}
</style>
