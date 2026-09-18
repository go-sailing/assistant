<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import { CARD_COLLAPSE_THRESHOLD } from '@/utils/constants'

/**
 * v0.5.0：纯查询轮「大卡组」折叠容器（UXUI 5.7 / SDD 3.3）。
 *
 * - 只在同一 cards 块的对象总数 > CARD_COLLAPSE_THRESHOLD 时由 MessageBlocks 包裹；
 * - **默认全收起**：折叠态不渲染卡片节点（v-if，非 CSS 隐藏），长列表零渲染开销；
 * - 展开态仅组件内存态，不持久化用户偏好（刷新后回到默认折叠）；
 * - 历史消息同样适用：升级前落库的大卡组刷新后也折叠，数据不改写、不新增请求。
 */
const props = defineProps<{
  /** 卡组总数（用于计数朗读与标题） */
  total: number
  /** 范围文案，如「明天」「搜索「周会」」 */
  scopeText?: string
}>()

const expanded = ref(false)

/** 内容区 id 必须逐实例唯一（同一会话可能存在多个大卡组） */
const bodyId = `cards-collapse-${Math.random().toString(36).slice(2, 9)}`

function toggle(): void {
  expanded.value = !expanded.value
}
</script>

<template>
  <div class="collapse">
    <button
      class="collapse__head pressable"
      type="button"
      role="button"
      :aria-expanded="expanded"
      :aria-controls="bodyId"
      @click="toggle"
    >
      <AppIcon name="calendar" :size="16" color="var(--text-secondary)" />
      <span class="collapse__title">
        {{ props.scopeText ? `${props.scopeText} · ` : '' }}共 {{ props.total }} 项安排
      </span>
      <AppIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="16" color="#B5B9C4" />
    </button>
    <div v-if="expanded" :id="bodyId" class="collapse__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.collapse {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.collapse__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  text-align: left;
}
.collapse__title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.collapse__body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
</style>