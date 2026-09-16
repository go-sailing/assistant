<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Task } from '@/types'
import AppIcon from '../AppIcon.vue'

/** 父子面包屑：根 › 父 › 当前（当前项不可点） */
const props = defineProps<{ nodes: Task[] }>()

const router = useRouter()

interface Crumb {
  key: string
  label: string
  /** 跳转目标任务 id；空串表示「…」占位 */
  targetId: string
}

/** 过长时中间省略：保留最上层与紧邻的两级，当前项固定在最右 */
const crumbs = computed<Crumb[]>(() => {
  const list = props.nodes || []
  if (list.length <= 3) {
    return list.map((t) => ({ key: String(t.id), label: t.title, targetId: String(t.id) }))
  }
  const first = list[0]
  const parent = list[list.length - 2]
  const current = list[list.length - 1]
  return [
    { key: String(first.id), label: first.title, targetId: String(first.id) },
    { key: 'ellipsis', label: '…', targetId: '' },
    { key: String(parent.id), label: parent.title, targetId: String(parent.id) },
    { key: String(current.id), label: current.title, targetId: String(current.id) },
  ]
})

const currentId = computed(() => {
  const list = props.nodes || []
  return list.length ? String(list[list.length - 1].id) : ''
})

function go(targetId: string): void {
  if (!targetId || targetId === currentId.value) return
  router.push(`/tasks/${targetId}`)
}
</script>

<template>
  <nav v-if="nodes.length > 1" class="crumbs" aria-label="任务层级">
    <template v-for="(c, i) in crumbs" :key="c.key">
      <AppIcon v-if="i > 0" name="chevron-right" :size="12" color="#B5B9C4" />
      <span v-if="!c.targetId" class="crumbs__ellipsis" aria-hidden="true">{{ c.label }}</span>
      <span v-else-if="c.targetId === currentId" class="crumbs__current ellipsis" aria-current="page">
        {{ c.label }}
      </span>
      <button
        v-else
        class="crumbs__link pressable ellipsis"
        type="button"
        :aria-label="`前往父任务 ${c.label}`"
        @click="go(c.targetId)"
      >
        {{ c.label }}
      </button>
    </template>
  </nav>
</template>

<style scoped>
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--sp-2) var(--sp-4);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  white-space: nowrap;
}
.crumbs__link,
.crumbs__current {
  flex-shrink: 0;
  max-width: 44vw;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
.crumbs__link {
  color: var(--color-primary);
}
.crumbs__current {
  color: var(--text-secondary);
}
.crumbs__ellipsis {
  color: var(--text-disabled);
  font-size: var(--font-caption);
}
</style>
