import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { settingsStorageKey, type AppSettings } from '@/domain/settings'
import { fetchAdminModelUsageRanking, fetchAdminModelUserUsage, fetchAdminMonitorMetrics, fetchAdminUserModelUsage, fetchSub2apiMetrics } from '@/domain/sub2apiClient'

const { checkForAvailableUpdate, emitTauriEvent, getSettingsUpdatedListener, getAppVersion, hidePersonalFloatingOrb, invokeTauriCommand, listenTauriEvent, openReleaseNotes, resetSettingsUpdatedListener, tauriWindow } = vi.hoisted(() => {
  let settingsUpdatedListener: (() => void) | undefined
  const checkForAvailableUpdate = vi.fn<() => Promise<{ body: string; version: string } | null>>(async () => ({
    body: '修复平台更新提示',
    version: '0.4.2'
  }))
  const hidePersonalFloatingOrb = vi.fn()
  const getAppVersion = vi.fn(async () => '0.4.3')
  const openReleaseNotes = vi.fn(async () => undefined)
  const emitTauriEvent = vi.fn(async () => undefined)
  const invokeTauriCommand = vi.fn(async () => undefined)
  const listenTauriEvent = vi.fn(async (eventName: string, listener: () => void) => {
    if (eventName === 'token-orb-settings-updated') {
      settingsUpdatedListener = listener
    }
    return vi.fn()
  })
  const tauriWindow = {
    hide: hidePersonalFloatingOrb,
    onMoved: vi.fn(async () => vi.fn()),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    scaleFactor: vi.fn(async () => 1),
    show: vi.fn(async () => undefined),
    setPosition: vi.fn(async () => undefined),
    setShadow: vi.fn(async () => undefined),
    setSize: vi.fn(async () => undefined)
  }

  return {
    checkForAvailableUpdate,
    emitTauriEvent,
    getSettingsUpdatedListener: () => settingsUpdatedListener,
    getAppVersion,
    hidePersonalFloatingOrb,
    invokeTauriCommand,
    listenTauriEvent,
    openReleaseNotes,
    resetSettingsUpdatedListener: () => {
      settingsUpdatedListener = undefined
    },
    tauriWindow
  }
})

const localStorageMock = (() => {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, String(value))
    }
  } satisfies Storage
})()

vi.mock('@/domain/sub2apiClient', () => ({
  fetchAdminMonitorMetrics: vi.fn(async () => ({
    todayTotalTokens: null,
    todayTotalCost: null,
    poolRemainingPercent: null,
    poolLatestResetAt: null,
    poolResetItems: [],
    poolAccounts: null,
    poolCapacity: null,
    poolAccountDetails: [],
    userRanking: [],
    updatedAt: new Date().toISOString()
  })),
  fetchSub2apiMetrics: vi.fn(async () => ({
    todayTokens: null,
    firstTokenMs: null,
    updatedAt: new Date().toISOString()
  })),
  fetchAdminUserModelUsage: vi.fn(async () => []),
  fetchAdminModelUsageRanking: vi.fn(async () => []),
  fetchAdminModelUserUsage: vi.fn(async () => [])
}))

vi.mock('@tauri-apps/api/window', () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
  PhysicalPosition: class {},
  currentMonitor: vi.fn(async () => null),
  getCurrentWindow: vi.fn(() => tauriWindow)
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: getAppVersion
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitTauriEvent,
  listen: listenTauriEvent
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeTauriCommand
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: checkForAvailableUpdate
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: openReleaseNotes
}))

const baseSettings: AppSettings = {
  sub2apiBaseUrl: 'http://127.0.0.1:8081',
  adminApiKey: 'admin-key',
  personalFloatingEnabled: true,
  personalToken: '',
  poolGroupName: '旧分组',
  poolGroupNames: ['旧分组'],
  refreshSeconds: 10
}

