<script setup lang="ts">
import { computed } from 'vue'
import type { EventScope, ScopeBlock } from '@/types'
import { scopeLabel } from '@/stores/chat'

/**
 * 对话内作用域澄清块（UX 5.10 / 7.2）。
 * 「仅本次」永远排第一位并标注推荐；点选后由 store 组装结构化消息回传，前端不直接写库。
 */
const props = defineProps<{
  block: ScopeBlock
  /** 已选结果：不为空时折叠为一行文本 */
  picked?: string
  /** 助手正在处理时禁止重复点选 */
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'pick', scope: EventScope): void }>()

const FALLBACK: EventScope[] = ['this', 'following', 'series']

/** 推荐项永远排在第一位（服务端下发的顺序不作依赖） */
const options = computed<EventScope[]>(() => {
  const list = props.block.options && props.block.options.length ? props.block.options : FALLBACK
  const rec = props.block.recommended
  return [...list].sort((a, b) => (a === rec ? -1 : b === rec ? 1 : 0))
})

/** 「删除整条系列」为红色危险路径，与「仅取消本次」文案写清差异 */
function isDanger(scope: EventScope): boolean {
  return props.block.tool === 'delete_event' && scope === 'series'
}

function hint(scope: EventScope): string {
  if (props.block.tool === 'delete_event') {
    if (scope === 'this') return '可在系列详情中恢复'
    if (scope === 'following') return '从本次起取消，之前的保留'
    return '全部安排将被删除，不可恢复'
  }
  if (scope === 'this') return '其他日期不受影响'
  if (scope === 'following') return '从本次起使用新安排，之前的保留'
  return '全部日期一起修改'
}
</script>

<template>
  <div class="scope">
    <p class="scope__question">
      <span class="scope__icon" aria-hidden="true">🔁</span>
      {{ block.question || '这次操作要应用到哪一范围？' }}
    </p>

    <p v-if="picked" class="scope__picked">已选择：{{ picked }}</p>

    <div v-else class="scope__options">
      <button
        v-for="s in options"
        :key="s"
        type="button"
        class="scope__option pressable"
        :class="{ 'scope__option--rec': s === block.recommended, 'scope__option--danger': isDanger(s) }"
        :disabled="disabled"
        :aria-label="`${scopeLabel(s)}，${hint(s)}`"
        @click="emit('pick', s)"
      >
        <span class="scope__label">
          {{ scopeLabel(s) }}
          <span v-if="s === block.recommended" class="scope__rec">推荐</span>
        </span>
        <span class="scope__hint">{{ hint(s) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.scope {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--color-primary);
  border-radius: var(--radius-card);
  padding: var(--sp-3);
}
.scope__question {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-word;
}
.scope__icon {
  font-size: var(--font-caption);
  line-height: var(--font-body-m-lh);
}
.scope__options {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.scope__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 44px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-card);
  text-align: left;
}
.scope__option--rec {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.scope__option--danger .scope__label {
  color: var(--color-danger);
}
.scope__option:disabled {
  opacity: 0.6;
}
.scope__label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 500;
  color: var(--text-primary);
}
.scope__rec {
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--color-primary);
  color: #fff;
  font-size: var(--font-caption-s);
  line-height: 18px;
  font-weight: 400;
}
.scope__hint {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.scope__picked {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
}
</style>
