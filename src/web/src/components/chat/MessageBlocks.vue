<script setup lang="ts">
import type {
  CalendarEvent,
  ChatMessage,
  ConflictBlock as ConflictBlockType,
  ConfirmBlock,
  EventScope,
  Occurrence,
  ProjectGroup,
  ProposalBlock,
  ScopeBlock as ScopeBlockType,
  SeriesDetail,
  Task,
} from '@/types'
import TaskCard from '../TaskCard.vue'
import CardsCollapse from './CardsCollapse.vue'
import ConfirmBar from './ConfirmBar.vue'
import ConflictBlock from './ConflictBlock.vue'
import EventCard from './EventCard.vue'
import MarkdownText from './MarkdownText.vue'
import ProjectGroupCard from './ProjectGroupCard.vue'
import ProposalCard from './ProposalCard.vue'
import ScopeBlock from './ScopeBlock.vue'
import { CARD_COLLAPSE_THRESHOLD } from '@/utils/constants'

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

/**
 * v0.5.0：cards 块按对象总数决定是否套 CardsCollapse（>10 默认折叠，≤10 与 v0.4.0 完全一致）。
 * 折叠态由 CardsCollapse 内部 v-if 决定是否挂载卡片节点，本组件始终渲染全量数据。
 */
const COLLAPSE_THRESHOLD = CARD_COLLAPSE_THRESHOLD

interface CardsLike {
  tasks?: Task[]
  events?: CalendarEvent[]
  series?: SeriesDetail[]
  occurrences?: Occurrence[]
  project_groups?: ProjectGroup[]
}

function totalCards(block: CardsLike): number {
  return (
    (block.tasks?.length ?? 0) +
    (block.events?.length ?? 0) +
    (block.series?.length ?? 0) +
    (block.occurrences?.length ?? 0) +
    (block.project_groups?.length ?? 0)
  )
}

/** 折叠容器与普通容器的动态绑定（避免卡片渲染块重复书写） */
function cardsContainerProps(block: CardsLike): Record<string, unknown> {
  return totalCards(block) > COLLAPSE_THRESHOLD
    ? { total: totalCards(block) }
    : { class: 'blocks__cards' }
}

function cardsContainerIs(block: CardsLike): unknown {
  return totalCards(block) > COLLAPSE_THRESHOLD ? CardsCollapse : 'div'
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

      <!-- 任务卡片组 + 日程卡片组 + 循环系列/实例卡片 + 项目结果组（可同时出现）
           v0.5.0：>10 项时由 CardsCollapse 包裹并默认折叠，折叠态不挂载卡片节点 -->
      <component
        :is="cardsContainerIs(block as CardsLike)"
        v-else-if="block.type === 'cards'"
        v-bind="cardsContainerProps(block as CardsLike)"
      >
        <TaskCard
          v-for="t in block.tasks"
          :key="String(t.id)"
          :task="t"
          @detail="emit('detail', $event)"
          @toggle="emit('toggle', $event)"
        />
        <EventCard
          v-for="ev in block.events || []"
          :key="`e-${String(ev.id)}`"
          :event="ev"
          @detail="emit('event-detail', $event)"
          @task="emit('event-task', $event)"
          @toggle="emit('event-toggle', $event)"
        />
        <!-- 循环系列卡片：整卡点击 → 系列详情 -->
        <EventCard
          v-for="s in block.series || []"
          :key="`s-${String(s.id)}`"
          :event="s"
          :series="s"
        />
        <!-- 循环实例卡片：整卡点击 → 实例详情（带 occurrence_key） -->
        <EventCard
          v-for="o in block.occurrences || []"
          :key="`o-${o.series_id}-${o.occurrence_key}`"
          :event="o"
          :occurrence="o"
          @occurrence-restore="emit('occurrence-restore', $event)"
        />
        <ProjectGroupCard
          v-for="g in block.project_groups || []"
          :key="`g-${g.project_id}`"
          :group="g"
          @task="emit('detail', $event)"
        />
      </component>

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