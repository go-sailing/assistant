<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'

const router = useRouter()
const current = ref(0)
const scroller = ref<HTMLElement | null>(null)

const slides = [
  {
    title: '一句话记录日程',
    desc: '用聊天的方式管理日程，说得清楚就记得下',
    art: 'chat',
  },
  {
    title: '列表一眼看清',
    desc: '月历与列表联动，每天安排一眼看清',
    art: 'list',
  },
  {
    title: '写操作可反悔',
    desc: '删除与批量修改先预览再确认，助手绝不擅自执行',
    art: 'shield',
  },
]

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  current.value = Math.round(el.scrollLeft / el.clientWidth)
}
</script>

<template>
  <div class="onboarding">
    <header class="onboarding__head">
      <button class="onboarding__skip pressable" aria-label="跳过引导" @click="router.replace('/login')">
        跳过
      </button>
    </header>

    <div ref="scroller" class="onboarding__scroll" @scroll.passive="onScroll">
      <section v-for="(s, i) in slides" :key="i" class="onboarding__slide">
        <div class="onboarding__art">
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <g
              fill="none"
              stroke="var(--color-primary)"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              opacity="0.6"
            >
              <template v-if="s.art === 'chat'">
                <rect x="26" y="34" width="108" height="70" rx="14" />
                <path d="M56 104v14l18-14" />
                <path d="M50 60h60M50 78h38" />
              </template>
              <template v-else-if="s.art === 'list'">
                <rect x="30" y="26" width="100" height="108" rx="12" />
                <path d="M50 58h60M50 80h60M50 102h34" />
                <circle cx="42" cy="58" r="4" />
                <circle cx="42" cy="80" r="4" />
                <circle cx="42" cy="102" r="4" />
              </template>
              <template v-else>
                <path d="M80 28l44 18v28c0 26-18 44-44 52-26-8-44-26-44-52V46z" />
                <path d="M60 82l14 14 28-30" />
              </template>
            </g>
          </svg>
        </div>
        <h2 class="onboarding__title">{{ s.title }}</h2>
        <p class="onboarding__desc">{{ s.desc }}</p>
      </section>
    </div>

    <div class="onboarding__dots" aria-hidden="true">
      <span
        v-for="(s, i) in slides"
        :key="i"
        class="onboarding__dot"
        :class="{ 'onboarding__dot--active': current === i }"
      />
    </div>

    <footer class="onboarding__foot">
      <AppButton type="primary" @click="router.push('/register')">开始使用</AppButton>
      <button class="onboarding__link pressable" @click="router.push('/login')">已有账号，去登录</button>
    </footer>
  </div>
</template>

<style scoped>
.onboarding {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-card);
  padding-top: var(--safe-top);
}
.onboarding__head {
  display: flex;
  justify-content: flex-end;
  padding: var(--sp-2) var(--sp-4);
}
.onboarding__skip {
  min-width: 44px;
  min-height: 44px;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.onboarding__scroll {
  flex: 1;
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.onboarding__scroll::-webkit-scrollbar {
  display: none;
}
.onboarding__slide {
  flex: 0 0 100%;
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 var(--sp-8);
  text-align: center;
}
.onboarding__art svg {
  width: 160px;
  height: 160px;
}
.onboarding__title {
  margin-top: var(--sp-6);
  font-size: var(--font-heading-l);
  line-height: var(--font-heading-l-lh);
  font-weight: 600;
}
.onboarding__desc {
  margin-top: var(--sp-3);
  font-size: var(--font-body-m);
  line-height: var(--font-body-m-lh);
  color: var(--text-secondary);
}
.onboarding__dots {
  display: flex;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-4) 0;
}
.onboarding__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-color);
  transition: background-color var(--dur-fast) ease;
}
.onboarding__dot--active {
  background: var(--color-primary);
  width: 18px;
  border-radius: 4px;
}
.onboarding__foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-4) var(--sp-6) calc(var(--sp-6) + var(--safe-bottom));
}
.onboarding__link {
  min-height: 44px;
  font-size: var(--font-body-m);
  color: var(--color-primary);
}
</style>