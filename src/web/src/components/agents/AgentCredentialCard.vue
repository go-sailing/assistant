<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useToastStore } from '@/stores/toast'
import CopyField from './CopyField.vue'

/**
 * 一次性凭据卡（v0.7.0，UXUI 5.3 形态 A / 7.2）：
 * 警示条 + 凭据 + MCP 接入地址 + 「复制接入配置（含凭据）」。
 * 仅由页面状态控制渲染，离开页面即销毁。
 */
const props = defineProps<{ token: string; endpoint: string; kindLabel: string }>()

const toast = useToastStore()
const configCopied = ref(false)
let resetTimer: number | undefined

/** MCP 配置片段：可直接粘贴，server key 由类型名派生 */
const serverKey = computed(() => {
  const slug = props.kindLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'personal-assistant'
})

const configText = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        [serverKey.value]: {
          type: 'http',
          url: props.endpoint,
          headers: { Authorization: `Bearer ${props.token}` },
        },
      },
    },
    null,
    2
  )
)

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

function markCopied(): void {
  configCopied.value = true
  if (resetTimer) window.clearTimeout(resetTimer)
  resetTimer = window.setTimeout(() => {
    configCopied.value = false
  }, 800)
}

async function copyConfig(): Promise<void> {
  const text = configText.value
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

onBeforeUnmount(() => {
  if (resetTimer) window.clearTimeout(resetTimer)
})
</script>

<template>
  <section class="cred" role="region" aria-label="接入凭据，仅显示一次">
    <div class="cred__notice">
      <AppIcon name="alert" :size="18" color="var(--color-notice-text)" />
      <div>
        <p class="cred__notice-title">凭据仅显示这一次</p>
        <p class="cred__notice-text">请立即复制保存，离开本页后不再显示</p>
      </div>
    </div>

    <div class="cred__fields">
      <CopyField label="凭据" :value="token" copy-label="复制凭据" />
      <CopyField label="MCP 接入地址" :value="endpoint" copy-label="复制接入地址" />
    </div>

    <AppButton type="secondary" block @click="copyConfig">
      <AppIcon
        :name="configCopied ? 'check' : 'copy'"
        :size="16"
        :color="configCopied ? 'var(--color-success)' : 'var(--color-primary)'"
      />
      {{ configCopied ? '已复制' : '复制接入配置（含凭据）' }}
    </AppButton>
    <span class="cred__live" aria-live="polite">{{ configCopied ? '已复制' : '' }}</span>
  </section>
</template>

<style scoped>
.cred {
  position: relative;
  margin: var(--sp-2) var(--sp-4);
  padding: var(--sp-3);
  padding-left: calc(var(--sp-3) + 3px);
  border-radius: var(--radius-control);
  background: var(--color-notice-bg);
  color: var(--color-notice-text);
  border-left: 3px solid var(--color-notice-text);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.cred__notice {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
}
.cred__notice-title {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  font-weight: 600;
}
.cred__notice-text {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
.cred__fields {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid rgba(138, 90, 0, 0.2);
}
.cred__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
