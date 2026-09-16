<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <ul class="skeleton" aria-busy="true" aria-label="加载中">
    <li v-for="i in rows" :key="i" class="skeleton__item">
      <span class="skeleton__circle" />
      <span class="skeleton__lines">
        <span class="skeleton__line skeleton__line--title" />
        <span class="skeleton__line skeleton__line--sub" />
      </span>
    </li>
  </ul>
</template>

<style scoped>
.skeleton {
  padding: var(--sp-2) var(--sp-4);
}
.skeleton__item {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 64px;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-card);
  border-radius: var(--radius-card);
  margin-bottom: var(--sp-2);
}
.skeleton__circle {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #eceef4;
  animation: pulse 1.4s ease-in-out infinite;
}
.skeleton__lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.skeleton__line {
  height: 12px;
  border-radius: 6px;
  background: #eceef4;
  animation: pulse 1.4s ease-in-out infinite;
}
.skeleton__line--title {
  width: 60%;
}
.skeleton__line--sub {
  width: 38%;
  height: 10px;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>