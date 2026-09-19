<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useToastStore } from '@/stores/toast'

/**
 * 连接指引（v0.7.0，UXUI 5.3 / 6.3）：
 * 按代理类型展示 MCP 配置片段（含接入地址与凭据占位），可折叠 + 复制；
 * 代码块复用聊天代码块 token（深底浅字、横向可滚动）。
 */
const props = defineProps<{ kindLabel: string }>()

const toast = useToastStore()
const open = ref(true)
const copied = ref(false)
let resetTimer: number | undefined

const serverKey = computed(() => {
  const slug = props.kindLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'personal-assistant'
})

const snippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        [serverKey.value]: {
          type: 'http',
          url: '<MCP 接入地址>',
          headers: { Authorization: 'Bearer <凭据>' },
        },
      },
    },
    null,
    2
  )
)

function markCopied(): void {
  copied.value = true
  if (resetTimer) window.clearTimeout(resetTimer)
  resetTimer = window.setTimeout(() => {
    copied.value = false
  }, 800)
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
  const text = snippet.value
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
  toast.show('请长按复制')
}
</script>

<template>
  <section class="guide">
    <h2 class="guide__title">
      <AppIcon name="key" :size="16" color="#6B7080" />
      连接指引
    </h2>

    <button
      class="guide__head pressable"
      type="button"
      :aria-expanded="open"
      aria-controls="agent-connect-snippet"
      @click="open = !open"
    >
      <span class="guide__head-text ellipsis">{{ kindLabel }} 配置示例</span>
      <AppIcon :name="open ? 'chevron-down' : 'chevron-right'" :size="16" color="#6B7080" />
    </button>

    <div v-show="open" id="agent-connect-snippet" class="guide__body">
      <button class="guide__copy pressable" type="button" aria-label="复制配置示例" @click="copy">
        <AppIcon
          :name="copied ? 'check' : 'copy'"
          :size="16"
          :color="copied ? 'var(--color-success)' : 'var(--color-code-text)'"
        />
      </button>
      <pre class="guide__code"><code>{{ snippet }}</code></pre>
      <span class="guide__live" aria-live="polite">{{ copied ? '已复制' : '' }}</span>
    </div>
  </section>
</template>

<style scoped>
.guide {
  background: var(--bg-card);
  padding: 0 0 var(--sp-3);
}
.guide__title {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--sp-3) var(--sp-4) var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.guide__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  width: 100%;
  min-height: 44px;
  padding: 0 var(--sp-4);
  border-top: 1px solid var(--border-color);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.guide__head-text {
  min-width: 0;
}
.guide__body {
  position: relative;
  padding: var(--sp-3) var(--sp-4) 0;
}
.guide__copy {
  position: absolute;
  top: calc(var(--sp-3) + 4px);
  right: calc(var(--sp-4) + 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
}
.guide__copy::after {
  content: '';
  position: absolute;
  inset: -8px;
}
.guide__code {
  margin: 0;
  padding: var(--sp-3);
  border-radius: var(--radius-control);
  background: var(--color-code-bg);
  color: var(--color-code-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 20px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.guide__code code {
  white-space: pre;
}
.guide__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
