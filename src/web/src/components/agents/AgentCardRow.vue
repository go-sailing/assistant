<script setup lang="ts">
import { computed } from 'vue'
import type { Agent } from '@/types'
import { formatShort } from '@/utils/time'
import AppIcon from '@/components/AppIcon.vue'
import AgentStatusTag from './AgentStatusTag.vue'

/**
 * 代理卡片行（v0.7.0，UXUI 5.1）：
 * 图标 / 名称 / 「类型 · 最近活跃」/ 「进行中 N · 待领取 M」/ 连接状态点；
 * 行点击唯一语义 → 代理详情（不做左滑操作）。
 */
const props = defineProps<{ agent: Agent }>()

const emit = defineEmits<{ (e: 'open', agent: Agent): void }>()

const disabled = computed(() => props.agent.status === 'disabled')
const connectState = computed(() => (disabled.value ? 'disabled' : props.agent.connection))

const CONNECT_TEXT: Record<string, string> = {
  online: '已连接',
  offline: '离线',
  never: '未连接',
  disabled: '已停用',
}

/** 最近活跃：刚刚 / N 分钟前 / N 小时前 / N 天前 / MM-DD HH:mm；从未连接 → 从未连接 */
const lastSeenText = computed(() => {
  const iso = props.agent.last_seen_at
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

const ariaLabel = computed(
  () =>
    `代理 ${props.agent.name}，${CONNECT_TEXT[connectState.value] ?? '未连接'}，` +
    `最近活跃 ${lastSeenText.value}，进行中 ${props.agent.running_count}，待领取 ${props.agent.pending_count}`
)
</script>

<template>
  <li>
    <button
      class="row pressable"
      :class="{ 'row--disabled': disabled }"
      type="button"
      role="button"
      :aria-label="ariaLabel"
      @click="emit('open', agent)"
    >
      <span class="row__icon" :class="{ 'row__icon--disabled': disabled }" aria-hidden="true">
        <AppIcon name="agent" :size="20" :color="disabled ? 'var(--text-disabled)' : 'var(--color-primary)'" />
      </span>
      <span class="row__main">
        <span class="row__top">
          <span class="row__name ellipsis">{{ agent.name }}</span>
          <AgentStatusTag kind="connect" :state="connectState" />
        </span>
        <span class="row__sub ellipsis">{{ agent.kind_label }} · {{ lastSeenText }}</span>
        <span class="row__sub">
          进行中 <span class="row__num">{{ agent.running_count }}</span>
          <template v-if="agent.pending_count > 0">
            · 待领取 <span class="row__num">{{ agent.pending_count }}</span>
          </template>
        </span>
      </span>
      <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
    </button>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 72px;
  padding: var(--sp-3);
  margin: var(--sp-2) var(--sp-4);
  width: calc(100% - var(--sp-4) * 2);
  background: var(--bg-card);
  border-radius: var(--radius-card);
  text-align: left;
}
.row--disabled {
  color: var(--text-disabled);
}
.row__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--color-primary-light);
}
.row__icon--disabled {
  background: var(--color-allday-bg);
}
.row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.row__name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
  color: var(--text-primary);
}
.row--disabled .row__name {
  color: var(--text-disabled);
}
.row__sub {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.row--disabled .row__sub {
  color: var(--text-disabled);
}
.row__num {
  font-variant-numeric: tabular-nums;
}
</style>
