<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createAgent, fetchAgent, updateAgent } from '@/api/agents'
import { ApiError, errorText } from '@/api/client'
import AppButton from '@/components/AppButton.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppInput from '@/components/AppInput.vue'
import AppModal from '@/components/AppModal.vue'
import StateError from '@/components/StateError.vue'
import { useAgentTokenStore } from '@/stores/agentToken'
import { useToastStore } from '@/stores/toast'

/**
 * 新建/编辑代理（v0.7.0，UXUI 5.2）：
 * 名称 ≤50 / 类型 2×2 平铺 radio（选「其他」展开自定义类型名 ≤30）/ 描述 ≤200；
 * 新建成功 replace 进入详情页，并以内存态携带一次性凭据。
 */
const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const agentToken = useAgentTokenStore()

const editId = computed(() => (route.params.id ? String(route.params.id) : ''))
const headTitle = computed(() => (editId.value ? '编辑代理' : '新建代理'))

const KIND_OPTIONS = [
  { value: 'claude_code', label: 'Claude Code' },
  { value: 'opencode', label: 'opencode' },
  { value: 'pi_agent', label: 'pi agent' },
  { value: 'custom', label: '其他' },
]

const name = ref('')
const kind = ref('')
const customName = ref('')
const description = ref('')

const nameError = ref('')
const kindError = ref('')
const customError = ref('')
const formError = ref('')
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const discardOpen = ref(false)

let initialSnapshot = ''

function snapshot(): string {
  return JSON.stringify({
    name: name.value.trim(),
    kind: kind.value,
    custom: customName.value.trim(),
    description: description.value.trim(),
  })
}

const dirty = computed(() => snapshot() !== initialSnapshot)

async function loadAgent(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const agent = await fetchAgent(editId.value)
    name.value = agent.name
    kind.value = agent.kind
    customName.value = agent.kind === 'custom' ? agent.kind_label : ''
    description.value = agent.description || ''
    initialSnapshot = snapshot()
  } catch (e) {
    loadError.value = errorText(e)
  } finally {
    loading.value = false
  }
}

function selectKind(value: string): void {
  kind.value = value
  kindError.value = ''
  customError.value = ''
}

function cancel(): void {
  if (dirty.value) {
    discardOpen.value = true
    return
  }
  router.back()
}

function discard(): void {
  discardOpen.value = false
  router.back()
}

async function save(): Promise<void> {
  if (saving.value) return
  formError.value = ''
  nameError.value = ''
  kindError.value = ''
  customError.value = ''

  const value = name.value.trim()
  if (!value) {
    nameError.value = '请输入名称'
    return
  }
  if (value.length > 50) {
    nameError.value = '名称不能超过 50 个字符'
    return
  }
  if (!kind.value) {
    kindError.value = '请选择代理类型'
    return
  }
  const custom = customName.value.trim()
  if (kind.value === 'custom') {
    if (!custom) {
      customError.value = '请输入自定义类型名'
      return
    }
    if (custom.length > 30) {
      customError.value = '自定义类型名不能超过 30 个字符'
      return
    }
  }

  saving.value = true
  try {
    if (editId.value) {
      await updateAgent(editId.value, {
        name: value,
        kind: kind.value,
        description: description.value.trim() || null,
        ...(kind.value === 'custom' ? { kind_label: custom } : {}),
      })
      toast.show('已保存')
      router.back()
    } else {
      const res = await createAgent({
        name: value,
        kind: kind.value,
        description: description.value.trim() || null,
        ...(kind.value === 'custom' ? { kind_label: custom } : {}),
      })
      agentToken.setOneTimeToken(res.agent.id, res.token)
      router.replace(`/agents/${res.agent.id}`)
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === 1005) {
      nameError.value = '已存在同名代理'
    } else {
      formError.value = errorText(e)
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  if (editId.value) void loadAgent()
  else initialSnapshot = snapshot()
})
</script>

<template>
  <div class="page form">
    <header class="form__head">
      <button class="form__cancel pressable" type="button" @click="cancel">取消</button>
      <span class="form__title">{{ headTitle }}</span>
      <span class="form__placeholder" />
    </header>

    <div class="page-body form__body">
      <p v-if="loading" class="form__loading">加载中…</p>

      <StateError v-else-if="loadError" :text="loadError" @retry="loadAgent" />

      <template v-else>
        <p v-if="formError" class="form__alert">{{ formError }}</p>

        <section class="form__group">
          <AppInput
            v-model="name"
            label="名称 *"
            placeholder="例如：工作机-CC"
            :maxlength="50"
            autofocus
            :error="nameError"
            @update:model-value="nameError = ''"
          />
        </section>

        <section class="form__group form__group--plain">
          <p class="form__label">类型 *</p>
          <div class="form__kinds" role="radiogroup" aria-label="类型">
            <button
              v-for="opt in KIND_OPTIONS"
              :key="opt.value"
              class="form__kind pressable"
              :class="{ 'form__kind--on': kind === opt.value }"
              type="button"
              role="radio"
              :aria-checked="kind === opt.value"
              @click="selectKind(opt.value)"
            >
              <span class="form__kind-label">{{ opt.label }}</span>
              <AppIcon
                v-if="kind === opt.value"
                name="check"
                :size="16"
                color="var(--color-primary)"
                class="form__kind-check"
              />
            </button>
          </div>
          <p v-if="kindError" class="form__field-error" role="alert">{{ kindError }}</p>
        </section>

        <section v-if="kind === 'custom'" class="form__group">
          <AppInput
            v-model="customName"
            label="自定义类型名"
            placeholder="请输入自定义类型名"
            :maxlength="30"
            :error="customError"
            @update:model-value="customError = ''"
          />
        </section>

        <section class="form__group">
          <AppInput
            v-model="description"
            label="描述（可选）"
            type="textarea"
            placeholder="这个代理用来做什么…"
            :maxlength="200"
          />
        </section>

        <div class="form__submit">
          <AppButton type="primary" :loading="saving" @click="save">保 存</AppButton>
        </div>
      </template>
    </div>

    <AppModal
      :visible="discardOpen"
      title="放弃本次编辑？"
      text="未保存的内容将丢失"
      confirm-text="放弃"
      cancel-text="继续编辑"
      danger
      @confirm="discard"
      @cancel="discardOpen = false"
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
  padding-bottom: calc(96px + var(--safe-bottom));
}
.form__loading {
  padding: var(--sp-4);
  font-size: var(--font-caption);
  color: var(--text-secondary);
}
.form__alert {
  margin: var(--sp-3) var(--sp-4) 0;
  padding: var(--sp-3);
  background: var(--bg-card);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-control);
  color: var(--color-danger);
  font-size: var(--font-caption);
}
.form__group {
  margin-top: var(--sp-3);
  padding: var(--sp-4);
  background: var(--bg-card);
}
.form__group--plain {
  padding: var(--sp-4);
}
.form__label {
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--text-secondary);
  margin-bottom: var(--sp-2);
}
.form__kinds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-2);
}
.form__kind {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-control);
  background: var(--bg-card);
  font-size: var(--font-body-m);
  color: var(--text-primary);
}
.form__kind--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 500;
}
.form__kind-label {
  min-width: 0;
}
.form__kind-check {
  position: absolute;
  top: 4px;
  right: 4px;
}
.form__field-error {
  margin-top: var(--sp-2);
  font-size: var(--font-caption);
  line-height: var(--font-caption-lh);
  color: var(--color-danger);
}
.form__submit {
  padding: var(--sp-6) var(--sp-4) 0;
}
</style>
