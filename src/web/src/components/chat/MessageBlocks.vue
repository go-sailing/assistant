<script setup lang="ts">
import { ref } from 'vue'
import type {
  CalendarEvent,
  ChatMessage,
  ConflictBlock as ConflictBlockType,
  ConfirmBlock,
  EventScope,
  Occurrence,
  ProposalBlock,
  ScopeBlock as ScopeBlockType,
  SeriesDetail,
  SubtaskGroup,
  Task,
} from '@/types'
import TaskCard from '../TaskCard.vue'
import ConfirmBar from './ConfirmBar.vue'
import ConflictBlock from './ConflictBlock.vue'
import EventCard from './EventCard.vue'
import MarkdownText from './MarkdownText.vue'
import ProposalCard from './ProposalCard.vue'
import ScopeBlock from './ScopeBlock.vue'
import SubtaskGroupCard from './SubtaskGroupCard.vue'

const props = defineProps<{ message: ChatMessage }>()

const emit = defineEmits<{
  (e: 'detail', task: Task): void
  (e: 'toggle', task: Task): void
  (e: 'pick', blockIndex: number, task: Task): void
  (e: 'event-detail', event: CalendarEvent): void
  (e: 'event-task', task: Task): void
  (e: 'event-toggle', event: CalendarEvent): void
  (e: 'event-pick', blockIndex: number, event: CalendarEvent): void
  (e: 'occurrence-restore', occurrence: Occurrence): void
  (e: 'scope-pick', blockIndex: number, block: ScopeBlockType, scope: EventScope): void
  (e: 'conflict-change'): void
  (e: 'conflict-force'): void
  (e: 'confirm', block: ConfirmBlock): void
  (e: 'cancel', block: ConfirmBlock): void
  (e: 'proposal-adopt', block: ProposalBlock): void
  (e: 'proposal-adjust', block: ProposalBlock): void
  (e: 'retry'): void
}>()

/** >10 张卡片默认折叠 */
const CARD_FOLD = 10
const expanded = ref<Record<number, boolean>>({})

/** 各类卡片共用同一折叠开关 */
function fold<T>(blockIndex: number, list: T[]): T[] {
  return expanded.value[blockIndex] ? list : list.slice(0, CARD_FOLD)
}

function cardsOf(blockIndex: number, tasks: Task[]): Task[] {
  return fold(blockIndex, tasks)
}

/** 日程卡片与任务卡片共用折叠开关 */
function eventsOf(blockIndex: number, events: CalendarEvent[]): CalendarEvent[] {
  return fold(blockIndex, events)
}

function seriesOf(blockIndex: number, series: SeriesDetail[]): SeriesDetail[] {
  return fold(blockIndex, series)
}

function occurrencesOf(blockIndex: number, occurrences: Occurrence[]): Occurrence[] {
  return fold(blockIndex, occurrences)
}

function groupsOf(blockIndex: number, groups: SubtaskGroup[]): SubtaskGroup[] {
  return fold(blockIndex, groups)
}

interface CardsLike {
  tasks?: Task[]
  events?: CalendarEvent[]
  series?: SeriesDetail[]
  occurrences?: Occurrence[]
  subtask_groups?: SubtaskGroup[]
}

function totalCards(block: CardsLike): number {
  return (
    (block.tasks?.length ?? 0) +
    (block.events?.length ?? 0) +
    (block.series?.length ?? 0) +
    (block.occurrences?.length ?? 0) +
    (block.subtask_groups?.length ?? 0)
  )
}

function expand(blockIndex: number): void {
  expanded.value = { ...expanded.value, [blockIndex]: true }
}

/** 作用域块已选结果：点选后折叠为「已选择：仅本次」 */
function pickedScope(blockIndex: number): string {
  return props.message.clarifyPicked?.[blockIndex] || ''
}

function confirmState(block: ConfirmBlock): 'pending' | 'loading' | 'confirmed' | 'canceled' | 'stale' {
  const s = props.message.pendingState?.[block.pending_action_id]
  return s || 'pending'
}
</script>

