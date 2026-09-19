<script setup lang="ts">
import { computed } from 'vue'

/** 统一线性图标集（24pt 线性，描边 1.8pt；filled-* 用于 Tab 选中态） */
const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    color?: string
  }>(),
  { size: 24, color: 'currentColor' }
)

const STROKE = 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"'

const ICONS: Record<string, string> = {
  search: `<g ${STROKE}><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></g>`,
  plus: `<g ${STROKE}><path d="M12 5v14M5 12h14"/></g>`,
  back: `<g ${STROKE}><path d="M15 4.5 7.5 12 15 19.5"/></g>`,
  'chevron-right': `<g ${STROKE}><path d="M9.5 5 16.5 12 9.5 19"/></g>`,
  'chevron-down': `<g ${STROKE}><path d="M5 9.5 12 16.5 19 9.5"/></g>`,
  edit: `<g ${STROKE}><path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/></g>`,
  trash: `<g ${STROKE}><path d="M4 7h16M9.5 7V4.5h5V7"/><path d="M6.2 7l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.8a1.5 1.5 0 0 0 1.5-1.4L17.8 7"/><path d="M10.5 11v6M13.5 11v6"/></g>`,
  eye: `<g ${STROKE}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></g>`,
  'eye-off': `<g ${STROKE}><path d="M3.5 3.5l17 17"/><path d="M10.2 5.9A9.7 9.7 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17.6 17.6 0 0 1-3.2 4"/><path d="M6.4 7.5A17.4 17.4 0 0 0 2.5 12S6 18.2 12 18.2c1.3 0 2.5-.3 3.5-.7"/><path d="M9.9 9.9a2.8 2.8 0 0 0 3.9 3.9"/></g>`,
  clock: `<g ${STROKE}><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.3 1.9"/></g>`,
  folder: `<g ${STROKE}><path d="M3 7.5A2 2 0 0 1 5 5.5h3.6l2 2.2H19a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5z"/></g>`,
  flag: `<g ${STROKE}><path d="M6.5 21V3.5"/><path d="M6.5 4.5h11l-1.6 3.6 1.6 3.6h-11"/></g>`,
  more: `<g fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></g>`,
  check: `<g ${STROKE}><path d="M5 12.5l4.5 4.5L19 7"/></g>`,
  close: `<g ${STROKE}><path d="M6 6l12 12M18 6L6 18"/></g>`,
  alert: `<g ${STROKE}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.2"/><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/></g>`,
  refresh: `<g ${STROKE}><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.8v4.4h-4.4"/></g>`,
  list: `<g ${STROKE}><path d="M4 6.5h16M4 12h16M4 17.5h10"/></g>`,
  'list-fill': `<g fill="currentColor"><rect x="3.5" y="5" width="17" height="2.4" rx="1.2"/><rect x="3.5" y="10.8" width="17" height="2.4" rx="1.2"/><rect x="3.5" y="16.6" width="10.5" height="2.4" rx="1.2"/></g>`,
  chat: `<g ${STROKE}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9.5l-4.6 3.6A.5.5 0 0 1 4 19.2V6.5z"/></g>`,
  'chat-fill': `<g fill="currentColor"><path d="M6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9.5l-4.6 3.6A.5.5 0 0 1 4 19.2V6.5A2.5 2.5 0 0 1 6.5 4z"/></g>`,
  send: `<g ${STROKE}><path d="M12 19.5V5"/><path d="M6 11l6-6 6 6"/></g>`,
  gear: `<g ${STROKE}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.7-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.4-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z"/></g>`,
  inbox: `<g ${STROKE}><path d="M3.5 12.5 6 6.2A2 2 0 0 1 7.9 5h8.2a2 2 0 0 1 1.9 1.2l2.5 6.3v4.3a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-4.3z"/><path d="M3.5 12.5H9a3 3 0 0 0 6 0h5.5"/></g>`,
  // v0.1.0 日程相关图标
  calendar: `<g ${STROKE}><rect x="3.5" y="5.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v4M16 3.5v4"/></g>`,
  'calendar-fill': `<g fill="currentColor"><path d="M6 5.5h12A2.5 2.5 0 0 1 20.5 8v1H3.5V8A2.5 2.5 0 0 1 6 5.5z"/><path d="M3.5 10.5h17v7.5A2.5 2.5 0 0 1 18 20.5H6a2.5 2.5 0 0 1-2.5-2.5v-7.5z"/></g>`,
  link: `<g ${STROKE}><path d="M10 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1L11.4 7.3"/><path d="M14 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2"/></g>`,
  pin: `<g ${STROKE}><path d="M12 21s6.2-5.4 6.2-10a6.2 6.2 0 1 0-12.4 0C5.8 15.6 12 21 12 21z"/><circle cx="12" cy="11" r="2.3"/></g>`,
  allday: `<g ${STROKE}><path d="M6.5 4.5h8l3 3v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z"/><path d="M14 4.5v3.5h3.5"/><path d="M8.5 13h7M8.5 16.5h4"/></g>`,
  conflict: `<g ${STROKE}><path d="M12 4.5 21 19.5H3z"/><path d="M12 10.2v4"/><circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none"/></g>`,
  'chevron-left': `<g ${STROKE}><path d="M15 4.5 7.5 12 15 19.5"/></g>`,
  // v0.2.0 循环日程图标
  repeat: `<g ${STROKE}><path d="M4 9.5A4.5 4.5 0 0 1 8.5 5h8.2"/><path d="M14.5 2.5 17.5 5l-3 2.5"/><path d="M20 14.5A4.5 4.5 0 0 1 15.5 19H7.3"/><path d="M9.5 21.5 6.5 19l3-2.5"/></g>`,
  undo: `<g ${STROKE}><path d="M4 9.5h9.5a5.5 5.5 0 1 1 0 11H8"/><path d="M7.5 5.5 4 9.5l3.5 4"/></g>`,
  // v0.5.0：归档与长期记忆
  archive: `<g ${STROKE}><rect x="3.5" y="4.5" width="17" height="4" rx="1.2"/><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10"/><path d="M9.8 12.5h4.4"/></g>`,
  brain: `<g ${STROKE}><path d="M12 5.2a3 3 0 0 0-5.6 1.4A2.8 2.8 0 0 0 4.6 12a2.8 2.8 0 0 0 1.9 4.2A3 3 0 0 0 12 18.8z"/><path d="M12 5.2a3 3 0 0 1 5.6 1.4A2.8 2.8 0 0 1 19.4 12a2.8 2.8 0 0 1-1.9 4.2A3 3 0 0 1 12 18.8z"/></g>`,
  'chevron-up': `<g ${STROKE}><path d="M5 14.5 12 7.5 19 14.5"/></g>`,
  // v0.7.0：智能体代理 / 凭据 / 复制
  agent: `<g ${STROKE}><rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.2" cy="13.2" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.2" r="1.2" fill="currentColor" stroke="none"/></g>`,
  key: `<g ${STROKE}><circle cx="8" cy="12" r="3.4"/><path d="M11.4 12h8.1"/><path d="M17.2 12v3.2M14.6 12v2.2"/></g>`,
  copy: `<g ${STROKE}><rect x="9" y="9" width="10.5" height="10.5" rx="2.2"/><path d="M15 6.2A2.2 2.2 0 0 0 12.8 4H6.7A2.2 2.2 0 0 0 4.5 6.2v6.1A2.2 2.2 0 0 0 6.7 14.5"/></g>`,
}

const inner = computed(() => ICONS[props.name] || '')
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :style="{ color }"
    aria-hidden="true"
    focusable="false"
    v-html="inner"
  />
</template>

<style scoped>
.app-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>