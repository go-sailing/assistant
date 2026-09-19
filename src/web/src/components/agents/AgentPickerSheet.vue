<script setup lang="ts">
import { computed } from 'vue'
import type { Agent } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AgentStatusTag from './AgentStatusTag.vue'

/**
 * 指派/更换代理弹层（v0.7.0，UXUI 5.4）：
 * 列出全部**已启用**代理（含离线，离线也能排队）；已停用代理不出现；
 * 无代理时展示空态说明 + 新建入口。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    agents: Agent[]
    currentAgentId?: number | null
  }>(),
  { currentAgentId: null }
)

const emit = defineEmits<{
  (e: 'select', agentId: number): void
  (e: 'create'): void
  (e: 'cancel'): void
}>()

const enabledAgents = computed(() => props.agents.filter((a) => a.status === 'enabled'))

function connectState(agent: Agent): string {
  return agent.connection
}

function isCurrent(agent: Agent): boolean {
  return props.currentAgentId !== null && props.currentAgentId === agent.id
}

function pick(agent: Agent): void {
  emit('select', agent.id)
}
</script>

<template>
  <Transition name="sheet">
    <div
      v-if="visible"
      class="picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-picker-title"
    >
      <div class="picker__mask" @click="emit('cancel')" />
      <div class="picker__panel sheet-panel">
        <p class="picker__handle" aria-hidden="true" />
        <h3 id="agent-picker-title" class="picker__title">指派给智能体</h3>

        <div v-if="enabledAgents.length" class="picker__list" role="radiogroup" aria-label="选择代理">
          <button
            v-for="agent in enabledAgents"
            :key="agent.id"
            class="picker__item pressable"
            type="button"
            role="radio"
            :aria-checked="isCurrent(agent)"
            @click="pick(agent)"
          >
            <span class="picker__radio" :class="{ 'picker__radio--on': isCurrent(agent) }" aria-hidden="true" />
            <span class="picker__icon" aria-hidden="true">
              <AppIcon name="agent" :size="20" color="var(--color-primary)" />
            </span>
            <span class="picker__main">
              <span class="picker__top">
                <span class="picker__name ellipsis">{{ agent.name }}</span>
                <AgentStatusTag kind="connect" :state="connectState(agent)" />
              </span>
              <span class="picker__sub ellipsis">
                {{ agent.kind_label }} · 进行中 <span class="picker__num">{{ agent.running_count }}</span>
              </span>
            </span>
          </button>
        </div>

        <div v-else class="picker__empty">
          <p class="picker__empty-title">还没有智能体代理</p>
          <AppButton type="primary" @click="emit('create')">
            <AppIcon name="plus" :size="16" color="#fff" />
            新建代理
          </AppButton>
        </div>

        <button class="picker__cancel pressable" type="button" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.picker {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.picker__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.picker__panel {
  position: relative;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding-bottom: var(--safe-bottom);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
}
.picker__handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  margin: var(--sp-2) auto 0;
}
.picker__title {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--font-body-l);
  font-weight: 600;
  text-align: center;
}
.picker__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  border-top: 1px solid var(--border-color);
}
.picker__item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 56px;
  padding: var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}
.picker__radio {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--text-disabled);
  flex-shrink: 0;
}
.picker__radio--on {
  border-color: var(--color-primary);
  background: var(--color-primary);
  box-shadow: inset 0 0 0 3px var(--bg-card);
}
.picker__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--color-primary-light);
}
.picker__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.picker__top {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.picker__name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.picker__sub {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.picker__num {
  font-variant-numeric: tabular-nums;
}
.picker__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-6) var(--sp-4);
}
.picker__empty-title {
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.picker__cancel {
  min-height: 52px;
  margin-top: var(--sp-2);
  border-top: 1px solid var(--border-color);
  font-size: var(--font-body-l);
  font-weight: 500;
  color: var(--text-primary);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .picker__panel,
.sheet-leave-active .picker__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .picker__panel,
.sheet-leave-to .picker__panel {
  transform: translateY(100%);
}
</style>
