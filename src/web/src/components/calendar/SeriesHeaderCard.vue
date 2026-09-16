<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'

defineProps<{
  /** 服务端下发的规则摘要（端上不自行拼装） */
  summary: string
  /** 可选补充说明（如「循环日程中的一次」） */
  hint?: string
}>()

const emit = defineEmits<{ (e: 'open'): void }>()
</script>

<template>
  <button
    class="series pressable"
    :aria-label="`查看循环系列：${summary}`"
    @click="emit('open')"
  >
    <AppIcon name="repeat" :size="16" color="var(--color-primary)" />
    <span class="series__main">
      <span class="series__hint">{{ hint || '循环日程中的一次' }}</span>
      <span class="series__summary ellipsis">{{ summary }}</span>
    </span>
    <AppIcon name="chevron-right" :size="18" color="var(--color-primary)" />
  </button>
</template>

<style scoped>
.series {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 56px;
  padding: var(--sp-3) var(--sp-4);
  background: var(--color-primary-light);
  text-align: left;
}
.series__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.series__hint {
  font-size: var(--font-caption-s);
  line-height: var(--font-caption-s-lh);
  color: var(--color-primary);
}
.series__summary {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-primary);
}
</style>
