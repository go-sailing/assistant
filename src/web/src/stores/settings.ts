import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as settingsApi from '@/api/settings'
import type { UserSettings } from '@/types'

/** 偏好默认值：与后端 DEFAULT_SETTINGS 一致（老用户无行也按此展示） */
const DEFAULTS: UserSettings = {
  lunar_enabled: true,
  solar_terms_enabled: true,
  home_route: '/calendar',
}

/**
 * v0.4.0 偏好设置（PRD 第 10 章）。
 *
 * - 登录后 bootstrap 一次；设置页保存后即时回写（开关"即改即生效"）；
 * - 农历开关控制全站农历文案；**法定「休/班」角标与节假日名不受其影响**（PRD 5.4）；
 * - 深链/未登录时按默认值渲染，不阻塞首屏。
 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<UserSettings>({ ...DEFAULTS })
  const loaded = ref(false)

  const lunarEnabled = computed(() => settings.value.lunar_enabled)
  const termsEnabled = computed(() => settings.value.solar_terms_enabled)
  const homeRoute = computed(() => settings.value.home_route)

  /** 拉取偏好（幂等；失败保持默认值，不阻断界面） */
  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    try {
      settings.value = await settingsApi.getSettings()
      loaded.value = true
    } catch {
      settings.value = { ...DEFAULTS }
    }
  }

  /** 保存偏好（服务端返回合并后的完整对象）；失败向上抛由调用方回拨控件 */
  async function save(patch: Partial<UserSettings>): Promise<UserSettings> {
    const next = await settingsApi.updateSettings(patch)
    settings.value = next
    loaded.value = true
    return next
  }

  /** 退出登录时清理，避免下一个账号继承上一个账号的偏好 */
  function reset(): void {
    settings.value = { ...DEFAULTS }
    loaded.value = false
  }

  return { settings, loaded, lunarEnabled, termsEnabled, homeRoute, load, save, reset }
})