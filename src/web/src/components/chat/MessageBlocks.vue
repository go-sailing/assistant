<script setup lang="ts">
import { ref } from 'vue'
import type { ChatMessage, ConfirmBlock, Task } from '@/types'
import TaskCard from '../TaskCard.vue'
import ConfirmBar from './ConfirmBar.vue'

const props = defineProps<{ message: ChatMessage }>()

const emit = defineEmits<{
  (e: 'detail', task: Task): void
  (e: 'toggle', task: Task): void
  (e: 'pick', blockIndex: number, task: Task): void
  (e: 'confirm', block: ConfirmBlock): void
  (e: 'cancel', block: ConfirmBlock): void
  (e: 'retry'): void
}>()

/** >10 张卡片默认折叠 */
const CARD_FOLD = 10
const expanded = ref<Record<number, boolean>>({})

function cardsOf(blockIndex: number, tasks: Task[]): Task[] {
  return expanded.value[blockIndex] ? tasks : tasks.slice(0, CARD_FOLD)
}

function expand(blockIndex: number): void {
  expanded.value = { ...expanded.value, [blockIndex]: true }
}

function confirmState(block: ConfirmBlock): 'pending' | 'loading' | 'confirmed' | 'canceled' | 'stale' {
  const s = props.message.pendingState?.[block.pending_action_id]
  return s || 'pending'
}

/* ---- 极简 Markdown（仅加粗与列表，禁止原始 HTML） ---- */
interface Segment {
  text: string
  bold: boolean
}
interface Line {
  type: 'p' | 'li'
  segments: Segment[]
}

function inline(text: string): Segment[] {
  const parts: Segment[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), bold: false })
    parts.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false })
  return parts.length ? parts : [{ text, bold: false }]
}

function lines(text: string): Line[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const t = l.trim()
      const isLi = /^([-*]|\d+\.)\s+/.test(t)
      return { type: isLi ? 'li' : 'p', segments: inline(isLi ? t.replace(/^([-*]|\d+\.)\s+/, '') : t) }
    })
}
</script>

<template>
  <div class="blocks">
    <template v-for="(block, bi) in message.blocks" :key="bi">
      <!-- 文本（支持流式逐字追加） -->
      <div v-if="block.type === 'text'" class="blocks__text">
        <p v-for="(line, li) in lines(block.text)" :key="li" :class="{ 'blocks__li': line.type === 'li' }">
          <span v-if="line.type === 'li'" class="blocks__bullet">•</span>
          <span v-for="(seg, si) in line.segments" :key="si">
            <strong v-if="seg.bold">{{ seg.text }}</strong>
            <template v-else>{{ seg.text }}</template>
          </span>
          <span v-if="message.streaming && bi === message.blocks.length - 1 && li === lines(block.text).length - 1" class="blocks__caret" />
        </p>
      </div>

      <!-- 任务卡片组 -->
      <div v-else-if="block.type === 'cards'" class="blocks__cards">
        <TaskCard
          v-for="t in cardsOf(bi, block.tasks)"
          :key="String(t.id)"
          :task="t"
          @detail="emit('detail', $event)"
          @toggle="emit('toggle', $event)"
        />
        <button
          v-if="!expanded[bi] && block.tasks.length > CARD_FOLD"
          class="blocks__more pressable"
          @click="expand(bi)"
        >
          查看全部 {{ block.tasks.length }} 项
        </button>
      </div>

      <!-- 候选卡片：点选后折叠为「已选择：xxx」 -->
      <div v-else-if="block.type === 'clarify'" class="blocks__cards">
        <p v-if="block.question" class="blocks__question">{{ block.question }}</p>
        <template v-if="message.clarifyPicked && message.clarifyPicked[bi]">
          <p class="blocks__picked">已选择：{{ message.clarifyPicked[bi] }}</p>
        </template>
        <template v-else>
          <TaskCard
            v-for="t in block.candidates"
            :key="String(t.id)"
            :task="t"
            :show-arrow="false"
            @detail="emit('detail', $event)"
            @toggle="emit('toggle', $event)"
          >
            <template #footer>
              <button class="blocks__pick pressable" @click="emit('pick', bi, t)">是这个</button>
            </template>
          </TaskCard>
        </template>
      </div>

      <!-- 确认条 -->
      <ConfirmBar
        v-else-if="block.type === 'confirm'"
        :block="block"
        :state="confirmState(block)"
        @confirm="emit('confirm', block)"
        @cancel="emit('cancel', block)"
      />

      <!-- 系统提示条 -->
      <div v-else-if="block.type === 'error'" class="blocks__error">
        <span class="blocks__error-text">{{ block.message }}</span>
        <button v-if="block.retryable" class="blocks__retry pressable" @click="emit('retry')">
          重试
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.blocks {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.blocks__text {
  font-size: var(--font-body-l);
  line-height: var(--font-body-l-lh);
  color: var(--text-primary);
  word-break: break-word;
}
.blocks__li {
  display: flex;
  gap: 6px;
  padding-left: 2px;
}
.blocks__bullet {
  color: var(--text-secondary);
}
.blocks__caret {
  display: inline-block;
  width: 2px;
  height: 15px;
  margin-left: 2px;
  vertical-align: -2px;
  background: var(--color-primary);
  animation: blink 1s step-end infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.blocks__cards {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.blocks__question {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
}
.blocks__picked {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
  background: var(--bg-page);
  border-radius: var(--radius-card);
  padding: var(--sp-3);
}
.blocks__more {
  align-self: flex-start;
  font-size: var(--font-caption);
  color: var(--color-primary);
  min-height: 32px;
}
.blocks__pick {
  min-height: 32px;
  padding: 0 var(--sp-4);
  border-radius: 6px;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--font-caption);
  font-weight: 500;
}
.blocks__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3);
  background: var(--bg-page);
  border-radius: var(--radius-card);
  color: var(--text-secondary);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
}
.blocks__error-text {
  flex: 1;
}
.blocks__retry {
  color: var(--color-primary);
  font-size: var(--font-caption);
  min-height: 32px;
  padding: 0 var(--sp-2);
}
</style>