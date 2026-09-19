<script setup lang="ts">
import { computed } from 'vue'

/**
 * 代理状态标签（v0.7.0，UXUI 5.4 / 6.1）：
 * - kind=connect：连接状态点 + 文字（已连接/离线/未连接/已停用），颜色 + 文字双通道；
 * - kind=exec：任务执行状态胶囊（等待代理领取/执行中/已完成（代理）/失败），高 22pt、radius 11。
 */
const props = defineProps<{ kind: 'connect' | 'exec'; state: string }>()

const CONNECT: Record<string, { label: string; color: string }> = {
  online: { label: '已连接', color: 'var(--color-success)' },
  offline: { label: '离线', color: 'var(--text-disabled)' },
  never: { label: '未连接', color: 'var(--text-disabled)' },
  disabled: { label: '已停用', color: 'var(--text-disabled)' },
}

const EXEC: Record<string, string> = {
  pending: '等待代理领取',
  running: '执行中',
  succeeded: '已完成（代理）',
  failed: '失败',
}

const connect = computed(() => CONNECT[props.state] ?? CONNECT.never)
const execLabel = computed(() => EXEC[props.state] ?? '')
</script>

<template>
  <span v-if="kind === 'connect'" class="connect" :style="{ color: connect.color }">
    <span class="connect__dot" :style="{ background: connect.color }" aria-hidden="true" />
    <span class="connect__text">{{ connect.label }}</span>
  </span>
  <span v-else-if="execLabel" class="tag" :class="`tag--${state}`">{{ execLabel }}</span>
</template>

<style scoped>
.connect {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  white-space: nowrap;
}
.connect__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color var(--dur-fast) ease;
}
.tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 var(--sp-2);
  border-radius: 11px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  white-space: nowrap;
  border: 1px solid transparent;
  transition: background-color var(--dur-fast) ease, color var(--dur-fast) ease;
}
.tag--pending {
  background: var(--color-allday-bg);
  color: var(--text-secondary);
}
.tag--running {
  background: var(--color-primary-light);
  color: var(--color-primary);
}
.tag--succeeded {
  background: var(--bg-card);
  color: var(--color-success);
  border-color: var(--color-success);
}
.tag--failed {
  background: var(--color-danger-light, #fdeceb);
  color: var(--color-danger);
}
</style>
