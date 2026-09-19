<script setup lang="ts">
import type { Task } from '@/types'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'
import PriorityFlag from '@/components/PriorityFlag.vue'
import { dueTone, formatDue } from '@/utils/time'

/**
 * 项目成员列表（v0.6.0）：成员仅一层；
 * 行内可直接勾选完成，点击进入成员任务详情。
 */
defineProps<{
  members: Task[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', task: Task): void
  (e: 'detail', task: Task): void
}>()

function toneOf(task: Task): string {
  return dueTone(task)
}
</script>

<template>
  <ul class="members">
    <li v-for="m in members" :key="String(m.id)" class="members__item">
      <AppCheckbox
        :checked="m.status === 'completed'"
        :disabled="disabled"
        :label="`标记成员「${m.title}」完成`"
        @toggle="emit('toggle', m)"
      />
      <button
        class="members__main pressable"
        type="button"
        :aria-label="`查看成员任务 ${m.title}`"
        @click="emit('detail', m)"
      >
        <span class="members__title ellipsis" :class="{ 'members__title--done': m.status === 'completed' }">
          {{ m.title }}
        </span>
        <span class="members__sub">
          <span
            v-if="m.due_at"
            class="members__time"
            :class="{
              'members__time--danger': toneOf(m) === 'danger',
              'members__time--warning': toneOf(m) === 'warning',
            }"
            >{{ formatDue(m.due_at) }}</span
          >
          <PriorityFlag :priority="m.priority" />
        </span>
      </button>
      <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
    </li>
  </ul>
</template>

<style scoped>
.members {
  background: var(--bg-card);
}
.members__item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 56px;
  padding: var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--border-color);
}
.members__item:last-child {
  border-bottom: none;
}
.members__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.members__title {
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.members__title--done {
  color: var(--text-disabled);
  text-decoration: line-through;
}
.members__sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  min-height: 16px;
}
.members__time--danger {
  color: var(--color-danger);
}
.members__time--warning {
  color: var(--color-warning);
}
</style>
