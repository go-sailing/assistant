<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as convApi from '@/api/conversations'
import { getProfile, updateNickname } from '@/api/settings'
import { errorText } from '@/api/client'
import type { UserProfile } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import StateError from '@/components/StateError.vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useConversationStore } from '@/stores/conversation'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'

/**
 * 个人信息页（UXUI 5.9 / PRD 10.2）。
 *
 * - 资料以 GET /me 为权威，进入即拉取；加载中先用 auth store 兜底渲染头像/文案，
 *   失败给错误占位 + 重试（不展示陈旧数据）；
 * - 昵称编辑弹层沿用 ListFormSheet 的视觉规范（标题 / 全宽输入 / 纵向按钮 / 失败内联报错不丢输入）；
 * - 「清除聊天记录」与助手页同一能力、同一确认文案。
 */
const router = useRouter()
const auth = useAuthStore()
const chat = useChatStore()
const conversation = useConversationStore()
const settings = useSettingsStore()
const toast = useToastStore()

const profile = ref<UserProfile | null>(null)
const loading = ref(true)
const error = ref('')

const avatarInitial = computed(() => profile.value?.avatar_initial || auth.avatarInitial)
const email = computed(() => profile.value?.email || auth.email)
const nickname = computed(() => profile.value?.nickname ?? auth.nickname)
/** 无昵称时主文案回落展示邮箱 */
const primaryText = computed(() => nickname.value?.trim() || email.value)
const createdText = computed(() => profile.value?.created_at || '—')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const me = await getProfile()
    profile.value = me
    // 同步到 auth store：抽屉头像/昵称即时一致（刷新页面后 user 为空时也能补全）
    auth.setNickname(me.nickname)
  } catch (e) {
    profile.value = null
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

/* ---------------- 昵称编辑弹层 ---------------- */

const nicknameOpen = ref(false)
const nicknameInput = ref('')
const nicknameError = ref('')
const nicknameSaving = ref(false)
const nicknameInputRef = ref<HTMLInputElement | null>(null)

function openNickname(): void {
  nicknameInput.value = nickname.value ?? ''
  nicknameError.value = ''
  nicknameSaving.value = false
  nicknameOpen.value = true
}

watch(nicknameOpen, (open) => {
  if (open) void nextTick(() => nicknameInputRef.value?.focus())
})

/** 保存昵称：0 字视为清空（null）；失败弹层不关、输入不丢 */
async function submitNickname(): Promise<void> {
  if (nicknameSaving.value) return
  const value = nicknameInput.value.trim()
  if (value.length > 20) {
    nicknameError.value = '昵称最多 20 个字'
    return
  }
  nicknameSaving.value = true
  nicknameError.value = ''
  try {
    const updated = await updateNickname(value || null)
    profile.value = updated
    auth.setNickname(updated.nickname)
    nicknameOpen.value = false
    toast.show('昵称已更新')
  } catch (e) {
    nicknameError.value = errorText(e)
    void nextTick(() => nicknameInputRef.value?.focus())
  } finally {
    nicknameSaving.value = false
  }
}

/* ---------------- 危险区 ---------------- */

const clearOpen = ref(false)
const clearing = ref(false)
const destroyOpen = ref(false)
const destroying = ref(false)

/** 清除聊天记录：与助手页同一接口与同一确认文案（会话保留，只删消息） */
async function confirmClear(): Promise<void> {
  if (clearing.value) return
  clearing.value = true
  try {
    const id = conversation.conversationId ?? (await conversation.ensureConversationId())
    await convApi.clearConversation(id)
    chat.clearHistory(id)
    clearOpen.value = false
    toast.show('聊天记录已清除')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    clearing.value = false
  }
}

async function doLogout(): Promise<void> {
  await auth.logout()
  // 清理偏好，避免下一个账号继承上一个账号的设置
  settings.reset()
  router.replace('/login')
}

async function doDestroy(): Promise<void> {
  if (destroying.value) return
  destroying.value = true
  try {
    await auth.destroyAccount()
    settings.reset()
    destroyOpen.value = false
    router.replace('/login')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    destroying.value = false
  }
}
</script>

<template>
  <div class="page me">
    <AppNavBar title="个人信息" fallback="/calendar" />

    <div class="page-body me__body">
      <StateError v-if="error" :text="error" @retry="load" />

      <template v-else>
        <!-- 账号卡：加载中先用 auth store 的昵称/邮箱兜底，资料到达后以 /me 为准 -->
        <section class="me__card">
          <span class="me__avatar" aria-hidden="true">{{ avatarInitial }}</span>
          <p class="me__name">{{ primaryText }}</p>
          <p class="me__email ellipsis">{{ email }}</p>
        </section>

        <p v-if="loading && !profile" class="me__loading">加载中…</p>

        <template v-else>
          <ul class="me__group">
            <li>
              <button class="me__row pressable" @click="openNickname">
                <span class="me__row-label">昵称</span>
                <span class="me__row-value" :class="{ 'me__row-value--empty': !nickname }">
                  {{ nickname || '未设置' }}
                </span>
                <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
              </button>
            </li>
            <li class="me__row me__row--static">
              <span class="me__row-label">邮箱</span>
              <span class="me__row-value">{{ email }}</span>
            </li>
            <li class="me__row me__row--static">
              <span class="me__row-label">注册时间</span>
              <span class="me__row-value me__row-value--plain">{{ createdText }}</span>
            </li>
          </ul>

          <ul class="me__group">
            <li>
              <button class="me__row pressable" @click="router.push('/me/password')">
                <span class="me__row-label">修改密码</span>
                <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
              </button>
            </li>
          </ul>

          <ul class="me__group">
            <li>
              <button class="me__row pressable" @click="clearOpen = true">
                <span class="me__row-label">清除聊天记录</span>
                <AppIcon name="chevron-right" :size="16" color="#B5B9C4" />
              </button>
            </li>
          </ul>

          <ul class="me__group me__group--danger">
            <li>
              <button class="me__row me__row--danger pressable" @click="doLogout">退出登录</button>
            </li>
            <li>
              <button class="me__row me__row--danger pressable" @click="destroyOpen = true">
                注销账号
              </button>
            </li>
          </ul>
        </template>
      </template>
    </div>

    <!-- 昵称编辑弹层（视觉规范同 ListFormSheet） -->
    <Transition name="sheet">
      <div
        v-if="nicknameOpen"
        class="sheet-root"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-title"
      >
        <div class="sheet-root__mask" @click="nicknameOpen = false" />
        <div class="sheet-root__panel sheet-panel">
          <span class="sheet-root__grabber" aria-hidden="true" />
          <h2 id="nickname-title" class="sheet-root__title">修改昵称</h2>
          <div class="sheet-root__body">
            <input
              ref="nicknameInputRef"
              v-model="nicknameInput"
              class="sheet-root__input"
              type="text"
              maxlength="20"
              placeholder="设置一个昵称（可选）"
              aria-label="昵称"
              :disabled="nicknameSaving"
              @keydown.enter="submitNickname"
            />
            <p class="sheet-root__counter">{{ nicknameInput.length }}/20</p>
            <p v-if="nicknameError" class="sheet-root__error" role="alert">{{ nicknameError }}</p>
            <AppButton
              type="primary"
              :disabled="nicknameSaving"
              :loading="nicknameSaving"
              @click="submitNickname"
            >
              确认
            </AppButton>
            <AppButton
              type="text"
              class="sheet-root__cancel"
              :disabled="nicknameSaving"
              @click="nicknameOpen = false"
            >
              取消
            </AppButton>
          </div>
        </div>
      </div>
    </Transition>

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

    <AppModal
      :visible="destroyOpen"
      title="注销账号？"
      text="将永久删除账号及全部任务、日程与聊天记录，且不可恢复。"
      confirm-text="注销账号"
      danger
      :loading="destroying"
      @confirm="doDestroy"
      @cancel="destroyOpen = false"
    />
  </div>
</template>

<style scoped>
.me__body {
  padding-bottom: calc(var(--sp-6) + var(--safe-bottom));
}
.me__loading {
  margin-top: var(--sp-2);
  padding: var(--sp-4);
  text-align: center;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  background: var(--bg-card);
}
.me__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-6) var(--sp-4);
  background: var(--bg-card);
}
.me__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: 26px;
  line-height: 1;
  font-weight: 600;
}
.me__name {
  max-width: 100%;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.me__email {
  max-width: 100%;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-secondary);
}
.me__group {
  margin-top: var(--sp-2);
  background: var(--bg-card);
}
.me__group--danger {
  margin-top: var(--sp-6);
}
.me__row {
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
.me__group li:last-child .me__row {
  border-bottom: none;
}
.me__row--static {
  cursor: default;
}
.me__row-label {
  flex: 1;
  min-width: 0;
}
.me__row-value {
  max-width: 62%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: right;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.me__row-value--plain {
  font-variant-numeric: tabular-nums;
}
.me__row-value--empty {
  color: var(--text-disabled);
}
.me__row--danger {
  color: var(--color-danger);
}

/* 弹层：与 ListFormSheet 保持同一视觉规范 */
.sheet-root {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.sheet-root__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.sheet-root__panel {
  position: relative;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding-bottom: calc(var(--sp-3) + var(--safe-bottom));
}
.sheet-root__grabber {
  display: block;
  width: 36px;
  height: 4px;
  margin: var(--sp-2) auto 0;
  border-radius: 2px;
  background: var(--border-color);
}
.sheet-root__title {
  padding: var(--sp-3) var(--sp-4);
  text-align: center;
  font-size: var(--font-heading-m);
  line-height: var(--font-heading-m-lh);
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}
.sheet-root__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
}
.sheet-root__input {
  width: 100%;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-page);
  outline: none;
  font-size: var(--font-body-m);
}
.sheet-root__input:focus {
  border-color: var(--color-primary);
}
.sheet-root__counter {
  margin-top: calc(var(--sp-3) * -1);
  text-align: right;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-disabled);
  font-variant-numeric: tabular-nums;
}
.sheet-root__error {
  margin-top: calc(var(--sp-3) * -1);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
.sheet-root__cancel {
  align-self: center;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .sheet-root__panel,
.sheet-leave-active .sheet-root__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-root__panel,
.sheet-leave-to .sheet-root__panel {
  transform: translateY(100%);
}
</style>