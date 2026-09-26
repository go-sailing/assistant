<script setup lang="ts">
import { watch } from 'vue'
import type {
  CalendarEvent,
  CardsBlock,
  ChatMessage,
  ConflictBlock as ConflictBlockType,
  ConfirmBlock,
  EventScope,
  LegacyCard,
  Occurrence,
  ProposalBlock,
  ScopeBlock as ScopeBlockType,
  SeriesDetail,
} from '@/types'
import CardsCollapse from './CardsCollapse.vue'
import ConfirmBar from './ConfirmBar.vue'
import ConflictBlock from './ConflictBlock.vue'
import EventCard from './EventCard.vue'
import MarkdownText from './MarkdownText.vue'
import ProposalCard from './ProposalCard.vue'
import ScopeBlock from './ScopeBlock.vue'
import { CARD_COLLAPSE_THRESHOLD } from '@/utils/constants'
import type { PlaceholderType } from '@/utils/telemetry'
import { logLegacyPlaceholderHit } from '@/utils/telemetry'

const props = defineProps<{ message: ChatMessage }>()

const emit = defineEmits<{
  (e: 'event-detail', event: CalendarEvent): void
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
  events?: CalendarEvent[]
  series?: SeriesDetail[]
  occurrences?: Occurrence[]
  /** v0.9.0 历史遗留：任务卡 / 项目结果组快照（仅占位） */
  tasks?: LegacyCard[]
  subtask_groups?: Array<{ root_task_id: number; nodes: LegacyCard[] }>
}

function totalCards(block: CardsLike): number {
  return (
    (block.events?.length ?? 0) +
    (block.series?.length ?? 0) +
    (block.occurrences?.length ?? 0) +
    (block.tasks?.length ?? 0) +
    (block.subtask_groups?.length ?? 0)
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

/** 历史遗留卡片（任务 / 项目成员）的占位标题 */
function legacyTitles(block: CardsLike): string[] {
  const out: string[] = []
  for (const t of block.tasks ?? []) if (t?.title) out.push(String(t.title))
  for (const g of block.subtask_groups ?? []) {
    for (const n of g?.nodes ?? []) if (n?.title) out.push(String(n.title))
  }
  return out
}

/** 作用域块已选结果：点选后折叠为「已选择：仅本次」 */
function pickedScope(blockIndex: number): string {
  return props.message.clarifyPicked?.[blockIndex] || ''
}

/* ---- v0.9.0（D-09 / TC-AUDIT-084）：历史卡片占位命中观测 ---- */

/** 已落日志的占位项（同一消息重复渲染不重复计数） */
const loggedPlaceholders = new Set<string>()

/**
 * 历史消息中的任务卡 / 项目结果组 / 任务候选已随能力下线，此处统一渲染为灰态占位；
 * 每个占位项渲染时落一条开发期日志（含对象类型，**不含标题正文**）。
 * 去重键含消息 id：列表按索引复用组件实例时，换消息仍能正常计数。
 */
function logPlaceholder(type: PlaceholderType, blockIndex: number, itemIndex: number): void {
  const key = `${props.message.id}:${type}:${blockIndex}:${itemIndex}`
  if (loggedPlaceholders.has(key)) return
  loggedPlaceholders.add(key)
  logLegacyPlaceholderHit(type)
}

function logLegacyPlaceholderHits(): void {
  props.message.blocks.forEach((block, bi) => {
    if (block.type === 'cards') {
      const cards = block as CardsLike
      ;(cards.tasks ?? []).forEach((task, ti) => {
        if (task) logPlaceholder('task', bi, ti)
      })
      // v0.6.0 项目结果组：节点逐个占位，按同一类型计数
      ;(cards.subtask_groups ?? []).forEach((group) => {
        ;(group?.nodes ?? []).forEach((node, ni) => {
          if (node) logPlaceholder('subtask_group', bi, ni)
        })
      })
    } else if (block.type === 'clarify') {
      const clarify = block as { candidates?: LegacyCard[] }
      ;(clarify.candidates ?? []).forEach((cand, ci) => {
        if (cand) logPlaceholder('candidate', bi, ci)
      })
    }
  })
}

watch(() => props.message.blocks, logLegacyPlaceholderHits, { immediate: true, deep: true })

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

      <!-- 日程卡片组 + 循环系列/实例卡片（可同时出现）
           v0.5.0：>10 项时由 CardsCollapse 包裹并默认折叠，折叠态不挂载卡片节点 -->
      <component
        :is="cardsContainerIs(block as CardsBlock)"
        v-else-if="block.type === 'cards'"
        v-bind="cardsContainerProps(block as CardsBlock)"
      >
        <EventCard
          v-for="ev in block.events || []"
          :key="`e-${String(ev.id)}`"
          :event="ev"
          @detail="emit('event-detail', $event)"
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
        <!-- v0.9.0：历史消息中的任务 / 项目卡统一渲染为「该能力已下线」灰态占位 -->
        <div
          v-for="(title, li) in legacyTitles(block as CardsLike)"
          :key="`legacy-${bi}-${li}`"
          class="blocks__legacy"
          role="note"
        >
          <span class="blocks__legacy-title ellipsis">{{ title }}</span>
          <span class="blocks__legacy-note">该能力已下线</span>
        </div>
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
        <template v-else-if="(block.events || []).length">
          <div v-for="ev in block.events || []" :key="String(ev.id)" class="blocks__cand">
            <EventCard
              :event="ev"
              :show-arrow="false"
              @detail="emit('event-detail', $event)"
            />
            <button class="blocks__pick pressable" @click="emit('event-pick', bi, ev)">
              是这个
            </button>
          </div>
        </template>
        <!-- v0.9.0：历史遗留的任务候选统一渲染为灰态占位 -->
        <div
          v-for="(t, ci) in block.candidates || []"
          :key="`legacy-cand-${bi}-${ci}`"
          class="blocks__legacy"
          role="note"
        >
          <span class="blocks__legacy-title ellipsis">{{ t.title }}</span>
          <span class="blocks__legacy-note">该能力已下线</span>
        </div>
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
.blocks__cand {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--sp-2);
}
.blocks__cand > :first-child {
  align-self: stretch;
}
/* v0.9.0：已下线能力的历史卡占位（不可点击、无 chevron、无 hover） */
.blocks__legacy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--sp-3);
  background: var(--bg-page);
  border-left: 3px solid var(--text-disabled);
  border-radius: var(--radius-card);
}
.blocks__legacy-title {
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-disabled);
}
.blocks__legacy-note {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-disabled);
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
