<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    placeholder?: string
    type?: 'text' | 'password' | 'email' | 'textarea'
    error?: string
    maxlength?: number
    autofocus?: boolean
    rows?: number
  }>(),
  { label: '', placeholder: '', type: 'text', error: '', maxlength: 0, autofocus: false, rows: 4 }
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'blur'): void
  (e: 'enter'): void
}>()

const revealed = ref(false)
const inputType = computed(() => {
  if (props.type === 'password') return revealed.value ? 'text' : 'password'
  return props.type === 'textarea' ? 'text' : props.type
})
const counter = computed(() => (props.maxlength ? `${props.modelValue.length}/${props.maxlength}` : ''))

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
function onKeydown(e: KeyboardEvent): void {
  if (props.type !== 'textarea' && e.key === 'Enter') emit('enter')
}
</script>

<template>
  <div class="field">
    <label v-if="label" class="field__label" :for="`f-${label}`">{{ label }}</label>
    <div class="field__box" :class="{ 'field__box--error': !!error, 'field__box--area': type === 'textarea' }">
      <textarea
        v-if="type === 'textarea'"
        :id="`f-${label}`"
        class="field__input field__input--area"
        :value="modelValue"
        :placeholder="placeholder"
        :maxlength="maxlength || undefined"
        :rows="rows"
        @input="onInput"
        @blur="emit('blur')"
      />
      <input
        v-else
        :id="`f-${label}`"
        class="field__input"
        :type="inputType"
        :value="modelValue"
        :placeholder="placeholder"
        :maxlength="maxlength || undefined"
        :autofocus="autofocus"
        :aria-invalid="!!error"
        @input="onInput"
        @blur="emit('blur')"
        @keydown="onKeydown"
      />
      <button
        v-if="type === 'password'"
        class="field__eye pressable"
        type="button"
        :aria-label="revealed ? '隐藏密码' : '显示密码'"
        @click="revealed = !revealed"
      >
        <AppIcon :name="revealed ? 'eye-off' : 'eye'" :size="20" color="#6B7080" />
      </button>
      <span v-if="counter" class="field__counter">{{ counter }}</span>
    </div>
    <p v-if="error" class="field__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.field__label {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.field__box {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 48px;
  padding: 0 var(--sp-3);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  transition: border-color var(--dur-fast) ease;
}
.field__box:focus-within {
  border-color: var(--color-primary);
}
.field__box--error {
  border-color: var(--color-danger);
}
.field__box--area {
  align-items: flex-start;
  padding: var(--sp-3);
}
.field__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  padding: 12px 0;
}
.field__input--area {
  padding: 0;
  resize: none;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
}
.field__input::placeholder {
  color: var(--text-disabled);
}
.field__eye {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-right: -8px;
}
.field__counter {
  font-size: var(--font-caption);
  color: var(--text-disabled);
  align-self: flex-end;
  padding-bottom: 10px;
}
.field__box--area .field__counter {
  padding-bottom: 0;
}
.field__error {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
</style>