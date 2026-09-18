<script setup lang="ts">
import { computed } from 'vue'
import type { ProposalBlock } from '@/types'
import AppButton from '../AppButton.vue'
import AppIcon from '../AppIcon.vue'

/**
 * v0.4.0 助手方案卡（UXUI 5.8 / PRD 8.3）。
 *
 * 方案是「对话层概念」：服务端不持久化状态，status 由前端本地维护。
 * status 缺省 = 历史回看（服务端回填的消息不带状态）→ 一律只读折叠摘要。
 */
const props = defineProps<{ block: ProposalBlock }>()

const emit = defineEmits<{
  (e: 'adopt', block: ProposalBlock): void
  (e: 'adjust', block: ProposalBlock): void
}>()

const status = computed(() => props.block.status)
/** 历史回看：无按钮、无 status 交互 */
const readOnly = computed(() => status.value === undefined)
const superseded = computed(() => status.value === 'superseded')
const executing = computed(() => status.value === 'executing')
/** 折叠为单行摘要：历史回看与执行完成 */
const collapsed = computed(() => readOnly.value || status.value === 'done')
const stateText = computed(() => {
  if (status.value === 'done') return '已完成'
  return ''
})

/** 动作图标：按动作名匹配，无匹配回落到对话图标 */
const icon = computed(() => {
  const t = props.block.title
  if (t.includes('日程')) return 'calendar'
  if (t.includes('任务')) return 'check'
  if (t.includes('删除')) return 'trash'
  return 'chat'
})

/** 单行摘要：参数保留但收起（label + value 平铺，超宽省略） */
const summary = computed(() =>
  props.block.params.map((p) => `${p.label} ${p.value}`).join(' · ')
)

function adopt(): void {
  if (readOnly.value || superseded.value || executing.value) return
  emit('adopt', props.block)
}

function adjust(): void {
  if (readOnly.value || superseded.value || executing.value) return
  emit('adjust', props.block)
}
</script>

<template>
  <div
    class="proposal"
    :class="{ 'proposal--superseded': superseded }"
    role="group"
    :aria-label="`方案：${block.title}`"
    :aria-busy="executing"
  >
    <!-- 折叠摘要：历史回看 / 执行完成 -->
    <div v-if="collapsed" class="proposal__summary">
      <AppIcon :name="icon" :size="16" color="var(--color-primary)" />
      <span class="proposal__summary-title">{{ block.title }}</span>
      <span class="proposal__summary-text ellipsis">{{ summary }}</span>
      <span v-if="stateText" class="proposal__summary-state">{{ stateText }}</span>
    </div>

    <template v-else>
      <p v-if="superseded" class="proposal__caption">已更新方案</p>
      <div class="proposal__head">
        <AppIcon :name="icon" :size="16" color="var(--color-primary)" />
        <span class="proposal__title">{{ block.title }}</span>
      </div>

      <div class="proposal__divider" />

      <dl class="proposal__params">
        <div v-for="(p, i) in block.params" :key="i" class="proposal__param">
          <dt class="proposal__label">{{ p.label }}</dt>
          <dd class="proposal__value">
            {{ p.value }}
            <!-- 助手替用户补的默认值：值尾部小圆点标记（默认说明集中在 note 行） -->
            <span
              v-if="p.defaulted"
              class="proposal__dot"
              role="img"
              aria-label="助手默认值"
            />
          </dd>
        </div>
      </dl>

      <p v-if="block.note" class="proposal__note">{{ block.note }}</p>

      <div class="proposal__divider" />

      <AppButton block :disabled="superseded || executing" @click="adopt">就这么办</AppButton>
      <p v-if="executing" class="proposal__executing">
        <span class="proposal__spinner" aria-hidden="true" />
        正在执行…
      </p>
      <button
        type="button"
        class="proposal__adjust pressable"
        :disabled="superseded || executing"
        @click="adjust"
      >
        调整一下
      </button>
    </template>
  </div>
</template>

<style scoped>
.proposal {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-card);
}
.proposal--superseded {
  opacity: 0.5;
}
.proposal__caption {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.proposal__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.proposal__title {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 600;
}
.proposal__divider {
  border-top: 1px solid var(--border-color);
}
.proposal__params {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.proposal__param {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
}
.proposal__label {
  width: 96px;
  flex-shrink: 0;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
}
.proposal__value {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.proposal__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-left: 4px;
  border-radius: 50%;
  background: var(--color-primary);
  vertical-align: middle;
}
/* 默认说明：暖灰底小字 */
.proposal__note {
  padding: 6px var(--sp-2);
  border-radius: var(--radius-control);
  background: var(--color-allday-bg);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.proposal__executing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.proposal__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-color);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: proposal-spin 0.7s linear infinite;
}
@keyframes proposal-spin {
  to {
    transform: rotate(360deg);
  }
}
.proposal__adjust {
  min-height: 44px;
  font-size: var(--font-body-m);
  color: var(--color-primary);
  text-align: center;
}
.proposal__adjust:disabled {
  color: var(--text-disabled);
}
/* 只读/已完成的单行摘要 */
.proposal__summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
}
.proposal__summary-title {
  flex-shrink: 0;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
}
.proposal__summary-text {
  flex: 1;
  min-width: 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.proposal__summary-state {
  flex-shrink: 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
</style>