export const statusBarMetricKeys = [
  'todayUsage',
  'totalUsage',
  'capacity',
  'poolSevenDayRemaining',
  'selectedUserUsage'
] as const

export type StatusBarMetricKey = typeof statusBarMetricKeys[number]

export interface AppSettings {
  sub2apiBaseUrl: string
  adminApiKey: string
  personalFloatingEnabled: boolean
  personalToken: string
  poolGroupName: string
  poolGroupNames: string[]
  statusBarMetrics: StatusBarMetricKey[]
  statusBarUserId: number | null
  refreshSeconds: number
}

export const defaultSettings: AppSettings = {
  sub2apiBaseUrl: '',
  adminApiKey: '',
  personalFloatingEnabled: false,
  personalToken: '',
  poolGroupName: '',
  poolGroupNames: [],
  statusBarMetrics: [],
  statusBarUserId: null,
  refreshSeconds: 30
}

export const settingsStorageKey = 'token-orb-settings-v1'

export function loadSettings(): AppSettings {
  const raw = localStorage.getItem(settingsStorageKey)
  if (!raw) return { ...defaultSettings }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return sanitizeSettings(parsed)
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const sanitized = sanitizeSettings(settings)
  localStorage.setItem(settingsStorageKey, JSON.stringify(sanitized))
  return sanitized
}

export function hasRequiredSub2apiSettings(settings: AppSettings): boolean {
  return settings.sub2apiBaseUrl.trim() !== '' && (hasAdminSettings(settings) || hasPersonalSettings(settings))
}

export function hasAdminSettings(settings: AppSettings): boolean {
  return settings.sub2apiBaseUrl.trim() !== '' && settings.adminApiKey.trim() !== ''
}

export function hasPersonalSettings(settings: AppSettings): boolean {
  return settings.personalFloatingEnabled && settings.sub2apiBaseUrl.trim() !== '' && settings.personalToken.trim() !== ''
}

function sanitizeSettings(settings: Partial<AppSettings>): AppSettings {
  const legacySettings = settings as Partial<AppSettings> & { poolGroupId?: unknown; poolGroupNames?: unknown }
  const refreshSeconds = Number(settings.refreshSeconds)
  const poolGroupNames = normalizePoolGroupNames(
    Array.isArray(legacySettings.poolGroupNames) ? legacySettings.poolGroupNames : settings.poolGroupName ?? legacySettings.poolGroupId
  )
  const statusBarMetrics = normalizeStatusBarMetrics(settings.statusBarMetrics)
  const statusBarUserId = normalizeStatusBarUserId(settings.statusBarUserId)
  return {
    sub2apiBaseUrl: String(settings.sub2apiBaseUrl ?? defaultSettings.sub2apiBaseUrl),
    adminApiKey: String(settings.adminApiKey ?? defaultSettings.adminApiKey),
    personalFloatingEnabled: settings.personalFloatingEnabled === true,
    personalToken: String(settings.personalToken ?? defaultSettings.personalToken),
    poolGroupName: poolGroupNames[0] ?? defaultSettings.poolGroupName,
    poolGroupNames,
    statusBarMetrics,
    statusBarUserId,
    refreshSeconds: Number.isFinite(refreshSeconds) ? clamp(Math.round(refreshSeconds), 10, 300) : 30
  }
}

function normalizeStatusBarMetrics(value: unknown): StatusBarMetricKey[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(statusBarMetricKeys)
  return Array.from(new Set(value.filter((item): item is StatusBarMetricKey => typeof item === 'string' && allowed.has(item))))
}

function normalizeStatusBarUserId(value: unknown): number | null {
  const userId = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null
}

function normalizePoolGroupNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  const names = values
    .map((item) => String(item ?? '').trim())
    .filter((item) => item !== '')
  return Array.from(new Set(names))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
