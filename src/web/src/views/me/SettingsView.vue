<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as convApi from '@/api/conversations'
import { listMemories } from '@/api/memories'
import { errorText } from '@/api/client'
import type { UserSettings } from '@/types'
import AppActionSheet from '@/components/AppActionSheet.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useConversationStore } from '@/stores/conversation'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'

/**
 * 系统设置页（UXUI 5.10 / PRD 10.3）。
 *
 * - 开关「切换即保存」：先乐观更新控件，失败**回拨**并 Toast「保存失败，请重试」；
 * - 关闭农历时服务端会一并关闭节气，本地乐观呈现同结果；
 * - 不提供深色模式/字号/推送/多语言等入口。
 */
const router = useRouter()
/** 仅用于「默认启动页」同步到会话内状态（退出/注销入口已在本页移除） */
const auth = useAuthStore()
const chat = useChatStore()
const conversation = useConversationStore()
const settingsStore = useSettingsStore()
const toast = useToastStore()

type BoolFlag = 'lunar_enabled' | 'solar_terms_enabled'

/** 各开关保存中（行内小 spinner），避免连点产生并发写 */
const lunarSaving = ref(false)
const termsSaving = ref(false)
const homeSaving = ref(false)

const homeSheetOpen = ref(false)
const aboutOpen = ref(false)
const clearOpen = ref(false)
const clearing = ref(false)
/** v0.5.0：长期记忆条数（0 条也照常显示，与记忆页同源） */
const memoryCount = ref(0)

const homeLabel = computed(() => (settingsStore.homeRoute === '/tasks' ? '任务' : '日程'))
const termsLabel = computed(() =>
  settingsStore.lunarEnabled ? '二十四节气' : '二十四节气（需先开启显示农历）'
)
const homeItems = [
  { label: '日程', value: '/calendar' },
  { label: '任务', value: '/tasks' },
]

/** 记忆条数：失败静默（不改动其余设置区呈现），下次进入再拉 */
async function loadMemoryCount(): Promise<void> {
  try {
    const res = await listMemories()
    memoryCount.value = res.total ?? (res.list || []).length
  } catch {
    /* 静默：条数属辅助信息，不因它影响设置页可用性 */
  }
}

onMounted(() => {
  void settingsStore.load(true)
  void loadMemoryCount()
})

/** 从记忆页返回（keep-alive 命中时）重新拉取，保证条数即时一致 */
onActivated(() => {
  void loadMemoryCount()
})

/**
 * 开关即改即存：乐观更新 → save；失败回拨到切换前的整份偏好。
 * 关闭农历时先把节气一起置为关（与服务端行为一致，避免中间态显示矛盾）。
 */
async function toggleFlag(flag: BoolFlag): Promise<void> {
  const busy = flag === 'lunar_enabled' ? lunarSaving : termsSaving
  if (busy.value) return
  if (flag === 'solar_terms_enabled' && !settingsStore.lunarEnabled) return

  const before = { ...settingsStore.settings }
  const next = !before[flag]
  busy.value = true
  settingsStore.settings[flag] = next
  if (flag === 'lunar_enabled' && !next) settingsStore.settings.solar_terms_enabled = false

  const patch: Partial<UserSettings> =
    flag === 'lunar_enabled' ? { lunar_enabled: next } : { solar_terms_enabled: next }
  try {
    await settingsStore.save(patch)
  } catch {
    Object.assign(settingsStore.settings, before)
    toast.show('保存失败，请重试')
  } finally {
    busy.value = false
  }
}

/** 默认启动页：选中即保存（下次登录/冷启动生效） */
async function pickHome(value: string): Promise<void> {
  homeSheetOpen.value = false
  const route: UserSettings['home_route'] = value === '/tasks' ? '/tasks' : '/calendar'
  if (route === settingsStore.homeRoute || homeSaving.value) return

  const before = { ...settingsStore.settings }
  homeSaving.value = true
  settingsStore.settings.home_route = route
  try {
    await settingsStore.save({ home_route: route })
    auth.setHomeRoute(route)
    toast.show('下次启动生效')
  } catch {
    Object.assign(settingsStore.settings, before)
    toast.show('保存失败，请重试')
  } finally {
    homeSaving.value = false
  }
}

/** 清除聊天记录：与助手页同一接口与同一确认文案（会话保留，只删消息） */
async function confirmClear(): Promise<void> {
  if (clearing.value) return
  clearing.value = true
  try {
    const id = conversation.conversationId ?? (await conversation.ensureConversationId())
    await convApi.clearConversation(id)
    chat.clearHistory(id)
    conversation.resetWaterline()
    clearOpen.value = false
    toast.show('聊天记录已清除')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    clearing.value = false
  }
}

/* v0.6.0（UI-01）：本页危险区（退出登录 / 注销账号）已移除，
   能力与接口保留，唯一入口为个人信息页危险区。 */
</script>

