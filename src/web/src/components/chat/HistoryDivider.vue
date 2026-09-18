<script setup lang="ts">
/**
 * v0.5.0：历史摘要分界条（UXUI 5.3 / SDD 3.2）。
 *
 * 纯渲染组件：无点击、无请求、不入库、不占消息分页；
 * 由 ChatView 依据会话摘要水位（compacted_until_id）决定插入位置，
 * 整个会话至多一条。
 */
</script>

<template>
  <div class="divider" aria-hidden="true">
    <span class="divider__line" />
    <span class="divider__text">更早的对话已自动摘要，仍可向上翻看完整记录</span>
    <span class="divider__line" />
  </div>
</template>

<style scoped>
.divider {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin: var(--sp-3) 0;
}
.divider__line {
  flex: 1;
  height: 1px;
  background: var(--border-color);
}
.divider__text {
  font-size: 12px;
  line-height: 17px;
  color: var(--text-disabled);
  white-space: nowrap;
}
</style>