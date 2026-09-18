<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, errorText } from '@/api/client'
import AppButton from '@/components/AppButton.vue'
import AppInput from '@/components/AppInput.vue'
import AppNavBar from '@/components/AppNavBar.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { validateConfirmPassword, validatePassword } from '@/utils/validate'

/**
 * 修改密码（UXUI 5.9 / 10.4，P1）。
 *
 * - 强度规则与注册一致（复用 utils/validate 的校验与文案）；
 * - 成功后后端返回**当前设备**的新凭证对并由 auth store 应用，本端保持登录，
 *   其他设备的 refresh 会被吊销；
 * - 旧密码错误（code 2001）内联报错在「原密码」字段上且不清空输入。
 */
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const oldError = ref('')
const newError = ref('')
const confirmError = ref('')
const formError = ref('')
const loading = ref(false)

const allFilled = computed(
  () => oldPassword.value !== '' && newPassword.value !== '' && confirmPassword.value !== ''
)

async function onSubmit(): Promise<void> {
  if (loading.value) return
  oldError.value = oldPassword.value ? '' : '请输入原密码'
  newError.value = validatePassword(newPassword.value)
  confirmError.value = validateConfirmPassword(newPassword.value, confirmPassword.value)
  formError.value = ''
  if (oldError.value || newError.value || confirmError.value) return

  loading.value = true
  try {
    await auth.changePassword(oldPassword.value, newPassword.value)
    toast.show('密码已修改')
    router.back()
  } catch (e) {
    if (e instanceof ApiError && e.code === 2001) oldError.value = errorText(e)
    else formError.value = errorText(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page pwd">
    <AppNavBar title="修改密码" fallback="/me" />

    <div class="page-body pwd__body">
      <div class="pwd__form">
        <AppInput
          v-model="oldPassword"
          label="原密码"
          type="password"
          placeholder="请输入当前密码"
          :error="oldError"
        />
        <AppInput
          v-model="newPassword"
          label="新密码"
          type="password"
          placeholder="至少 8 位，含字母和数字"
          :error="newError"
          @blur="newError = newPassword ? validatePassword(newPassword) : ''"
        />
        <AppInput
          v-model="confirmPassword"
          label="确认新密码"
          type="password"
          placeholder="请再次输入新密码"
          :error="confirmError"
          @blur="
            confirmError = confirmPassword
              ? validateConfirmPassword(newPassword, confirmPassword)
              : ''
          "
        />
        <p class="pwd__tip">修改后其他设备需重新登录，本机保持登录。</p>
        <p v-if="formError" class="pwd__form-error">{{ formError }}</p>
        <AppButton type="primary" :disabled="!allFilled" :loading="loading" @click="onSubmit">
          确认修改
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pwd__body {
  padding-bottom: calc(var(--sp-8) + var(--safe-bottom));
}
.pwd__form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding: var(--sp-6) var(--sp-4) 0;
}
.pwd__tip {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.pwd__form-error {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
</style>