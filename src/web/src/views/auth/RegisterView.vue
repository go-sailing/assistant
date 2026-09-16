<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppInput from '@/components/AppInput.vue'
import { errorText } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import {
  passwordStrength,
  strengthText,
  validateConfirmPassword,
  validateEmail,
  validatePassword,
} from '@/utils/validate'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const confirm = ref('')
const emailError = ref('')
const passwordError = ref('')
const confirmError = ref('')
const formError = ref('')
const loading = ref(false)

const strength = computed(() => passwordStrength(password.value))
const strengthLabel = computed(() => strengthText[strength.value])
const strengthLevel = computed(() => {
  if (strength.value === 'medium') return 2
  if (strength.value === 'strong') return 3
  if (strength.value === 'weak') return 1
  return 0
})

const allFilled = computed(
  () => email.value.trim() !== '' && password.value !== '' && confirm.value !== ''
)

async function onSubmit(): Promise<void> {
  if (loading.value) return
  emailError.value = validateEmail(email.value)
  passwordError.value = validatePassword(password.value)
  confirmError.value = validateConfirmPassword(password.value, confirm.value)
  formError.value = ''
  if (emailError.value || passwordError.value || confirmError.value) return
  loading.value = true
  try {
    // MVP 无验证码、无邮箱激活：注册成功即登录
    await auth.register(email.value.trim(), password.value)
    router.replace('/tasks')
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
      <button class="auth__back pressable" aria-label="返回" @click="router.back()">‹</button>
    </header>

    <div class="auth__body">
      <h1 class="auth__title">创建账号</h1>
      <p class="auth__subtitle">邮箱 + 密码即可开始，无需验证码</p>

      <div class="auth__form">
        <AppInput
          v-model="email"
          label="邮箱"
          type="email"
          placeholder="name@mail.com"
          :error="emailError"
          @blur="emailError = email ? validateEmail(email) : ''"
        />
        <div class="auth__pwd">
          <AppInput
            v-model="password"
            label="密码"
            type="password"
            placeholder="至少 8 位，含字母和数字"
            :error="passwordError"
            @blur="passwordError = password ? validatePassword(password) : ''"
          />
          <div class="auth__strength" aria-hidden="true">
            <span
              v-for="i in 3"
              :key="i"
              class="auth__bar"
              :class="[
                `auth__bar--${i}`,
                { 'auth__bar--on': strengthLevel >= i, [`auth__bar--${strength}`]: strengthLevel >= i },
              ]"
            />
            <span class="auth__strength-text">{{ strengthLabel }}</span>
          </div>
        </div>
        <AppInput
          v-model="confirm"
          label="确认密码"
          type="password"
          placeholder="请再次输入密码"
          :error="confirmError"
          @blur="confirmError = confirm ? validateConfirmPassword(password, confirm) : ''"
        />
        <p v-if="formError" class="auth__form-error">{{ formError }}</p>
        <AppButton type="primary" :disabled="!allFilled" :loading="loading" @click="onSubmit">
          注 册
        </AppButton>
      </div>

      <div class="auth__foot">
        <span class="auth__foot-text">已有账号？</span>
        <router-link class="auth__link" to="/login">去登录</router-link>
      </div>
    </div>
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
  margin-top: var(--sp-6);
}
.auth__pwd {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.auth__strength {
  display: flex;
  align-items: center;
  gap: 4px;
}
.auth__bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  transition: background-color var(--dur-fast) ease;
}
.auth__bar--on.auth__bar--weak {
  background: var(--text-disabled);
}
.auth__bar--on.auth__bar--medium {
  background: var(--color-warning);
}
.auth__bar--on.auth__bar--strong {
  background: var(--color-success);
}
.auth__strength-text {
  width: 20px;
  text-align: right;
  font-size: var(--font-caption);
  color: var(--text-secondary);
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