<template>
  <div class="blocks">
    <template v-for="(block, bi) in message.blocks" :key="bi">
      <!-- 文本：助手消息按白名单 Markdown 渲染（流式增量到达即重渲染当前气泡） -->
      <div v-if="block.type === 'text'" class="blocks__text">
        <MarkdownText
          :text="block.text"
          :streaming="!!message.streaming && bi === message.blocks.length - 1"
        />
      </div>

      <!-- 方案卡：对话层确认（前端本地状态机），卡内文本不解析 Markdown -->
      <ProposalCard
        v-else-if="block.type === 'proposal'"
        :block="(block as ProposalBlock)"
        @adopt="emit('proposal-adopt', $event)"
        @adjust="emit('proposal-adjust', $event)"
      />

      <!-- 任务卡片组 + 日程卡片组 + 循环系列/实例卡片 + 子任务组（可同时出现） -->
      <div v-else-if="block.type === 'cards'" class="blocks__cards">
        <TaskCard
          v-for="t in cardsOf(bi, block.tasks)"
          :key="String(t.id)"
          :task="t"
          @detail="emit('detail', $event)"
          @toggle="emit('toggle', $event)"
        />
        <EventCard
          v-for="ev in eventsOf(bi, block.events || [])"
          :key="`e-${String(ev.id)}`"
          :event="ev"
          @detail="emit('event-detail', $event)"
          @task="emit('event-task', $event)"
          @toggle="emit('event-toggle', $event)"
        />
        <!-- 循环系列卡片：整卡点击 → 系列详情 -->
        <EventCard
          v-for="s in seriesOf(bi, block.series || [])"
          :key="`s-${String(s.id)}`"
          :event="s"
          :series="s"
        />
        <!-- 循环实例卡片：整卡点击 → 实例详情（带 occurrence_key） -->
        <EventCard
          v-for="o in occurrencesOf(bi, block.occurrences || [])"
          :key="`o-${o.series_id}-${o.occurrence_key}`"
          :event="o"
          :occurrence="o"
          @occurrence-restore="emit('occurrence-restore', $event)"
        />
        <SubtaskGroupCard
          v-for="g in groupsOf(bi, block.subtask_groups || [])"
          :key="`g-${g.root_task_id}`"
          :group="g"
          @task="emit('detail', $event)"
        />
        <button
          v-if="!expanded[bi] && totalCards(block) > CARD_FOLD"
          class="blocks__more pressable"
          @click="expand(bi)"
        >
          查看全部 {{ totalCards(block) }} 项
        </button>
      </div>

      <!-- 作用域澄清块：点选后折叠为「已选择：xxx」并作为结构化消息回传 -->
      <ScopeBlock
        v-else-if="block.type === 'scope'"
        :block="(block as ScopeBlockType)"
        :picked="pickedScope(bi)"
        :disabled="!!message.streaming"
        @pick="emit('scope-pick', bi, block as ScopeBlockType, $event)"
      />

      <!-- 候选卡片：点选后折叠为「已选择：xxx」 -->
      <div v-else-if="block.type === 'clarify'" class="blocks__cards">
        <p v-if="block.question" class="blocks__question">{{ block.question }}</p>
        <template v-if="message.clarifyPicked && message.clarifyPicked[bi]">
          <p class="blocks__picked">已选择：{{ message.clarifyPicked[bi] }}</p>
        </template>
        <template v-else-if="block.kind === 'event'">
          <EventCard
            v-for="ev in block.events || []"
            :key="String(ev.id)"
            :event="ev"
            :show-arrow="false"
            @detail="emit('event-detail', $event)"
            @task="emit('event-task', $event)"
            @toggle="emit('event-toggle', $event)"
          />
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

      <!-- 时间冲突提示块：未保存，由用户决定 -->
      <ConflictBlock
        v-else-if="block.type === 'conflict'"
        :block="(block as ConflictBlockType)"
        @change="emit('conflict-change')"
        @force="emit('conflict-force')"
      />

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
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-primary);
  word-break: break-word;
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