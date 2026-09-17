<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import AppButton from './AppButton.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    text?: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
    loading?: boolean
  }>(),
  { text: '', confirmText: '确认', cancelText: '取消', danger: false, loading: false }
)

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

/**
 * v0.3.0：危险操作的默认焦点不落在破坏性按钮上（UXUI 5.6）。
 * 仅 danger 弹窗生效（这类弹窗无输入框，不会抢走输入焦点）。
 */
const cancelRef = ref<InstanceType<typeof AppButton> | null>(null)
watch(
  () => props.visible,
  (v) => {
    if (!v || !props.danger) return
    void nextTick(() => {
      const el = cancelRef.value?.$el as HTMLElement | undefined
      el?.focus()
    })
  }
)
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="modal" role="dialog" aria-modal="true">
      <div class="modal__mask" @click="emit('cancel')" />
      <div class="modal__panel">
        <h3 class="modal__title">{{ title }}</h3>
        <p v-if="text" class="modal__text">{{ text }}</p>
        <slot />
        <div class="modal__actions">
          <AppButton ref="cancelRef" type="secondary" :disabled="loading" @click="emit('cancel')">
            {{ cancelText }}
          </AppButton>
          <AppButton
            :type="danger ? 'danger' : 'primary'"
            :loading="loading"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.modal__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.modal__panel {
  position: relative;
  width: 100%;
  max-width: 480px;
  margin: var(--sp-4);
  padding: var(--sp-6) var(--sp-4) var(--sp-4);
  background: var(--bg-card);
  border-radius: 16px;
  padding-bottom: calc(var(--sp-4) + var(--safe-bottom));
}
.modal__title {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  font-weight: 600;
  text-align: center;
}
.modal__text {
  margin-top: var(--sp-2);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
  text-align: center;
}
.modal__actions {
  display: flex;
  gap: var(--sp-3);
  margin-top: var(--sp-6);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .modal__panel,
.sheet-leave-active .modal__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .modal__panel,
.sheet-leave-to .modal__panel {
  transform: translateY(100%);
}
</style>