describe('App settings sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetSettingsUpdatedListener()
    vi.stubGlobal('localStorage', localStorageMock)
    Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })
    localStorage.clear()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    window.history.replaceState({}, '', '/?view=platform')
  })

  it('refreshes platform metrics with updated pool group names after settings storage changes', async () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    mount(App)
    await flushPromises()

    expect(fetchAdminMonitorMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      poolGroupNames: ['旧分组']
    }))

    const nextSettings: AppSettings = {
      ...baseSettings,
      poolGroupName: '新分组',
      poolGroupNames: ['新分组', '备用分组']
    }
    localStorage.setItem(settingsStorageKey, JSON.stringify(nextSettings))
    window.dispatchEvent(new StorageEvent('storage', {
      key: settingsStorageKey,
      newValue: JSON.stringify(nextSettings)
    }))
    await flushPromises()

    expect(fetchSub2apiMetrics).not.toHaveBeenCalled()
    expect(fetchAdminMonitorMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      poolGroupNames: ['新分组', '备用分组']
    }))
  })

  it('uses a 410px platform window to keep the account summary on one line', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    Object.defineProperty(wrapper.get('.monitor-panel').element, 'scrollHeight', { configurable: true, value: 242 })
    await flushPromises()

    expect(tauriWindow.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 410, height: 242 }))
  })

  it('shows the 7d pool by default and switches to the 5h pool', async () => {
    vi.setSystemTime(new Date('2026-03-16T09:00:00Z'))
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: 91,
      poolLatestResetAt: '2026-03-16T12:37:00.000Z',
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z',
      poolSevenDayRemainingPercent: 73,
      poolSevenDayLatestResetAt: '2026-03-23T05:02:00.000Z',
      poolSevenDayResetItems: []
    } as Awaited<ReturnType<typeof fetchAdminMonitorMetrics>>)
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('7日号池剩余量')
    expect(wrapper.text()).toContain('73%')
    expect(wrapper.text()).toContain('6d 20h 2m 后刷新')
    expect(wrapper.get('button.pool-window-tab[data-window="7d"]').text()).toBe('7d')
    expect(wrapper.get('button.pool-window-tab[data-window="5h"]').text()).toBe('5h')

    await wrapper.get('button.pool-window-tab[data-window="5h"]').trigger('click')

    expect(wrapper.text()).toContain('5小时号池剩余量')
    expect(wrapper.text()).toContain('91%')
  })

  it('resizes the platform window to the rendered account panel height after expanding details', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 0, error: 0, total: 1 },
      poolCapacity: null,
      poolAccountDetails: [
        { rank: 1, name: '正常账号', status: 'normal', statusText: '正常', schedulable: true, scheduleText: '调度中', capacityText: '0 / 10', capacityUsed: 0, todayTokens: 1, sevenDayCost: null, usageWindows: [] }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()
    Object.defineProperty(wrapper.get('.monitor-panel').element, 'scrollHeight', { configurable: true, value: 278 })
    tauriWindow.setSize.mockClear()

    await wrapper.get('button.account-details-toggle').trigger('click')
    await flushPromises()

    expect(tauriWindow.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 410, height: 278 }))
  })

  it('shows a saved confirmation after saving settings', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalToken: 'bad-jwt'
    }))
    vi.mocked(fetchSub2apiMetrics).mockRejectedValueOnce(new Error('请求失败'))
    const wrapper = mount(App)

    await wrapper.get('button.primary-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('配置已保存')
    expect(wrapper.text()).not.toContain('请求失败')
    expect(fetchAdminMonitorMetrics).toHaveBeenCalled()
    expect(fetchSub2apiMetrics).toHaveBeenCalled()
  })

  it('emits the settings update event after saving configuration in Tauri', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)

    await wrapper.get('button.primary-button').trigger('click')
    await flushPromises()

    expect(emitTauriEvent).toHaveBeenCalledWith('token-orb-settings-updated')
  })

  it('shows the personal floating window after receiving updated settings from Tauri', async () => {
    window.history.replaceState({}, '', '/?view=personal')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: false
    }))
    mount(App)
    await flushPromises()
    vi.clearAllMocks()

    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: true
    }))
    const settingsUpdatedListener = getSettingsUpdatedListener()

    expect(settingsUpdatedListener).toEqual(expect.any(Function))
    if (!settingsUpdatedListener) return

    settingsUpdatedListener()
    await flushPromises()

    expect(tauriWindow.show).toHaveBeenCalledOnce()
  })

  it('shows the current version beside the platform title and marks it when a new version is available', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    const button = wrapper.get('.monitor-panel > .section-title .platform-version--available')
    expect(button.text()).toContain('v0.4.3')
    expect(button.find('.platform-version__update-dot').exists()).toBe(true)
  })

  it('renders tray commands separately and sends monitor clicks to Rust', async () => {
    window.history.replaceState({}, '', '/?view=tray-menu')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('显示监控面板')
    expect(wrapper.text()).toContain('设置')
    expect(wrapper.text()).toContain('有版本更新')
    expect(wrapper.text()).toContain('当前版本 v0.4.3')
    expect(wrapper.text()).toContain('退出 Token Orb')

    await wrapper.get('.tray-menu-item').trigger('click')
    await flushPromises()

    expect(invokeTauriCommand).toHaveBeenCalledWith('tray_command', { command: 'monitor' })
    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
  })

  it('shows the current version in the normal color when no update is available', async () => {
    checkForAvailableUpdate.mockResolvedValueOnce(null)
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    const version = wrapper.get('.monitor-panel > .section-title .platform-version')
    expect(version.text()).toContain('v0.4.3')
    expect(version.classes()).not.toContain('platform-version--available')
    expect(version.find('.platform-version__update-dot').exists()).toBe(false)
  })

  it('emits the native update event after clicking the platform version update button', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('.monitor-panel > .section-title .platform-version--available').trigger('click')
    await flushPromises()

    expect(emitTauriEvent).toHaveBeenCalledWith('token-orb-open-update')
  })

  it('opens the matching GitHub release page from the updater changelog link', async () => {
    window.history.replaceState({}, '', '/?view=updater')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('.update-release-notes').trigger('click')
    await flushPromises()

    expect(openReleaseNotes).toHaveBeenCalledWith('https://github.com/tangjiale/token-orb/releases/tag/v0.4.2')
  })

  it('resizes the updater window to show the complete update notes', async () => {
    window.history.replaceState({}, '', '/?view=updater')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    const wrapper = mount(App)
    await flushPromises()
    Object.defineProperty(wrapper.get('.update-panel').element, 'scrollHeight', { configurable: true, value: 486 })
    tauriWindow.setSize.mockClear()

    await wrapper.get('.update-refresh-button').trigger('click')
    await flushPromises()

    expect(tauriWindow.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 420, height: 522 }))
  })

  it('tests personal JWT independently from admin API settings', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalToken: 'personal-jwt'
    }))
    const wrapper = mount(App)
    await flushPromises()
    vi.clearAllMocks()

    await wrapper.get('button.secondary-mini-button').trigger('click')
    await flushPromises()

    expect(fetchSub2apiMetrics).toHaveBeenCalledWith({
      baseUrl: baseSettings.sub2apiBaseUrl,
      token: 'personal-jwt'
    })
    expect(fetchAdminMonitorMetrics).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('个人 JWT 正常')
  })

  it('shows the actual personal JWT test error message', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalToken: 'expired-jwt'
    }))
    const wrapper = mount(App)
    await flushPromises()
    vi.clearAllMocks()
    vi.mocked(fetchSub2apiMetrics).mockRejectedValueOnce('认证失败，Token 错误或已失效（HTTP 401）')

    await wrapper.get('button.secondary-mini-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('认证失败，Token 错误或已失效（HTTP 401）')
    expect(wrapper.text()).not.toContain('个人 JWT 测试失败')
  })

  it('defaults the personal floating orb to disabled and hides its JWT field', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    const { personalFloatingEnabled: _personalFloatingEnabled, ...legacySettings } = baseSettings
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...legacySettings,
      personalToken: 'personal-jwt'
    }))
    const wrapper = mount(App)

    const floatingToggle = wrapper.find('input[name="personal-floating-enabled"]')

    expect(floatingToggle.exists()).toBe(true)
    expect((floatingToggle.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.find('input[placeholder="用于悬浮球个人数据"]').exists()).toBe(false)
  })

  it('shows the personal JWT field after enabling the personal floating orb', async () => {
    window.history.replaceState({}, '', '/?view=settings')
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: false,
      personalToken: 'personal-jwt'
    }))
    const wrapper = mount(App)

    await wrapper.get('input[name="personal-floating-enabled"]').setValue(true)

    expect(wrapper.find('input[placeholder="用于悬浮球个人数据"]').exists()).toBe(true)
  })

  it('closes the personal floating orb through the Tauri window hide API', async () => {
    window.history.replaceState({}, '', '/?view=personal')
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
    localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...baseSettings,
      personalFloatingEnabled: true
    }))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button[title="关闭个人悬浮球"]').trigger('click')
    await flushPromises()

    expect(hidePersonalFloatingOrb).toHaveBeenCalledOnce()
  })

  it('shows group account details by default and allows collapsing them', async () => {
    vi.setSystemTime(new Date('2026-03-16T09:00:00.000Z'))
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: 52220000,
      todayTotalCost: 32.481,
      totalTokens: 10080000000,
      totalActualCost: 8150,
      totalAccountCost: 8150,
      totalStandardCost: 8150,
      averageDurationMs: 16540,
      activeUsers: 7,
      poolRemainingPercent: 91,
      poolLatestResetAt: '2026-03-16T12:37:00.000Z',
      poolResetItems: [],
      poolAccounts: { active: 5, limited: 1, error: 1, total: 7 },
      poolCapacity: { groupId: null, concurrencyUsed: 0, concurrencyMax: 50 },
      poolAccountDetails: [
        {
          rank: 1,
          priority: 1,
          name: '由磊（707200583@163.com）',
          status: 'normal',
          statusText: '正常',
          schedulable: true,
          scheduleText: '调度中',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayTokens: 52220000,
          sevenDayCost: 5.406,
          usageWindows: [
            { type: '5h', usedPercent: 9, resetAt: '2026-03-16T12:37:00.000Z' },
            { type: '7d', usedPercent: 7, resetAt: '2026-03-23T09:00:00.000Z' }
          ]
        }
      ],
      userRanking: [
        {
          rank: 1,
          userId: 2,
          name: '由磊',
          email: '707200583@163.com',
          displayName: '由磊（707200583@163.com）',
          tokens: 52220000,
          actualCost: 13.08
        }
      ],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('今日用量榜')
    expect(wrapper.get('.ranking-box .section-title').text()).toContain('排行榜')
    expect(wrapper.text()).toContain('账号信息')
    expect(wrapper.text()).not.toContain('分组账号详情')
    expect(wrapper.text()).toContain('账号：5/1/1/7')
    expect(wrapper.text()).toContain('容量：0 / 50')
    expect(wrapper.text()).toContain('由磊（707200583@163.com）')
    expect(wrapper.get('button.account-details-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('button.ranking-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.monitor-card .token-cost').text()).toBe('$32.48')
    expect(wrapper.get('.monitor-grid--secondary').text()).toContain('总 Token')
    expect(wrapper.get('.monitor-grid--secondary').text()).toContain('10.08B')
    expect(wrapper.get('.monitor-grid--secondary .token-cost').text()).toContain('$8.15K')
    expect(wrapper.find('.monitor-grid--secondary .token-account-cost').exists()).toBe(false)
    expect(wrapper.find('.monitor-grid--secondary .token-standard-cost').exists()).toBe(false)
    expect(wrapper.get('.monitor-grid--secondary').text()).toContain('平均响应16.54s')
    expect(wrapper.get('.monitor-grid--secondary').text()).toContain('7 活跃用户')
    expect(wrapper.get('.ranking-value .token-cost').text()).toBe('$13.08')
    expect(wrapper.get('.account-detail-card__identity b').text()).toBe('#1')
    expect(wrapper.find('.account-priority-pill').exists()).toBe(false)
    expect(wrapper.get('.schedule-pill').text()).toBe('调度中')
    expect(wrapper.get('.account-status-pill.normal').text()).toBe('正常')
    expect(wrapper.text()).toContain('0 / 10')
    expect(wrapper.text()).toContain('金额 $5.41')
    expect(wrapper.text()).not.toContain('请求 159')
    expect(wrapper.text()).toContain('Token 52.2M')
    expect(wrapper.text()).toContain('5h使用量 9% · 3h 37m')
    expect(wrapper.text()).toContain('7d使用量 7% · 7d')
    expect(wrapper.get('.usage-window-bar i').attributes('style')).toContain('width: 9%')

    await wrapper.get('button.account-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.find('.schedule-pill').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('5h使用量 9%')

    await wrapper.get('button.account-details-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.get('.schedule-pill').text()).toBe('调度中')
    expect(wrapper.text()).toContain('5h使用量 9% · 3h 37m')
  })

  it('collapses the ranking while keeping its tabs available', async () => {
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.ranking-toggle').trigger('click')
    await flushPromises()

    expect(wrapper.get('button.ranking-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).toContain('今日用量榜')
    expect(wrapper.find('.ranking-content').exists()).toBe(false)
  })

  it('colors account usage bars by the used percentage thresholds', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: { active: 3, limited: 0, error: 0, total: 3 },
      poolCapacity: null,
      poolAccountDetails: [80, 81, 100].map((usedPercent, index) => ({
        rank: index + 1,
        name: `账号${usedPercent}`,
        status: 'normal' as const,
        statusText: '正常',
        schedulable: true,
        scheduleText: '调度中',
        capacityText: '0 / 10',
        capacityUsed: 0,
        todayTokens: 0,
        sevenDayCost: null,
        usageWindows: [{ type: '5h' as const, usedPercent, resetAt: null }]
      })),
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    const bars = wrapper.findAll('.usage-window-bar i')
    expect(bars).toHaveLength(3)
    expect(bars[0].classes()).not.toContain('warning')
    expect(bars[0].classes()).not.toContain('danger')
    expect(bars[1].classes()).toContain('warning')
    expect(bars[1].classes()).not.toContain('danger')
    expect(bars[2].classes()).toContain('danger')
    expect(bars.map((bar) => bar.attributes('style'))).toEqual([
      expect.stringContaining('width: 80%'),
      expect.stringContaining('width: 81%'),
      expect.stringContaining('width: 100%')
    ])
    expect(wrapper.text()).toContain('5h使用量 80%')
    expect(wrapper.text()).toContain('5h使用量 81%')
    expect(wrapper.text()).toContain('5h使用量 100%')
  })

  it('filters group account details from status values and only toggles them from the arrow', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 1, error: 1, total: 4 },
      poolCapacity: null,
      poolAccountDetails: [
        { rank: 1, name: '正常账号', status: 'normal', statusText: '正常', schedulable: true, scheduleText: '调度中', capacityText: '0 / 10', capacityUsed: 0, todayTokens: 1, sevenDayCost: 1, usageWindows: [] },
        { rank: 2, name: '限流账号', status: 'limited', statusText: '限流中', schedulable: false, scheduleText: '已关闭', capacityText: '1 / 10', capacityUsed: 1, todayTokens: 2, sevenDayCost: 2, usageWindows: [] },
        { rank: 3, name: '错误账号', status: 'error', statusText: '错误', schedulable: false, scheduleText: '已关闭', capacityText: '2 / 10', capacityUsed: 2, todayTokens: 3, sevenDayCost: 3, usageWindows: [] },
        { rank: 4, name: '停用账号', status: 'disabled', statusText: '停用', schedulable: false, scheduleText: '已关闭', capacityText: '0 / 10', capacityUsed: 0, todayTokens: 4, sevenDayCost: 4, usageWindows: [] }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.account-filter.limited').trigger('click')

    expect(wrapper.get('button.account-filter.limited').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('token-orb-account-filter-v1')).toBe('limited')
    expect(wrapper.text()).toContain('限流账号')
    expect(wrapper.text()).not.toContain('正常账号')
    expect(wrapper.text()).not.toContain('错误账号')
    expect(wrapper.text()).not.toContain('停用账号')

    await wrapper.get('button.account-filter.total').trigger('click')

    expect(wrapper.text()).toContain('正常账号')
    expect(wrapper.text()).toContain('限流账号')
    expect(wrapper.text()).toContain('错误账号')
    expect(wrapper.text()).toContain('停用账号')
    expect(wrapper.find('.schedule-pill:not(.off)').text()).toBe('调度中')
    expect(wrapper.findAll('.schedule-pill.off')).toHaveLength(3)
  })

  it('restores the persisted account status filter after reopening the platform window', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: null,
      todayTotalCost: null,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 1, error: 0, total: 2 },
      poolCapacity: null,
      poolAccountDetails: [
        { rank: 1, name: '正常账号', status: 'normal', statusText: '正常', schedulable: true, scheduleText: '调度中', capacityText: '0 / 10', capacityUsed: 0, todayTokens: 1, sevenDayCost: 1, usageWindows: [] },
        { rank: 2, name: '限流账号', status: 'limited', statusText: '限流中', schedulable: false, scheduleText: '已关闭', capacityText: '1 / 10', capacityUsed: 1, todayTokens: 2, sevenDayCost: 2, usageWindows: [] }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    localStorage.setItem('token-orb-account-filter-v1', 'limited')
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('button.account-filter.limited').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('限流账号')
    expect(wrapper.text()).not.toContain('正常账号')
  })

  it('filters normal and errored account details while expanded by default', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValue({
      todayTotalTokens: 52220000,
      todayTotalCost: 32.481,
      poolRemainingPercent: 91,
      poolLatestResetAt: '2026-03-16T12:37:00.000Z',
      poolResetItems: [],
      poolAccounts: { active: 1, limited: 1, error: 1, total: 3 },
      poolCapacity: { groupId: null, concurrencyUsed: 0, concurrencyMax: 50 },
      poolAccountDetails: [
        {
          rank: 1,
          name: '正常账号',
          status: 'normal',
          statusText: '正常',
          schedulable: true,
          scheduleText: '调度中',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayTokens: 52220000,
          sevenDayCost: 5.4,
          usageWindows: []
        },
        {
          rank: 2,
          name: '限流账号',
          status: 'limited',
          statusText: '限流中',
          schedulable: false,
          scheduleText: '已关闭',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayTokens: 0,
          sevenDayCost: 0,
          usageWindows: []
        },
        {
          rank: 3,
          name: '错误账号',
          status: 'error',
          statusText: '错误',
          schedulable: false,
          scheduleText: '已关闭',
          capacityText: '0 / 10',
          capacityUsed: 0,
          todayTokens: 0,
          sevenDayCost: 0,
          usageWindows: []
        }
      ],
      userRanking: [],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.account-status-filter[data-status="normal"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.account-details-list').exists()).toBe(true)
    expect(wrapper.get('button.account-status-filter[data-status="normal"]').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('token-orb-account-filter-v1')).toBe('normal')

    expect(wrapper.text()).toContain('正常账号')
    expect(wrapper.text()).not.toContain('限流账号')
    expect(wrapper.text()).not.toContain('错误账号')

    await wrapper.get('button.account-status-filter[data-status="error"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('button.account-status-filter[data-status="error"]').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem('token-orb-account-filter-v1')).toBe('error')
    expect(wrapper.text()).toContain('错误账号')
    expect(wrapper.text()).not.toContain('正常账号')
  })

  it('switches the ranking between token usage and actual cost', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: 15000000,
      todayTotalCost: 3.5,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [
        {
          rank: 1,
          userId: 1,
          name: '高用量',
          email: 'usage@example.com',
          displayName: '高用量（usage@example.com）',
          tokens: 12000000,
          actualCost: 1.2
        },
        {
          rank: 2,
          userId: 2,
          name: '高消费',
          email: 'cost@example.com',
          displayName: '高消费（cost@example.com）',
          tokens: 3000000,
          actualCost: 9.9
        }
      ],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    const firstRow = () => wrapper.findAll('.ranking-row')[0].text()

    expect(wrapper.get('.ranking-tab.active').text()).toBe('今日用量榜')
    expect(firstRow()).toContain('高用量')
    expect(firstRow()).toContain('12.00M')
    expect(firstRow()).toContain('$1.20')

    await wrapper.findAll('.ranking-tab')[1].trigger('click')
    await flushPromises()

    expect(wrapper.get('.ranking-tab.active').text()).toBe('今日消费榜')
    expect(wrapper.get('.ranking-value').classes()).toContain('ranking-value--cost')
    expect(firstRow()).toContain('高消费')
    expect(firstRow()).toContain('3.00M')
    expect(firstRow()).toContain('$9.90')
  })

  it('expands a ranking user and sorts model usage by the active ranking mode', async () => {
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValueOnce({
      todayTotalTokens: 15000000,
      todayTotalCost: 3.5,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [{
        rank: 1,
        userId: 1,
        name: '模型用户',
        email: 'models@example.com',
        displayName: '模型用户（models@example.com）',
        tokens: 15000000,
        actualCost: 3.5
      }],
      updatedAt: '2026-03-16T09:00:00.000Z'
    })
    vi.mocked(fetchAdminUserModelUsage).mockResolvedValueOnce([
      { model: '高费用模型', requests: 300, tokens: 3000000, actualCost: 2.9 },
      { model: '高用量模型', requests: 120, tokens: 12000000, actualCost: 0.6 }
    ])
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.ranking-row').trigger('click')
    await flushPromises()

    const modelRows = () => wrapper.findAll('.ranking-model-row')
    expect(fetchAdminUserModelUsage).toHaveBeenCalledWith({
      baseUrl: baseSettings.sub2apiBaseUrl,
      apiKey: baseSettings.adminApiKey
    }, 1)
    expect(wrapper.get('button.ranking-row').attributes('aria-expanded')).toBe('true')
    expect(modelRows()[0].text()).toContain('高用量模型')
    expect(modelRows()[1].text()).toContain('高费用模型')

    await wrapper.findAll('.ranking-tab')[1].trigger('click')
    await flushPromises()

    expect(modelRows()[0].text()).toContain('高费用模型')
    expect(modelRows()[1].text()).toContain('高用量模型')
  })

  it('keeps an expanded ranking user open and refreshes its model usage with the metrics', async () => {
    const metrics = {
      todayTotalTokens: 15000000,
      todayTotalCost: 3.5,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [{
        rank: 1,
        userId: 987,
        name: '模型用户',
        email: 'models@example.com',
        displayName: '模型用户（models@example.com）',
        tokens: 15000000,
        actualCost: 3.5
      }],
      updatedAt: '2026-03-16T09:00:00.000Z'
    } as Awaited<ReturnType<typeof fetchAdminMonitorMetrics>>
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValue(metrics)
    let userModelRequestCount = 0
    vi.mocked(fetchAdminUserModelUsage).mockImplementation(async (_config, userId) => {
      if (userId !== 987) return []
      userModelRequestCount += 1
      return userModelRequestCount === 1
        ? [{ model: '旧模型', requests: 12, tokens: 1200000, actualCost: 0.6 }]
        : [{ model: '今日模型', requests: 18, tokens: 1800000, actualCost: 0.9 }]
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.ranking-row').trigger('click')
    await flushPromises()
    expect(wrapper.get('button.ranking-row').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.ranking-model-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('旧模型')

    await vi.advanceTimersByTimeAsync(baseSettings.refreshSeconds * 1000)
    await flushPromises()

    expect(vi.mocked(fetchAdminUserModelUsage).mock.calls.filter(([, userId]) => userId === 987)).toHaveLength(2)
    expect(wrapper.get('button.ranking-row').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.ranking-model-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('今日模型')
    expect(wrapper.text()).not.toContain('旧模型')
  })

  it('retries a failed ranking user model request when the row is expanded again', async () => {
    const metrics = {
      todayTotalTokens: 15000000,
      todayTotalCost: 3.5,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [{
        rank: 1,
        userId: 1,
        name: '重试用户',
        email: 'retry@example.com',
        displayName: '重试用户（retry@example.com）',
        tokens: 15000000,
        actualCost: 3.5
      }],
      updatedAt: '2026-03-16T09:00:00.000Z'
    } as Awaited<ReturnType<typeof fetchAdminMonitorMetrics>>
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValue(metrics)
    vi.mocked(fetchAdminUserModelUsage)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce([
        { model: '重试成功模型', requests: 3, tokens: 300000, actualCost: 0.15 }
      ])
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.ranking-row').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('模型用量加载失败')

    await wrapper.get('button.ranking-row').trigger('click')
    await wrapper.get('button.ranking-row').trigger('click')
    await flushPromises()

    expect(fetchAdminUserModelUsage).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('重试成功模型')
    expect(wrapper.text()).not.toContain('模型用量加载失败')
  })

  it('keeps the refreshed model usage when an older expanded user request finishes later', async () => {
    const metrics = {
      todayTotalTokens: 15000000,
      todayTotalCost: 3.5,
      poolRemainingPercent: null,
      poolLatestResetAt: null,
      poolResetItems: [],
      poolAccounts: null,
      poolCapacity: null,
      poolAccountDetails: [],
      userRanking: [{
        rank: 1,
        userId: 654,
        name: '慢查询用户',
        email: 'slow@example.com',
        displayName: '慢查询用户（slow@example.com）',
        tokens: 15000000,
        actualCost: 3.5
      }],
      updatedAt: '2026-03-16T09:00:00.000Z'
    } as Awaited<ReturnType<typeof fetchAdminMonitorMetrics>>
    let resolveOldModels: ((models: Awaited<ReturnType<typeof fetchAdminUserModelUsage>>) => void) | undefined
    let resolveTodayModels: ((models: Awaited<ReturnType<typeof fetchAdminUserModelUsage>>) => void) | undefined
    vi.mocked(fetchAdminMonitorMetrics).mockResolvedValue(metrics)
    vi.mocked(fetchAdminUserModelUsage).mockImplementation((_config, userId) => {
      if (userId !== 654) return Promise.resolve([])
      if (!resolveOldModels) {
        return new Promise((resolve) => {
          resolveOldModels = resolve
        })
      }
      return new Promise((resolve) => {
        resolveTodayModels = resolve
      })
    })
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.get('button.ranking-row').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('加载模型用量中...')

    await vi.advanceTimersByTimeAsync(baseSettings.refreshSeconds * 1000)
    await flushPromises()
    expect(vi.mocked(fetchAdminUserModelUsage).mock.calls.filter(([, userId]) => userId === 654)).toHaveLength(2)

    resolveTodayModels?.([{ model: '今日模型', requests: 4, tokens: 14090000, actualCost: 2.52 }])
    await flushPromises()
    resolveOldModels?.([{ model: '昨日模型', requests: 40, tokens: 115360000, actualCost: 87.6 }])
    await flushPromises()

    expect(wrapper.text()).not.toContain('加载模型用量中...')
    expect(wrapper.text()).toContain('今日模型')
    expect(wrapper.text()).not.toContain('昨日模型')
  })

  it('shows the model ranking and reorders expanded users with the selected column', async () => {
    vi.mocked(fetchAdminModelUsageRanking).mockResolvedValueOnce([
      { model: '高费用模型', requests: 300, tokens: 3000000, actualCost: 2.9 },
      { model: '高用量模型', requests: 120, tokens: 12000000, actualCost: 0.6 }
    ])
    vi.mocked(fetchAdminModelUserUsage).mockResolvedValueOnce([
      { userId: 1, displayName: '高费用用户', requests: 300, tokens: 3000000, actualCost: 2.9 },
      { userId: 2, displayName: '高用量用户', requests: 120, tokens: 12000000, actualCost: 0.6 }
    ])
    localStorage.setItem(settingsStorageKey, JSON.stringify(baseSettings))
    const wrapper = mount(App)
    await flushPromises()

    await wrapper.findAll('.ranking-tab')[2].trigger('click')
    await flushPromises()

    const modelRows = () => wrapper.findAll('.model-ranking-row')
    expect(wrapper.get('.ranking-tab.active').text()).toBe('模型用量榜')
    expect(wrapper.get('.model-ranking-head button[title="按 Token 从高到低排序"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.model-ranking-head button[title="按消费从高到低排序"]').text()).toContain('消费')
    expect(modelRows()[0].text()).toContain('高用量模型')
    expect(modelRows()[1].text()).toContain('高费用模型')

    await modelRows()[0].trigger('click')
    await flushPromises()

    const userRows = () => wrapper.findAll('.model-ranking-user-row')
    expect(userRows()[0].text()).toContain('高用量用户')
    expect(userRows()[1].text()).toContain('高费用用户')

    await wrapper.get('.model-ranking-head button[title="按请求数从高到低排序"]').trigger('click')
    await flushPromises()

    expect(modelRows()[0].text()).toContain('高费用模型')
    expect(wrapper.get('.model-ranking-head button[title="按请求数从高到低排序"]').attributes('aria-pressed')).toBe('true')

    await wrapper.get('.model-ranking-head button:last-of-type').trigger('click')
    await flushPromises()

    expect(modelRows()[0].text()).toContain('高费用模型')
    expect(userRows()[0].text()).toContain('高费用用户')
    expect(wrapper.get('.model-ranking-head button[title="按消费从高到低排序"]').attributes('aria-pressed')).toBe('true')
  })
})
