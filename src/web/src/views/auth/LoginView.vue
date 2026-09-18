<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppInput from '@/components/AppInput.vue'
import AppModal from '@/components/AppModal.vue'
import { errorText } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { validateEmail } from '@/utils/validate'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const settings = useSettingsStore()

const email = ref('')
const password = ref('')
const emailError = ref('')
const passwordError = ref('')
const formError = ref('')
const loading = ref(false)
const forgotVisible = ref(false)
/**
 * 登录过期提示（UXUI 5.11 / 7.7）：仅在带 session_expired=1 时展示——
 * 主动退出、改密他端失效等语义不同的跳转不带该参数，因此不显示提示。
 */
const expiredNotice = ref(route.query.session_expired === '1')

const canSubmit = computed(() => email.value.trim() !== '' && password.value !== '' && !loading.value)

/** 登录成功落地：优先按 redirect 回跳原目标页（含深链），否则落用户设置的默认启动页 */
async function landingPath(): Promise<string> {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  // 仅接受站内路径，避免被构造成开放重定向
  if (redirect.startsWith('/') && !redirect.startsWith('//')) return redirect
  // 强制拉取：被动 401 退出后 store 可能残留上个账号的偏好
  await settings.load(true)
  return settings.homeRoute
}

async function onSubmit(): Promise<void> {
  if (loading.value) return
  emailError.value = validateEmail(email.value)
  passwordError.value = password.value ? '' : '请输入密码'
  formError.value = ''
  if (emailError.value || passwordError.value) return
  loading.value = true
  try {
    await auth.login(email.value.trim(), password.value)
    // v0.4.0：默认启动页由设置页决定（默认 /calendar），redirect 优先
    router.replace(await landingPath())
  } catch (e) {
    formError.value = errorText(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth">
    <header class="auth__head">
      <button class="auth__back pressable" aria-label="返回" @click="router.replace('/onboarding')">
        ‹
      </button>
    </header>

    <div class="auth__body">
      <!-- 登录过期提示条：浅黄底、44pt、可关闭（非阻断，不用 alert） -->
      <div v-if="expiredNotice" class="auth__notice" role="status">
        <span class="auth__notice-text">登录已过期，请重新登录</span>
        <button
          class="auth__notice-close pressable"
          aria-label="关闭提示"
          @click="expiredNotice = false"
        >
          <AppIcon name="close" :size="16" color="#8A5A00" />
        </button>
      </div>

      <h1 class="auth__title">欢迎回来</h1>
      <p class="auth__subtitle">登录继续管理任务</p>

      <div class="auth__form">
        <AppInput
          v-model="email"
          label="邮箱"
          type="email"
          placeholder="name@mail.com"
          :error="emailError"
          @blur="emailError = email ? validateEmail(email) : ''"
        />
        <AppInput
          v-model="password"
          label="密码"
          type="password"
          placeholder="请输入密码"
          :error="passwordError"
        />
        <button class="auth__forgot pressable" @click="forgotVisible = true">忘记密码？</button>
        <p v-if="formError" class="auth__form-error">{{ formError }}</p>
        <AppButton type="primary" :disabled="!canSubmit" :loading="loading" @click="onSubmit">
          登 录
        </AppButton>
      </div>

      <div class="auth__foot">
        <span class="auth__foot-text">还没有账号？</span>
        <router-link class="auth__link" to="/register">立即注册</router-link>
      </div>
    </div>

    <AppModal
      :visible="forgotVisible"
      title="无法自助找回密码"
      text="MVP 版本暂不提供自助找回密码流程，请联系客服或管理员协助重置。"
      confirm-text="我知道了"
      cancel-text="关闭"
      @confirm="forgotVisible = false"
      @cancel="forgotVisible = false"
    />
  </div>
</template>

<style scoped>
.auth {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-card);
  padding-top: var(--safe-top);
}
.auth__head {
  display: flex;
  padding: var(--sp-2) var(--sp-4);
}
.auth__back {
  min-width: 44px;
  min-height: 44px;
  font-size: 26px;
  line-height: 1;
  color: var(--color-primary);
  text-align: left;
}
.auth__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4) var(--sp-6) calc(var(--sp-6) + var(--safe-bottom));
}
.auth__notice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
  margin-bottom: var(--sp-4);
  padding: 0 var(--sp-2) 0 var(--sp-3);
  border-radius: var(--radius-control);
  background: var(--color-notice-bg);
  color: var(--color-notice-text);
}
.auth__notice-text {
  flex: 1;
  min-width: 0;
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
.auth__notice-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: calc(var(--sp-2) * -1);
  flex-shrink: 0;
}
.auth__title {
  font-size: var(--font-heading-l);
  line-height: var(--font-heading-l-lh);
  font-weight: 600;
}
.auth__subtitle {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.auth__form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  margin-top: var(--sp-8);
}
.auth__forgot {
  align-self: flex-start;
  min-height: 32px;
  font-size: var(--font-caption);
  color: var(--color-primary);
}
.auth__form-error {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
.auth__foot {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: var(--sp-6);
  font-size: var(--font-body-m);
}
.auth__foot-text {
  color: var(--text-secondary);
}
</style>