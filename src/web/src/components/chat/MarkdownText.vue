<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

/**
 * v0.4.0 助手消息 Markdown 渲染（UXUI 5.8 / PRD 9.1）。
 *
 * 白名单渲染：原始 HTML 不解析（`html: false`，`<b>x</b>` 按文本可见）、
 * 图片关闭、只允许 http(s) 链接协议；净化后再统一给外链加安全属性。
 * 仅助手消息使用本组件，用户消息保持纯文本。
 */
const props = withDefaults(defineProps<{ text: string; streaming?: boolean }>(), {
  streaming: false,
})

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
// 不支持图片（图片既无渲染需求，也会带来探测/外链风险）
md.disable('image')

/** 允许的标签（h1/h2、表格、图片等一律不在白名单内） */
const ALLOWED_TAGS = [
  'h3',
  'h4',
  'p',
  'br',
  'strong',
  'em',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'hr',
  'span',
]
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class']
/** 仅 http/https：javascript: / data: / vbscript: 等一律失效 */
const ALLOWED_URI_REGEXP = /^(?:https?):/i

/** 净化后的 HTML 串上补齐外链安全属性（此时内容已可信，仅设置属性） */
function decorate(raw: string): string {
  const box = document.createElement('div')
  box.innerHTML = raw
  box.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })
  // 流式光标：追加到最后一个块级元素末尾（增量重渲染时始终跟在文字后面）
  if (props.streaming) {
    const caret = document.createElement('span')
    caret.className = 'md-caret'
    caret.setAttribute('aria-hidden', 'true')
    ;(box.lastElementChild ?? box).appendChild(caret)
  }
  return box.innerHTML
}

const html = computed(() =>
  decorate(
    DOMPurify.sanitize(md.render(props.text || ''), {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP,
      ALLOW_DATA_ATTR: false,
    })
  )
)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html —— 内容已经过 DOMPurify 白名单净化 -->
  <div class="md" v-html="html" />
</template>

<style scoped>
.md {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  word-break: break-word;
}
/* 块级元素间距：流式增量重渲染时高度变化平滑，不出现跳版 */
.md :deep(p) {
  margin: 0 0 6px;
}
.md :deep(p:last-child) {
  margin-bottom: 0;
}
.md :deep(h3) {
  margin: 8px 0 4px;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.md :deep(h4) {
  margin: 8px 0 4px;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.md :deep(h3:first-child),
.md :deep(h4:first-child) {
  margin-top: 0;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 4px 0;
  padding-left: 16px;
}
.md :deep(li) {
  margin: 2px 0;
}
.md :deep(ul) {
  list-style: disc;
}
.md :deep(ol) {
  list-style: decimal;
}
.md :deep(li > ul),
.md :deep(li > ol) {
  margin: 2px 0;
}
.md :deep(strong) {
  font-weight: 600;
}
.md :deep(em) {
  font-style: italic;
}
/* 行内代码：浅底等宽 */
.md :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--color-allday-bg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  word-break: break-all;
}
/* 代码块：深底浅字、圆角 8pt、横向滚动 */
.md :deep(pre) {
  margin: 6px 0;
  padding: var(--sp-3);
  border-radius: 8px;
  background: var(--color-code-bg);
  color: var(--color-code-text);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.md :deep(pre code) {
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: 12.5px;
  line-height: 18px;
  white-space: pre;
  word-break: normal;
}
/* 引用块：左侧 3pt primary 边 */
.md :deep(blockquote) {
  margin: 6px 0;
  padding: 2px 0 2px var(--sp-3);
  border-left: 3px solid var(--color-primary);
  color: var(--text-secondary);
}
.md :deep(blockquote p) {
  margin: 0;
}
.md :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  word-break: break-all;
}
.md :deep(hr) {
  margin: var(--sp-3) 0;
  border: none;
  border-top: 1px solid var(--border-color);
}
/* 流式光标 */
.md :deep(.md-caret) {
  display: inline-block;
  width: 2px;
  height: 15px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--color-primary);
  animation: md-blink 1s step-end infinite;
}
@keyframes md-blink {
  50% {
    opacity: 0;
  }
}
</style>