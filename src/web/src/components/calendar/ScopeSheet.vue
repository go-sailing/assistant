<script setup lang="ts">
import { computed } from 'vue'
import type { EventScope } from '@/types'

const props = withDefaults(
  defineProps<{
    visible: boolean
    /** edit 编辑版（含「本次及以后」）/ delete 删除版 */
    mode: 'edit' | 'delete'
    /** 系列总次数（用于危险项文案中的影响数量） */
    totalCount?: number
    /** 本次实例的日期文案，用于「本次及以后」的说明 */
    occurrenceLabel?: string
  }>(),
  { totalCount: undefined, occurrenceLabel: '' }
)

const emit = defineEmits<{
  (e: 'select', scope: EventScope): void
  (e: 'cancel'): void
}>()

interface Option {
  scope: EventScope
  title: string
  desc: string
  danger?: boolean
}

/** 数量文案：未知总次数时退化为「全部日期」，不编造数字 */
const seriesCountText = computed(() => (props.totalCount ? `全部 ${props.totalCount} 次` : '全部'))

const options = computed<Option[]>(() => {
  if (props.mode === 'edit') {
    return [
      { scope: 'this', title: '仅修改本次', desc: '其他日期不受影响' },
      {
        scope: 'following',
        title: '本次及以后',
        desc: props.occurrenceLabel ? `从 ${props.occurrenceLabel} 起按新安排` : '从本次起按新安排',
      },
      { scope: 'series', title: '编辑整条系列', desc: `${seriesCountText.value}一起修改` },
    ]
  }
  return [
    { scope: 'this', title: '仅取消本次', desc: '可在系列详情中恢复' },
    {
      scope: 'series',
      title: '删除整条系列',
      desc: `${seriesCountText.value}安排将被删除，不可恢复`,
      danger: true,
    },
  ]
})

const title = computed(() =>
  props.mode === 'edit' ? '修改这条循环安排？' : '取消这条循环安排？'
)
// 默认强调项永远是「仅本次」（危险范围不作默认）
const DEFAULT_SCOPE: EventScope = 'this'
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="scope" role="dialog" aria-modal="true" :aria-label="title">
      <div class="scope__mask" @click="emit('cancel')" />

      <div class="scope__panel">
        <span class="scope__grabber" aria-hidden="true" />
        <h2 class="scope__title">{{ title }}</h2>

        <ul class="scope__list" role="radiogroup" :aria-label="title">
          <li v-for="opt in options" :key="opt.scope">
            <button
              class="scope__item pressable"
              :class="{ 'scope__item--danger': opt.danger }"
              role="radio"
              :aria-checked="opt.scope === DEFAULT_SCOPE"
              @click="emit('select', opt.scope)"
            >
              <span class="scope__dot" aria-hidden="true" />
              <span class="scope__main">
                <span class="scope__item-title">{{ opt.title }}</span>
                <span class="scope__item-desc">{{ opt.desc }}</span>
              </span>
            </button>
          </li>
        </ul>

        <button class="scope__cancel pressable" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.scope {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.scope__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.scope__panel {
  position: relative;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding: var(--sp-2) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
}
.scope__grabber {
  display: block;
  width: 36px;
  height: 4px;
  margin: 0 auto var(--sp-2);
  border-radius: 2px;
  background: var(--border-color);
}
.scope__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--border-color);
}
.scope__list {
  display: flex;
  flex-direction: column;
}
.scope__item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  width: 100%;
  /* 选项整行可点，热区 ≥ 44pt */
  min-height: 56px;
  padding: var(--sp-3) 0;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}
.scope__dot {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  border: 1.5px solid var(--text-disabled);
}
/* 默认项（仅本次）用实心圆点 + 粗标题强调 */
.scope__item[aria-checked='true'] .scope__dot {
  border-color: var(--color-primary);
  border-width: 5px;
}
.scope__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.scope__item-title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
}
.scope__item[aria-checked='true'] .scope__item-title {
  font-weight: 600;
}
.scope__item-desc {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.scope__item--danger .scope__item-title,
.scope__item--danger .scope__item-desc {
  color: var(--color-danger);
}
.scope__item--danger .scope__dot {
  border-color: var(--color-danger);
}
.scope__item--danger[aria-checked='true'] .scope__dot {
  border-color: var(--color-danger);
}
.scope__cancel {
  width: 100%;
  min-height: 52px;
  margin-top: var(--sp-2);
  font-size: var(--font-body-l);
  font-weight: 500;
  color: var(--text-secondary);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .scope__panel,
.sheet-leave-active .scope__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .scope__panel,
.sheet-leave-to .scope__panel {
  transform: translateY(100%);
}
</style>
