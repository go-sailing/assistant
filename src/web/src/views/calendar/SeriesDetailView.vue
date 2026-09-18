<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as eventApi from '@/api/events'
import { errorText } from '@/api/client'
import type { Occurrence, SeriesDetail } from '@/types'
import { formatEventRange, parseDate } from '@/utils/time'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppModal from '@/components/AppModal.vue'
import SkeletonList from '@/components/SkeletonList.vue'
import StateError from '@/components/StateError.vue'
import OccurrenceRow from '@/components/calendar/OccurrenceRow.vue'
import RecurrenceBadge from '@/components/calendar/RecurrenceBadge.vue'
import { useEventSyncStore } from '@/stores/eventSync'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const eventSync = useEventSyncStore()

const seriesId = computed(() => String(route.params.id))

const detail = ref<SeriesDetail | null>(null)
const loading = ref(true)
const error = ref('')
const upcoming = ref<Occurrence[]>([])
const past = ref<Occurrence[]>([])
const upcomingCursor = ref<string | null>(null)
const pastCursor = ref<string | null>(null)
const loadingMore = ref(false)
/** 历史分区默认折叠，仅展示最近 2 条 */
const PAST_PREVIEW = 2
const pastExpanded = ref(false)
const pastLoading = ref(false)
const deleteVisible = ref(false)
const deleting = ref(false)

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 永不结束：不展示次数，改显「长期重复」 */
const neverEnds = computed(() => detail.value?.recurrence?.end_type === 'never')
/** 服务端给出「下一次」即系列仍会继续发生 */
const finished = computed(() => !!detail.value && !detail.value.next_occurrence)
const totalCount = computed(() => detail.value?.total_count ?? 0)

const nextText = computed(() => {
  const start = parseDate(detail.value?.next_occurrence)
  if (!start) return ''
  const day = `${start.getMonth() + 1}月${start.getDate()}日 ${WEEKDAYS[start.getDay()]}`
  if (detail.value?.all_day) return `${day} 全天`
  // 系列内每次时长一致：用主记录的时长推出本次结束时间
  const seedStart = parseDate(detail.value?.start_at)
  const seedEnd = parseDate(detail.value?.end_at)
  const duration = seedStart && seedEnd ? seedEnd.getTime() - seedStart.getTime() : 0
  const end = new Date(start.getTime() + duration)
  return `${day} ${formatEventRange({
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    all_day: false,
  })}`
})

/** 规则变更后不再发生的孤儿例外：服务端以 missing_reason=not_occurring 标记（端上无 rrule，不做规则推算） */
const orphanCount = computed(
  () => past.value.filter((o) => o.missing_reason === 'not_occurring').length
)

