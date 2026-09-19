<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useToastStore } from '@/stores/toast'

/**
 * 可复制字段（v0.7.0，UXUI 7.2）：
 * 等宽文本 + 复制按钮；优先 navigator.clipboard，失败回退隐藏 textarea + execCommand，
 * 仍失败则自动全选文本并 toast「请长按复制」。
 */
const props = withDefaults(
  defineProps<{ label?: string; value: string; copyLabel?: string }>(),
  { label: '', copyLabel: '' }
)

const toast = useToastStore()
const copied = ref(false)
const valueRef = ref<HTMLElement | null>(null)
let resetTimer: number | undefined

const ariaLabel = computed(() => props.copyLabel || `复制${props.label || ''}`)
const valueLabel = computed(() => (props.label ? `${props.label}，请复制后保存` : '请复制后保存'))

function markCopied(): void {
  copied.value = true
  if (resetTimer) window.clearTimeout(resetTimer)
  resetTimer = window.setTimeout(() => {
    copied.value = false
  }, 800)
}

/** 降级：自动全选文本，提示用户手动长按复制 */
function selectText(): void {
  const el = valueRef.value
  const selection = window.getSelection()
  if (!el || !selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  selection.removeAllRanges()
  selection.addRange(range)
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

async function copy(): Promise<void> {
  const text = props.value
  if (!text) return
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(text)
    markCopied()
    toast.show('已复制')
    return
  } catch {
    /* 继续走降级路径 */
  }
  if (legacyCopy(text)) {
    markCopied()
    toast.show('已复制')
    return
  }
  selectText()
  toast.show('请长按复制')
}

onBeforeUnmount(() => {
  if (resetTimer) window.clearTimeout(resetTimer)
})
</script>

<template>
  <div class="cf">
    <p v-if="label" class="cf__label">{{ label }}</p>
    <div class="cf__row">
      <span ref="valueRef" class="cf__value" :aria-label="valueLabel">{{ value }}</span>
      <button
        class="cf__btn pressable"
        :class="{ 'cf__btn--done': copied }"
        type="button"
        :aria-label="ariaLabel"
        @click="copy"
      >
        <AppIcon
          :name="copied ? 'check' : 'copy'"
          :size="16"
          :color="copied ? 'var(--color-success)' : 'var(--color-primary)'"
        />
        <span>{{ copied ? '已复制' : '复制' }}</span>
      </button>
    </div>
    <span class="cf__live" aria-live="polite">{{ copied ? '已复制' : '' }}</span>
  </div>
</template>

<style scoped>
.cf {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.cf__label {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.cf__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 32px;
}
.cf__value {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 20px;
  color: var(--text-primary);
  word-break: break-all;
}
.cf__btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-shrink: 0;
  height: 32px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-card);
  font-size: var(--font-caption);
  color: var(--color-primary);
}
/* 热区扩展到 44pt */
.cf__btn::after {
  content: '';
  position: absolute;
  inset: -6px -6px;
}
.cf__btn--done {
  color: var(--color-success);
}
.cf__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
