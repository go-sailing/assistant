<script setup lang="ts">
import { nextTick, ref } from 'vue'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{ streaming: boolean }>()
const emit = defineEmits<{ (e: 'send', text: string): void }>()

const text = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
/** 输入框最高 4 行 */
const MAX_HEIGHT = 96

function resize(): void {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
}

function onInput(e: Event): void {
  text.value = (e.target as HTMLTextAreaElement).value
  void nextTick(resize)
}

function submit(): void {
  const v = text.value.trim()
  // 流式输出期间禁止并发发送
  if (!v || props.streaming) return
  emit('send', v)
  text.value = ''
  void nextTick(() => {
    resize()
    textareaRef.value?.focus()
  })
}

function onKeydown(e: KeyboardEvent): void {
  // 回车发送，Shift+Enter 换行（桌面调试用）
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="chat-input">
    <textarea
      ref="textareaRef"
      class="chat-input__field"
      rows="1"
      placeholder="输入消息…"
      aria-label="输入消息"
      :value="text"
      @input="onInput"
      @keydown="onKeydown"
    />
    <button
      class="chat-input__send pressable"
      :class="{ 'chat-input__send--active': text.trim() && !streaming }"
      :disabled="!text.trim() || streaming"
      :aria-label="streaming ? '助手正在处理' : '发送消息'"
      @click="submit"
    >
      <span v-if="streaming" class="chat-input__spinner" aria-hidden="true" />
      <AppIcon v-else name="send" :size="20" color="#fff" />
    </button>
  </div>
</template>

<style scoped>
.chat-input {
  display: flex;
  align-items: flex-end;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  padding-bottom: calc(var(--sp-2) + var(--safe-bottom));
  background: var(--bg-card);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
.chat-input__field {
  flex: 1;
  min-height: 36px;
  max-height: 96px;
  padding: 7px var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  background: var(--bg-page);
  font-size: var(--font-body-l);
  line-height: 22px;
  resize: none;
  outline: none;
}
.chat-input__field:focus {
  border-color: var(--color-primary);
}
.chat-input__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 22px;
  background: var(--text-disabled);
  flex-shrink: 0;
}
.chat-input__send--active {
  background: var(--color-primary);
}
.chat-input__send--active:active {
  background: var(--color-primary-pressed);
}
.chat-input__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>