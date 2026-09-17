<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppButton from '@/components/AppButton.vue'

/**
 * 清单新建/重命名底部表单弹层（v0.3.0，UXUI 5.5 / SDD 3.6）。
 * 替代原行内输入：输入框全宽、按钮纵向排布、失败内联报错不丢输入。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    mode?: 'create' | 'rename'
    /** 重命名时回填并全选的当前名称 */
    initialName?: string
  }>(),
  { mode: 'create', initialName: '' }
)

const emit = defineEmits<{
  (e: 'confirm', name: string): void
  (e: 'cancel'): void
}>()

const name = ref('')
const submitting = ref(false)
const inlineError = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const title = computed(() => (props.mode === 'rename' ? '重命名清单' : '新建清单'))
const canSubmit = computed(() => !!name.value.trim() && !submitting.value)

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    name.value = props.mode === 'rename' ? props.initialName : ''
    inlineError.value = ''
    submitting.value = false
    // 打开即聚焦并全选（重命名时键盘上直接改）
    void nextTick(() => {
      inputRef.value?.focus()
      if (props.mode === 'rename') inputRef.value?.select()
    })
  }
)

/** 提交：由父组件负责调用接口，失败时通过 fail() 回灌内联错误 */
function submit(): void {
  if (!canSubmit.value) return
  submitting.value = true
  inlineError.value = ''
  emit('confirm', name.value.trim())
}

/** 父组件提交失败：弹层不关、文本不丢、焦点留在输入框 */
function fail(message: string): void {
  submitting.value = false
  inlineError.value = message
  void nextTick(() => inputRef.value?.focus())
}

/** 父组件提交成功：重置本地态（父组件随后关闭弹层） */
function done(): void {
  submitting.value = false
  inlineError.value = ''
}

defineExpose({ fail, done })
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="sheet-root" role="dialog" aria-modal="true" aria-labelledby="list-form-title">
      <div class="sheet-root__mask" @click="emit('cancel')" />
      <div class="sheet-root__panel sheet-panel">
        <span class="sheet-root__grabber" aria-hidden="true" />
        <h2 id="list-form-title" class="sheet-root__title">{{ title }}</h2>

        <div class="sheet-root__body">
          <input
            ref="inputRef"
            v-model="name"
            class="sheet-root__input"
            type="text"
            maxlength="50"
            placeholder="清单名称…"
            :aria-label="title"
            :disabled="submitting"
            @keydown.enter="submit"
          />
          <p v-if="inlineError" class="sheet-root__error" role="alert">{{ inlineError }}</p>

          <AppButton type="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">
            确认
          </AppButton>
          <AppButton
            type="text"
            class="sheet-root__cancel"
            :disabled="submitting"
            @click="emit('cancel')"
          >
            取消
          </AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
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
.sheet-root__error {
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