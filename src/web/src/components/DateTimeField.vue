<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from './AppButton.vue'
import AppIcon from './AppIcon.vue'
import { formatDue, fromLocalInputValue, toLocalInputValue } from '@/utils/time'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void }>()

const visible = ref(false)
const draft = ref('')

const display = computed(() => (props.modelValue ? formatDue(props.modelValue) : '不设置'))
const expired = computed(() => {
  if (!props.modelValue) return false
  return new Date(props.modelValue).getTime() < Date.now()
})

function open(): void {
  draft.value = toLocalInputValue(props.modelValue)
  visible.value = true
}

function confirm(): void {
  emit('update:modelValue', draft.value ? fromLocalInputValue(draft.value) : null)
  visible.value = false
}

function clear(): void {
  draft.value = ''
  emit('update:modelValue', null)
  visible.value = false
}
</script>

<template>
  <div class="dt">
    <div class="dt__main">
      <button class="dt__row pressable" @click="open">
        <span class="dt__icon"><AppIcon name="clock" :size="20" color="#6B7080" /></span>
        <span class="dt__label">截止时间</span>
        <span class="dt__value" :class="{ 'dt__value--set': !!modelValue }">{{ display }}</span>
        <AppIcon name="chevron-right" :size="18" color="#B5B9C4" />
      </button>
      <p v-if="expired" class="dt__hint">该时间已过期</p>
    </div>

    <Transition name="sheet">
      <div v-if="visible" class="dt__sheet" role="dialog" aria-modal="true">
        <div class="dt__mask" @click="visible = false" />
        <div class="dt__panel sheet-panel">
          <div class="dt__panel-head">
            <button class="dt__panel-btn" @click="clear">清除</button>
            <span class="dt__panel-title">选择截止时间</span>
            <button class="dt__panel-btn dt__panel-btn--primary" @click="confirm">确定</button>
          </div>
          <input v-model="draft" class="dt__input" type="datetime-local" aria-label="截止时间" />
          <div class="dt__panel-foot">
            <AppButton type="secondary" block @click="visible = false">取消</AppButton>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dt__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 52px;
  padding: 0 var(--sp-4);
  background: var(--bg-card);
}
.dt__icon {
  display: flex;
}
.dt__label {
  flex: 1;
  text-align: left;
  font-size: var(--font-body-l);
}
.dt__value {
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.dt__value--set {
  color: var(--text-primary);
}
.dt__hint {
  padding: 0 var(--sp-4) var(--sp-3);
  font-size: var(--font-caption);
  color: var(--color-warning);
}
.dt__sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.dt__mask {
  position: absolute;
  inset: 0;
  background: rgba(26, 29, 38, 0.45);
}
.dt__panel {
  position: relative;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  padding-bottom: calc(var(--sp-4) + var(--safe-bottom));
}
.dt__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--border-color);
}
.dt__panel-title {
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.dt__panel-btn {
  min-height: 44px;
  font-size: var(--font-body-l);
  color: var(--text-secondary);
}
.dt__panel-btn--primary {
  color: var(--color-primary);
  font-weight: 500;
}
.dt__input {
  display: block;
  width: calc(100% - var(--sp-4) * 2);
  margin: var(--sp-4);
  min-height: 48px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-page);
  font-size: var(--font-body-l);
}
.dt__panel-foot {
  padding: 0 var(--sp-4);
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 220ms ease;
}
.sheet-enter-active .dt__panel,
.sheet-leave-active .dt__panel {
  transition: transform 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .dt__panel,
.sheet-leave-to .dt__panel {
  transform: translateY(100%);
}
</style>