<template>
  <div class="page settings">
    <AppNavBar title="系统设置" fallback="/calendar" />

    <div class="page-body settings__body">
      <!-- 显示与历法 -->
      <section class="settings__group">
        <h2 class="settings__group-title">显示与历法</h2>
        <ul class="settings__list">
          <li class="settings__row">
            <span class="settings__label">显示农历</span>
            <span v-if="lunarSaving" class="settings__spinner" aria-hidden="true" />
            <button
              class="settings__switch"
              role="switch"
              :aria-checked="settingsStore.lunarEnabled"
              aria-label="显示农历"
              @click="toggleFlag('lunar_enabled')"
            >
              <span class="settings__track"><span class="settings__knob" /></span>
            </button>
          </li>
          <li
            class="settings__row"
            :class="{ 'settings__row--disabled': !settingsStore.lunarEnabled }"
          >
            <span class="settings__label">二十四节气</span>
            <span v-if="termsSaving" class="settings__spinner" aria-hidden="true" />
            <button
              class="settings__switch"
              role="switch"
              :aria-checked="settingsStore.termsEnabled"
              :aria-disabled="!settingsStore.lunarEnabled"
              :disabled="!settingsStore.lunarEnabled"
              :aria-label="termsLabel"
              @click="toggleFlag('solar_terms_enabled')"
            >
              <span class="settings__track"><span class="settings__knob" /></span>
            </button>
          </li>
        </ul>
      </section>

      <!-- 通用 -->
      <section class="settings__group">
        <h2 class="settings__group-title">通用</h2>
        <ul class="settings__list">
          <li>
            <button class="settings__row pressable" @click="homeSheetOpen = true">
              <span class="settings__label">默认启动页</span>
              <span v-if="homeSaving" class="settings__spinner" aria-hidden="true" />
              <span class="settings__value">{{ homeLabel }}</span>
              <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
            </button>
          </li>
        </ul>
      </section>

      <!-- 对话 -->
      <section class="settings__group">
        <h2 class="settings__group-title">对话</h2>
        <ul class="settings__list">
          <!-- v0.5.0：长期记忆（右侧显示条数；从记忆页返回时重新拉取，保证同源一致） -->
          <li>
            <button class="settings__row pressable" @click="router.push('/me/memories')">
              <span class="settings__label">长期记忆</span>
              <span class="settings__value settings__value--num">{{ memoryCount }} 条</span>
              <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
            </button>
          </li>
          <li>
            <button class="settings__row pressable" @click="clearOpen = true">
              <span class="settings__label">清除聊天记录</span>
              <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
            </button>
          </li>
        </ul>
      </section>

      <!-- v0.5.0（UI-02）：账号安全分组已移除（改密唯一入口在个人信息页） -->

      <!-- 关于：只读详情 -->
      <section class="settings__group">
        <h2 class="settings__group-title">关于</h2>
        <ul class="settings__list">
          <li>
            <button class="settings__row pressable" @click="aboutOpen = true">
              <span class="settings__label">关于</span>
              <span class="settings__value">v0.6.0</span>
              <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
            </button>
          </li>
        </ul>
        <p class="settings__caption">长期未使用（30 天）需重新登录</p>
      </section>

      <!-- v0.6.0（UI-01）：危险区（退出登录 / 注销账号）已整体移除。
           退出与注销的唯一入口为「个人信息 → 危险区」。 -->
    </div>

    <AppActionSheet
      :visible="homeSheetOpen"
      title="默认启动页"
      :items="homeItems"
      @select="pickHome"
      @cancel="homeSheetOpen = false"
    />

    <AppModal
      :visible="aboutOpen"
      title="关于"
      confirm-text="知道了"
      cancel-text="关闭"
      @confirm="aboutOpen = false"
      @cancel="aboutOpen = false"
    >
      <div class="about">
        <p class="about__row"><span>应用名称</span><span>个人助手</span></p>
        <p class="about__row"><span>版本</span><span>v0.6.0</span></p>
        <p class="about__tip">日历、任务与助手一体化；长期未使用（30 天）需重新登录。</p>
      </div>
    </AppModal>

    <AppModal
      :visible="clearOpen"
      title="清除聊天记录？"
      text="将永久清除与助手的全部聊天记录，且不可恢复。任务与日程数据不会被删除。"
      confirm-text="清除"
      danger
      :loading="clearing"
      @confirm="confirmClear"
      @cancel="clearOpen = false"
    />
  </div>
</template>

<style scoped>
.settings__body {
  padding-bottom: calc(var(--sp-8) + var(--safe-bottom));
}
.settings__group {
  margin-top: var(--sp-4);
}
.settings__group-title {
  padding: 0 var(--sp-4) var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.settings__list {
  background: var(--bg-card);
}
.settings__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  text-align: left;
}
.settings__list li:last-child .settings__row {
  border-bottom: none;
}
.settings__label {
  flex: 1;
  min-width: 0;
}
.settings__value {
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.settings__value--num {
  font-variant-numeric: tabular-nums;
}
.settings__row--disabled {
  opacity: 0.5;
}
.settings__switch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 51px;
  min-height: 44px;
  flex-shrink: 0;
}
.settings__switch:disabled {
  cursor: not-allowed;
}
.settings__track {
  position: relative;
  display: block;
  width: 51px;
  height: 31px;
  border-radius: 16px;
  background: var(--text-disabled);
  transition: background-color var(--dur-fast) ease;
}
.settings__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(26, 29, 38, 0.2);
  transition: transform var(--dur-fast) ease;
}
.settings__switch[aria-checked='true'] .settings__track {
  background: var(--color-primary);
}
.settings__switch[aria-checked='true'] .settings__knob {
  transform: translateX(20px);
}
.settings__spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 2px solid rgba(61, 90, 254, 0.25);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: settings-spin 0.7s linear infinite;
}
@keyframes settings-spin {
  to {
    transform: rotate(360deg);
  }
}
.settings__caption {
  padding: var(--sp-2) var(--sp-4) 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.about {
  margin-top: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.about__row {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-4);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
}
.about__row span:first-child {
  color: var(--text-secondary);
}
.about__tip {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
</style>