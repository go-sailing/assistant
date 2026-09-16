<script setup lang="ts">
import { ref } from 'vue'
import type {
  CalendarEvent,
  ChatMessage,
  ConfirmBlock,
  EventScope,
  Occurrence,
  ScopeBlock,
  Task,
} from '@/types'
import AppActionSheet from '../AppActionSheet.vue'
import AppIcon from '../AppIcon.vue'
import LoadingDots from '../LoadingDots.vue'
import MessageBlocks from './MessageBlocks.vue'

const props = defineProps<{ message: ChatMessage }>()

const emit = defineEmits<{
  (e: 'detail', task: Task): void
  (e: 'toggle', task: Task): void
  (e: 'pick', message: ChatMessage, blockIndex: number, task: Task): void
  (e: 'event-detail', event: CalendarEvent): void
  (e: 'event-task', task: Task): void
  (e: 'event-toggle', event: CalendarEvent): void
  (e: 'event-pick', message: ChatMessage, blockIndex: number, event: CalendarEvent): void
  (e: 'occurrence-restore', occurrence: Occurrence): void
  (e: 'scope-pick', message: ChatMessage, blockIndex: number, block: ScopeBlock, scope: EventScope): void
  (e: 'conflict-change'): void
  (e: 'conflict-force'): void
  (e: 'confirm', block: ConfirmBlock): void
  (e: 'cancel', block: ConfirmBlock): void
  (e: 'retry', message: ChatMessage): void
}>()

const sheetVisible = ref(false)
const sheetItems = [
  { label: '重发', value: 'resend' },
  { label: '取消重发', value: 'cancel' },
]

function onSheetSelect(v: string): void {
  sheetVisible.value = false
  if (v === 'resend') emit('retry', props.message)
}
</script>

<template>
  <div class="msg" :class="message.role === 'user' ? 'msg--user' : 'msg--assistant'">
    <!-- 用户消息 -->
    <template v-if="message.role === 'user'">
      <button
        v-if="message.sendStatus === 'failed'"
        class="msg__failed pressable"
        aria-label="发送失败，点击重发"
        @click="sheetVisible = true"
      >
        <AppIcon name="alert" :size="18" color="var(--color-danger)" />
      </button>
      <div class="msg__bubble" :class="{ 'msg__bubble--sending': message.sendStatus === 'sending' }">
        {{ message.content }}
      </div>
      <AppActionSheet
        :visible="sheetVisible"
        :items="sheetItems"
        @select="onSheetSelect"
        @cancel="sheetVisible = false"
      />
    </template>

    <!-- 助手消息 -->
    <template v-else>
      <div class="msg__avatar" aria-hidden="true">
        <AppIcon name="chat" :size="18" color="var(--color-primary)" />
      </div>
      <div class="msg__body">
        <MessageBlocks
          :message="message"
          @detail="emit('detail', $event)"
          @toggle="emit('toggle', $event)"
          @pick="(i, t) => emit('pick', message, i, t)"
          @event-detail="emit('event-detail', $event)"
          @event-task="emit('event-task', $event)"
          @event-toggle="emit('event-toggle', $event)"
          @event-pick="(i, e) => emit('event-pick', message, i, e)"
          @occurrence-restore="emit('occurrence-restore', $event)"
          @scope-pick="(i, b, s) => emit('scope-pick', message, i, b, s)"
          @conflict-change="emit('conflict-change')"
          @conflict-force="emit('conflict-force')"
          @confirm="emit('confirm', $event)"
          @cancel="emit('cancel', $event)"
          @retry="emit('retry', message)"
        />
        <LoadingDots v-if="message.thinking" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
}
.msg--user {
  justify-content: flex-end;
}
.msg__bubble {
  max-width: 76%;
  padding: 10px var(--sp-3);
  background: var(--color-primary);
  color: #fff;
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  border-radius: var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble);
  word-break: break-word;
  white-space: pre-wrap;
}
.msg__bubble--sending {
  opacity: 0.6;
}
.msg__failed {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-top: 4px;
}
.msg--assistant {
  padding-right: var(--sp-8);
}
.msg__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.msg__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding-top: 2px;
}
</style>