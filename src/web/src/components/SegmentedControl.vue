<script setup lang="ts">
export interface SegmentOption {
  label: string
  value: string
}

const props = defineProps<{
  modelValue: string
  options: SegmentOption[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

<template>
  <div class="segmented" role="tablist">
    <button
      v-for="opt in props.options"
      :key="opt.value"
      class="segmented__item"
      :class="{ 'segmented__item--active': modelValue === opt.value }"
      role="tab"
      :aria-selected="modelValue === opt.value"
      @click="emit('update:modelValue', opt.value)"
    >
      <span class="segmented__text">{{ opt.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-card);
}
.segmented__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
  position: relative;
  transition: color var(--dur-fast) ease;
}
.segmented__item--active {
  color: var(--color-primary);
  font-weight: 500;
}
.segmented__item--active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 28px;
  height: 2px;
  border-radius: 2px;
  background: var(--color-primary);
  transform: translateX(-50%);
}
</style>