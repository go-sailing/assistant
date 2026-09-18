<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from './AppIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useDrawerStore } from '@/stores/drawer'

/**
 * 全局左侧抽屉（系统设计文档 3.2 / UXUI 5.9）：
 * 纯前端覆盖层，替代 v0.1.0 的底部 Tab；不改变路由表与 URL 规则。
 * 开合的历史栈处理（后退优先关抽屉）由 App.vue 统一负责，本组件只上报意图。
 */
const drawer = useDrawerStore()
const auth = useAuthStore()
const route = useRoute()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'navigate', to: string): void
}>()

const panelRef = ref<HTMLElement | null>(null)

const ITEMS = [
  { key: 'calendar', label: '日程', icon: 'calendar', to: '/calendar' },
  { key: 'tasks', label: '任务', icon: 'list', to: '/tasks' },
  { key: 'chat', label: '助手', icon: 'chat', to: '/chat' },
] as const

const open = computed(() => drawer.open)

/** 按路由前缀高亮一级入口 */
const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/calendar')) return 'calendar'
  if (path.startsWith('/tasks') || path.startsWith('/lists') || path.startsWith('/search')) return 'tasks'
  if (path.startsWith('/chat')) return 'chat'
  return ''
})

const email = computed(() => auth.email)
/** 主文案：有昵称显示昵称，否则显示邮箱 */
const accountPrimary = computed(() => auth.nickname?.trim() || auth.email || '当前账号')

/**
 * 超长主文案中间省略（UXUI 3.2）：
 * 邮箱类文本首尾都能区分账号，中间省略比尾部省略更易识别。
 */
function middleEllipsis(text: string, max = 18): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) / 2)
  const tail = max - 1 - head
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

const primaryDisplay = computed(() => middleEllipsis(accountPrimary.value))

/** 焦点陷阱：打开后聚焦首个可聚焦元素，Tab 在面板内循环 */
function focusables(): HTMLElement[] {
  const root = panelRef.value
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const nodes = focusables()
  if (nodes.length === 0) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && (active === first || !nodes.includes(active as HTMLElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(open, async (value) => {
  if (value) {
    await nextTick()
    focusables()[0]?.focus()
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition name="drawer-mask">
    <div v-if="open" class="drawer__mask" @click="emit('close')" />
  </Transition>
  <Transition name="drawer-panel">
    <aside
      v-if="open"
      ref="panelRef"
      class="drawer"
      role="dialog"
      aria-modal="true"
      aria-label="主导航菜单"
    >
      <div class="drawer__brand">个人助手</div>
      <nav class="drawer__nav">
        <button
          v-for="item in ITEMS"
          :key="item.key"
          class="drawer__item pressable"
          :class="{ 'drawer__item--active': activeKey === item.key }"
          :aria-current="activeKey === item.key ? 'page' : undefined"
          @click="emit('navigate', item.to)"
        >
          <AppIcon :name="item.icon" :size="22" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="drawer__foot">
        <!-- 账号区：整块进个人信息；齿轮为独立 44pt 热区进设置。
             v0.5.0（UI-03）：底部独立「退出」按钮已移除，退出登录保留在 /me、/settings 危险区 -->
        <div class="drawer__account">
          <button
            class="drawer__account-main pressable"
            aria-label="个人信息"
            @click="emit('navigate', '/me')"
          >
            <span class="drawer__avatar" aria-hidden="true">{{ auth.avatarInitial }}</span>
            <span class="drawer__account-text">
              <span class="drawer__account-primary ellipsis">{{ primaryDisplay }}</span>
              <span v-if="auth.nickname" class="drawer__account-secondary ellipsis">
                {{ email }}
              </span>
            </span>
          </button>
          <button
            class="drawer__gear pressable"
            aria-label="系统设置"
            @click="emit('navigate', '/settings')"
          >
            <AppIcon name="gear" :size="20" />
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.drawer__mask {
  position: fixed;
  inset: 0;
  background: rgba(26, 29, 38, 0.4);
  z-index: 40;
}
.drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(80%, 320px);
  background: var(--bg-card);
  z-index: 41;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 16px rgba(26, 29, 38, 0.16);
}
.drawer__brand {
  height: calc(120px + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  display: flex;
  align-items: center;
  color: var(--color-primary);
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
}
.drawer__nav {
  flex: 1;
  padding: 0 var(--sp-2);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.drawer__item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 48px;
  padding: 0 var(--sp-3);
  border-radius: var(--radius-control);
  color: var(--text-secondary);
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  text-align: left;
}
.drawer__item--active {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: 600;
}
.drawer__foot {
  border-top: 1px solid var(--border-color);
  padding: var(--sp-3) var(--sp-3) calc(var(--sp-3) + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.drawer__account {
  display: flex;
  align-items: center;
}
.drawer__account-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 48px;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-control);
  text-align: left;
}
.drawer__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--font-body-l);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.drawer__account-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.drawer__account-primary {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
}
.drawer__account-secondary {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.drawer__gear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  color: var(--text-secondary);
}
.drawer-mask-enter-active,
.drawer-mask-leave-active {
  transition: opacity var(--dur-page) ease;
}
.drawer-mask-enter-from,
.drawer-mask-leave-to {
  opacity: 0;
}
.drawer-panel-enter-active,
.drawer-panel-leave-active {
  transition: transform var(--dur-page) ease;
}
.drawer-panel-enter-from,
.drawer-panel-leave-to {
  transform: translateX(-100%);
}
</style>