const visiblePast = computed(() =>
  pastExpanded.value ? past.value : past.value.slice(0, PAST_PREVIEW)
)
const hasMorePast = computed(() => past.value.length > visiblePast.value.length)
const canLoadMoreUpcoming = computed(() => !!upcomingCursor.value)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const res = await eventApi.fetchSeriesDetail(seriesId.value)
    detail.value = res
    upcoming.value = res.occurrences?.upcoming ?? []
    past.value = res.occurrences?.past ?? []
    upcomingCursor.value = res.next_cursor ?? null
    pastCursor.value = null
    pastExpanded.value = false
  } catch (e) {
    detail.value = null
    upcoming.value = []
    past.value = []
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

/** 即将到来：分页 20，触底/点击加载更多 */
async function loadMoreUpcoming(): Promise<void> {
  if (loadingMore.value || !upcomingCursor.value) return
  loadingMore.value = true
  try {
    const res = await eventApi.fetchSeriesDetail(seriesId.value, {
      section: 'upcoming',
      cursor: upcomingCursor.value,
    })
    upcoming.value = [...upcoming.value, ...(res.occurrences?.upcoming ?? [])]
    upcomingCursor.value = res.next_cursor ?? null
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    loadingMore.value = false
  }
}

/** 历史：默认折叠，展开时首次拉取（倒序由服务端保证） */
async function togglePast(): Promise<void> {
  if (pastExpanded.value) {
    pastExpanded.value = false
    return
  }
  pastExpanded.value = true
  if (past.value.length || pastLoading.value) return
  pastLoading.value = true
  try {
    const res = await eventApi.fetchSeriesDetail(seriesId.value, { section: 'past' })
    past.value = res.occurrences?.past ?? []
    pastCursor.value = res.next_cursor ?? null
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    pastLoading.value = false
  }
}

async function loadMorePast(): Promise<void> {
  if (loadingMore.value || !pastCursor.value) return
  loadingMore.value = true
  try {
    const res = await eventApi.fetchSeriesDetail(seriesId.value, {
      section: 'past',
      cursor: pastCursor.value,
    })
    past.value = [...past.value, ...(res.occurrences?.past ?? [])]
    pastCursor.value = res.next_cursor ?? null
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    loadingMore.value = false
  }
}

function openOccurrence(o: Occurrence): void {
  router.push({ path: `/calendar/${seriesId.value}`, query: { occurrence_key: o.occurrence_key } })
}

async function restore(o: Occurrence): Promise<void> {
  try {
    await eventApi.restoreOccurrence(seriesId.value, o.occurrence_key)
    eventSync.markDirty()
    toast.show('已恢复本次安排')
    await load()
  } catch (e) {
    toast.show(errorText(e))
  }
}

function goEditSeries(): void {
  router.push({ path: `/calendar/${seriesId.value}/edit`, query: { scope: 'series' } })
}

async function removeSeries(): Promise<void> {
  if (deleting.value) return
  deleting.value = true
  try {
    await eventApi.deleteEvent(seriesId.value, { scope: 'series' })
    deleteVisible.value = false
    eventSync.markDirty()
    toast.show('已删除整条系列')
    router.replace('/calendar')
  } catch (e) {
    toast.show(errorText(e))
  } finally {
    deleting.value = false
  }
}

function goBack(): void {
  if (window.history.state && window.history.state.back) router.back()
  else router.replace('/calendar')
}

onMounted(load)
</script>

<template>
  <div class="page series">
    <header class="series__head">
      <button class="series__back pressable" aria-label="返回" @click="goBack">‹</button>
      <span class="series__head-title">循环日程</span>
      <button v-if="detail" class="series__head-action pressable" @click="goEditSeries">编辑</button>
      <span v-else class="series__placeholder" />
    </header>

    <div class="page-body series__body">
      <p v-if="loading" class="series__loading">加载中…</p>

      <StateError v-else-if="error" :text="error" @retry="load" />

      <template v-else-if="detail">
        <section class="series__info">
          <h1 class="series__title ellipsis">
            {{ detail.title }}
            <RecurrenceBadge kind="recurring" />
          </h1>
          <p class="series__summary">
            <AppIcon name="repeat" :size="14" color="var(--color-primary)" />
            <span class="series__summary-text">{{ detail.recurrence_summary }}</span>
          </p>
          <!-- v0.4.0：规则补充说明（法定工作日回退、农历逐年浮动，服务端下发） -->
          <p v-if="detail.recurrence_note" class="series__note">{{ detail.recurrence_note }}</p>

          <!-- 已结束的系列：下一次替换为灰色结束说明 -->
          <p v-if="finished" class="series__finished">
            该循环已全部结束{{ totalCount ? `，共 ${totalCount} 次` : '' }}
          </p>
          <p v-else class="series__next">
            <span class="series__next-chip">下一次</span>
            <span class="series__next-text">{{ nextText }}</span>
          </p>

          <p class="series__count">
            {{ finished ? '' : neverEnds ? '长期重复' : totalCount ? `共 ${totalCount} 次` : '' }}
          </p>
        </section>

        <section class="series__section">
          <h2 class="series__section-title">
            即将到来
            <span class="series__section-count">共 {{ totalCount }} 次</span>
          </h2>

          <SkeletonList v-if="!upcoming.length && !finished" :rows="4" />
          <ul v-else-if="upcoming.length" class="series__list">
            <OccurrenceRow
              v-for="o in upcoming"
              :key="o.occurrence_key"
              :occurrence="o"
              @open="openOccurrence"
              @restore="restore"
            />
          </ul>
          <p v-else class="series__empty">没有更多即将到来的安排</p>

          <button
            v-if="canLoadMoreUpcoming && upcoming.length"
            class="series__more pressable"
            :disabled="loadingMore"
            @click="loadMoreUpcoming"
          >
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>
        </section>

        <section class="series__section">
          <h2 class="series__section-title">
            历史
            <span class="series__section-count">{{ past.length }}</span>
          </h2>

          <p v-if="pastLoading" class="series__empty">加载中…</p>
          <ul v-else-if="visiblePast.length" class="series__list">
            <OccurrenceRow
              v-for="o in visiblePast"
              :key="o.occurrence_key"
              :occurrence="o"
              @open="openOccurrence"
              @restore="restore"
            />
          </ul>
          <p v-else class="series__empty">暂无历史安排</p>

          <button
            v-if="hasMorePast"
            class="series__more pressable"
            @click="togglePast"
          >
            {{ pastExpanded ? '收起' : `展开全部（${past.length}）` }}
          </button>
          <button
            v-if="pastExpanded && pastCursor"
            class="series__more pressable"
            :disabled="loadingMore"
            @click="loadMorePast"
          >
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </button>

          <!-- 规则变更后不再发生的历史修改：灰字提示，不阻断操作 -->
          <p v-if="orphanCount" class="series__orphan">
            {{ orphanCount }} 次历史修改在新规则下不再发生
          </p>
        </section>

        <div class="series__actions">
          <AppButton type="secondary" @click="goEditSeries">编辑整条系列</AppButton>
          <button class="series__delete pressable" @click="deleteVisible = true">删除系列</button>
        </div>
      </template>
    </div>

    <AppModal
      :visible="deleteVisible"
      title="删除整条系列？"
      :text="`删除后该循环的全部 ${totalCount || '各'} 次安排将一并删除，且不可恢复。`"
      confirm-text="删除"
      danger
      :loading="deleting"
      @confirm="removeSeries"
      @cancel="deleteVisible = false"
    />
  </div>
</template>

<style scoped>
.series__head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.series__back {
  min-width: 44px;
  min-height: 44px;
  margin-left: -12px;
  text-align: left;
  font-size: 26px;
  line-height: 1;
  color: var(--color-primary);
}
.series__head-title {
  flex: 1;
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.series__head-action {
  min-width: 44px;
  min-height: 44px;
  text-align: right;
  font-size: var(--font-body-l);
  color: var(--color-primary);
}
.series__placeholder {
  min-width: 44px;
}
.series__body {
  background: var(--bg-page);
  padding-bottom: calc(var(--sp-8) + var(--safe-bottom));
}
.series__loading {
  padding: var(--sp-6);
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.series__info {
  padding: var(--sp-4);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.series__title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--font-heading-l);
  line-height: var(--font-heading-l-lh);
  font-weight: 600;
}
.series__summary {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
}
.series__summary-text {
  flex: 1;
  min-width: 0;
}
/* 规则补充说明：小字 secondary，紧随摘要 */
.series__note {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.series__next {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
/* 下一次：success 色胶囊 + 时间文案 */
.series__next-chip {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: rgba(34, 181, 115, 0.12);
  color: var(--color-success);
  font-size: var(--font-caption-s);
  line-height: var(--font-caption-s-lh);
}
.series__next-text {
  font-size: var(--font-body-m);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.series__finished {
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.series__count {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.series__section {
  margin-top: var(--sp-2);
  background: var(--bg-card);
}
.series__section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-body-m);
  font-weight: 600;
}
.series__section-count {
  font-size: var(--font-caption);
  font-weight: 400;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.series__list {
  border-top: 1px solid var(--border-color);
}
.series__empty {
  padding: var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
  text-align: center;
}
.series__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  border-top: 1px solid var(--border-color);
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
.series__more:disabled {
  color: var(--text-disabled);
}
.series__orphan {
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid var(--border-color);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
}
.series__actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-6) var(--sp-4) 0;
}
.series__delete {
  min-height: 44px;
  padding: 0 var(--sp-4);
  font-size: var(--font-body-m);
  color: var(--color-danger);
}
</style>
