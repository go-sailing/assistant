<script setup lang="ts">
import { computed } from 'vue'
import type { Task } from '@/types'
import { dueTone, formatDue } from '@/utils/time'
import AppCheckbox from './AppCheckbox.vue'
import AppIcon from './AppIcon.vue'
import PriorityFlag from './PriorityFlag.vue'
import AgentStatusTag from './agents/AgentStatusTag.vue'

const props = withDefaults(
  defineProps<{
    task: Task
    /** 是否可点击跳详情 */
    clickable?: boolean
    /** 候选卡片等场景隐藏右侧箭头 */
    showArrow?: boolean
  }>(),
  { clickable: true, showArrow: true }
)

const emit = defineEmits<{
  (e: 'detail', task: Task): void
  (e: 'toggle', task: Task): void
}>()

const completed = computed(() => props.task.status === 'completed')
const tone = computed(() => dueTone(props.task))
const timeText = computed(() => formatDue(props.task.due_at))
/** v0.8.0：所属项目（null = 独立任务，不显示项目标识与名称） */
const project = computed(() => props.task.project)
/** v0.7.0：已指派代理时展示代理形态（代理名 + 执行状态胶囊） */
const hasAgent = computed(() => props.task.agent_id !== null && props.task.agent_id !== undefined)
const agentNameText = computed(() => props.task.agent_name || '代理已删除')
</script>

<template>
  <div class="card">
    <div
      class="card__row"
      :class="{ 'card__row--clickable': clickable }"
      role="button"
      tabindex="0"
      :aria-label="`查看任务 ${task.title}`"
      @click="clickable && emit('detail', task)"
      @keydown.enter="clickable && emit('detail', task)"
    >
      <AppCheckbox
        :checked="completed"
        :size="20"
        :label="`标记「${task.title}」完成`"
        @toggle="emit('toggle', task)"
      />
      <div class="card__main">
        <p class="card__title" :class="{ 'card__title--done': completed }">
          <AppIcon v-if="project" name="folder" :size="14" color="var(--color-primary)" />
          {{ task.title }}
        </p>
        <p class="card__sub">
          <!-- v0.8.0 所属项目弱化副信息：独立任务不渲染 -->
          <span v-if="project" class="card__project ellipsis">{{ project.name }}</span>
          <span
            v-if="task.due_at"
            :class="{
              'card__time--danger': tone === 'danger',
              'card__time--warning': tone === 'warning',
            }"
            >{{ timeText }}</span
          >
          <PriorityFlag :priority="task.priority" />
        </p>

        <!-- v0.7.0：代理名 + 执行状态胶囊（含文字，不只靠颜色） -->
        <p v-if="hasAgent" class="card__sub card__agent">
          <span class="card__agent-name ellipsis">{{ agentNameText }}</span>
          <AgentStatusTag kind="exec" :state="task.agent_state" />
        </p>
      </div>
      <AppIcon v-if="showArrow && clickable" name="chevron-right" :size="18" color="#B5B9C4" />
      <slot name="trailing" />
    </div>
    <div v-if="$slots.footer" class="card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-card);
  overflow: hidden;
}
.card__row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-3);
}
.card__row--clickable:active {
  background: #fafbff;
}
.card__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.card__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.card__sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.card__time--danger {
  color: var(--color-danger);
}
.card__time--warning {
  color: var(--color-warning);
}
.card__agent {
  gap: 6px;
}
.card__agent-name {
  min-width: 0;
}
.card__project {
  flex-shrink: 0;
  max-width: 45%;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.card__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--border-color);
}
</style>
