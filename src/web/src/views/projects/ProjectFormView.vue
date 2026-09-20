<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createProject, fetchProject, updateProject } from '@/api/projects'
import { errorText } from '@/api/client'
import type { ProjectPayload } from '@/types'
import AppButton from '@/components/AppButton.vue'
import AppInput from '@/components/AppInput.vue'
import AppModal from '@/components/AppModal.vue'
import StateError from '@/components/StateError.vue'
import { useTaskSyncStore } from '@/stores/taskSync'
import { useToastStore } from '@/stores/toast'

/**
 * v0.8.0 新建 / 编辑项目（UXUI 5.6）：路由 project-create 与 project-edit 复用本组件。
 * 字段仅「项目名称」+「备注」（项目模型无优先级、无截止时间）；
 * payload 仅 { name, note }。
 */
const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const taskSync = useTaskSyncStore()

const editId = computed(() => (route.name === 'project-edit' ? String(route.params.id) : ''))

const title = ref('')
const note = ref('')

const titleError = ref('')
const formError = ref('')
const saving = ref(false)
const shaking = ref(false)
const loading = ref(false)
const loadError = ref('')
const discardVisible = ref(false)

/** 进入页面时的表单快照，用于「取消时是否有未保存内容」判定 */
const initial = ref('')

const headTitle = computed(() => (editId.value ? '编辑项目' : '新建项目'))
const canSave = computed(() => title.value.trim() !== '' && !saving.value)
const dirty = computed(
  () =>
    JSON.stringify({
      title: title.value,
      note: note.value,
    }) !== initial.value
)

function snapshot(): string {
  return JSON.stringify({
    title: title.value,
    note: note.value,
  })
}

async function loadProject(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const p = await fetchProject(editId.value)
    title.value = p.name
    note.value = p.note || ''
    initial.value = snapshot()
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

/** 标题为空时抖动提示 */
function warnTitle(): void {
  titleError.value = '请输入项目名称'
  shaking.value = true
  window.setTimeout(() => {
    shaking.value = false
  }, 400)
}

/** 返回上一页；无历史记录时回到项目列表 */
function leave(): void {
  if (window.history.state && window.history.state.back) {
    router.back()
  } else {
    router.replace('/projects')
  }
}

function onCancel(): void {
  if (dirty.value) {
    discardVisible.value = true
    return
  }
  leave()
}

function confirmDiscard(): void {
  discardVisible.value = false
  leave()
}

async function save(): Promise<void> {
  if (saving.value) return
  formError.value = ''
  if (!title.value.trim()) {
    warnTitle()
    return
  }
  saving.value = true
  try {
    const payload: ProjectPayload = {
      name: title.value.trim(),
      note: note.value.trim() || null,
    }
    if (editId.value) {
      await updateProject(editId.value, payload)
      taskSync.markDirty()
      toast.show('已保存')
      leave()
    } else {
      const created = await createProject(payload)
      taskSync.markDirty()
      toast.show('已保存')
      router.replace(`/projects/${created.id}`)
    }
  } catch (e) {
    // 失败停留在当前页，表单内容保留在内存中
    formError.value = errorText(e)
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (editId.value) {
    await loadProject()
  } else {
    initial.value = snapshot()
  }
})
</script>

<template>
  <div class="page form">
    <header class="form__head">
      <button class="form__cancel pressable" @click="onCancel">取消</button>
      <span class="form__title">{{ headTitle }}</span>
      <span class="form__placeholder" />
    </header>

    <div class="page-body form__body">
      <StateError v-if="loadError" :text="loadError" @retry="loadProject" />

      <p v-else-if="loading" class="form__loading">加载中…</p>

      <template v-else>
        <p v-if="formError" class="form__alert">{{ formError }}</p>

        <section class="form__group" :class="{ 'form__group--shake': shaking }">
          <AppInput
            v-model="title"
            label="项目名称 *"
            placeholder="请输入项目名称"
            :maxlength="200"
            :error="titleError"
            :autofocus="!editId"
            @update:model-value="titleError = ''"
          />
        </section>

        <section class="form__group">
          <AppInput
            v-model="note"
            label="备注"
            type="textarea"
            placeholder="补充说明…"
            :maxlength="2000"
          />
        </section>

        <div class="form__submit">
          <AppButton type="primary" :disabled="!canSave" :loading="saving" @click="save">
            保 存
          </AppButton>
        </div>
      </template>
    </div>

    <!-- 取消时若有未保存内容 → 放弃确认（默认焦点在「继续编辑」） -->
    <AppModal
      :visible="discardVisible"
      title="放弃本次编辑？"
      text="未保存的内容将丢失。"
      confirm-text="放弃"
      cancel-text="继续编辑"
      danger
      @confirm="confirmDiscard"
      @cancel="discardVisible = false"
    />
  </div>
</template>

<style scoped>
.form__head {
  display: flex;
  align-items: center;
  height: calc(var(--navbar-height) + var(--safe-top));
  padding: var(--safe-top) var(--sp-4) 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
}
.form__cancel {
  min-width: 44px;
  min-height: 44px;
  text-align: left;
  font-size: var(--font-body-l);
  color: var(--text-secondary);
}
.form__title {
  flex: 1;
  text-align: center;
  font-size: var(--font-heading-m);
  font-weight: 600;
}
.form__placeholder {
  min-width: 44px;
}
.form__body {
  /* 底部留白避让右下角 FAB */
  padding-bottom: calc(96px + var(--safe-bottom));
}
.form__loading {
  padding: var(--sp-6) var(--sp-4);
  text-align: center;
  font-size: var(--font-body-m);
  color: var(--text-secondary);
}
.form__alert {
  margin: var(--sp-3) var(--sp-4) 0;
  padding: var(--sp-3);
  background: #fff5f4;
  border-radius: var(--radius-control);
  color: var(--color-danger);
  font-size: var(--font-caption);
}
.form__group {
  margin-top: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.form__group--shake {
  animation: shake 400ms ease;
}
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20%,
  60% {
    transform: translateX(-6px);
  }
  40%,
  80% {
    transform: translateX(6px);
  }
}
.form__submit {
  padding: var(--sp-6) var(--sp-4) 0;
}
</style>
