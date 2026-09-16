<script setup lang="ts">
export interface ActionSheetItem {
  label: string
  value: string
  danger?: boolean
}

defineProps<{
  visible: boolean
  title?: string
  items: ActionSheetItem[]
}>()

const emit = defineEmits<{ (e: 'select', value: string): void; (e: 'cancel'): void }>()
</script>

<template>
  <Transition name="sheet">
    <div v-if="visible" class="sheet-root" role="dialog" aria-modal="true">
      <div class="sheet-root__mask" @click="emit('cancel')" />
      <div class="sheet-root__panel">
        <p v-if="title" class="sheet-root__title">{{ title }}</p>
        <ul class="sheet-root__list">
          <li v-for="item in items" :key="item.value">
            <button
              class="sheet-root__item"
              :class="{ 'sheet-root__item--danger': item.danger }"
              @click="emit('select', item.value)"
            >
              {{ item.label }}
            </button>
          </li>
        </ul>
        <button class="sheet-root__item sheet-root__cancel" @click="emit('cancel')">取消</button>
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
  background: var(--bg-page);
  border-radius: 16px 16px 0 0;
  padding-bottom: var(--safe-bottom);
  overflow: hidden;
}
.sheet-root__title {
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
  text-align: center;
  background: var(--bg-card);
}
.sheet-root__list {
  background: var(--bg-card);
  margin-bottom: var(--sp-2);
}
.sheet-root__item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 52px;
  font-size: var(--font-body-l);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.sheet-root__item--danger {
  color: var(--color-danger);
}
.sheet-root__cancel {
  font-weight: 500;
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