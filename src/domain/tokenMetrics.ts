export interface TokenOrbMetrics {
  todayTokens: number | null
  firstTokenMs: number | null
  updatedAt: string | null
}

export interface AdminMonitorMetrics {
  todayTotalTokens: number | null
  todayTotalCost: number | null
  totalTokens?: number | null
  totalActualCost?: number | null
  totalAccountCost?: number | null
  totalStandardCost?: number | null
  averageDurationMs?: number | null
  activeUsers?: number | null
  poolRemainingPercent: number | null
  poolLatestResetAt: string | null
  poolResetItems: PoolResetItem[]
  poolSevenDayRemainingPercent?: number | null
  poolSevenDayLatestResetAt?: string | null
  poolSevenDayResetItems?: PoolResetItem[]
  poolAccounts: PoolAccountSummary | null
  poolCapacity: PoolCapacitySummary | null
  poolAccountDetails: PoolAccountDetailItem[]
  userRanking: UserTodayUsageRankItem[]
  userIdentities?: UserIdentityItem[]
  updatedAt: string | null
}

export interface PoolAccountSummary {
  active: number
  limited: number
  error: number
  total: number
}

export interface PoolCapacitySummary {
  groupId: number | null
  concurrencyUsed: number
  concurrencyMax: number
}

export interface PoolAccountDisplay {
  active: string
  limited: string
  error: string
  total: string
}

export interface PoolResetItem {
  status: 'normal' | 'limited'
  resetAt: string
}

export type PoolAccountDetailStatus = 'normal' | 'limited' | 'error' | 'disabled'

export interface PoolAccountDetailItem {
  rank: number
  priority?: number | null
  name: string
  status: PoolAccountDetailStatus
  statusText: string
  schedulable: boolean
  scheduleText: string
  capacityText: string
  capacityUsed: number | null
  todayTokens: number | null
  sevenDayCost: number | null
  usageWindows: PoolAccountUsageWindow[]
}

interface PoolAccountDetailSortItem extends PoolAccountDetailItem {
  sourceIndex: number
  priority: number | null
}

export type PoolAccountUsageWindowType = '5h' | '7d'

export interface PoolAccountUsageWindow {
  type: PoolAccountUsageWindowType
  usedPercent: number
  resetAt: string | null
}

export interface PoolAccountTodayStats {
  tokens: number | null
}

export interface UserTodayUsageRankItem {
  rank: number
  userId: number | null
  name: string
  email: string
  displayName: string
  tokens: number
  actualCost: number | null
}

export interface UserModelUsageItem {
  model: string
  requests: number
  tokens: number
  actualCost: number | null
}

export interface ModelUsageRankItem {
  model: string
  requests: number
  tokens: number
  actualCost: number | null
}

export interface ModelUserUsageItem {
  userId: number | null
  displayName: string
  requests: number
  tokens: number
  actualCost: number | null
}

export interface UserIdentityItem {
  id: number
  email: string
  username: string
}

export interface AdminGroupIdentityItem {
  id: number
  name: string
  status: string
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function buildSub2apiHeaders(token: string): Record<string, string> {
  const trimmed = token.trim()
  const authorization = /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`
  return {
    Authorization: authorization,
    Accept: 'application/json'
  }
}

export function buildAdminApiKeyHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim()
  return {
    'X-API-Key': trimmed,
    Authorization: /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`,
    Accept: 'application/json'
  }
}

export function parseTodayTokens(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'today_tokens')
}

export function parseTodayActualCost(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'today_actual_cost')
}

export function parseTotalTokens(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'total_tokens')
}

export function parseTotalActualCost(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'total_actual_cost')
}

export function parseTotalAccountCost(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'total_account_cost')
}

export function parseTotalStandardCost(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'total_cost')
}

export function parseAverageDurationMs(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'average_duration_ms')
}

export function parseActiveUsers(payload: unknown): number | null {
  const record = unwrapData(payload)
  return readNumber(record, 'active_users')
}

export function parseLatestFirstTokenMs(payload: unknown): number | null {
  const record = unwrapData(payload)
  const items = Array.isArray(record?.items) ? record.items : []
  if (items.length === 0) return null
  return readNumber(items[0], 'first_token_ms')
}

export function parseUserRanking(payload: unknown, users: UserIdentityItem[] = []): UserTodayUsageRankItem[] {
  const record = unwrapData(payload)
  const ranking = Array.isArray(record?.ranking) ? record.ranking : []
  const userMap = new Map(users.map((user) => [user.id, user]))
  return ranking
    .map((item) => {
      const row = isRecord(item) ? item : {}
      const userId = readNumber(row, 'user_id')
      const user = userId === null ? undefined : userMap.get(userId)
      const email = user?.email || (typeof row.email === 'string' ? row.email : '')
      const username = user?.username || (typeof row.username === 'string' ? row.username : '')
      const name = username || '用户'
      return {
        rank: 0,
        userId,
        name,
        email,
        displayName: email ? `${name}（${email}）` : name,
        tokens: readFirstNumber(row, ['tokens', 'total_tokens', 'today_tokens']) ?? 0,
        actualCost: readFirstNumber(row, ['actual_cost', 'user_cost', 'cost'])
      }
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function parseUserModelUsage(payload: unknown): UserModelUsageItem[] {
  const record = unwrapData(payload)
  const models = Array.isArray(record?.models) ? record.models : []
  return models
    .map((item) => {
      const row = isRecord(item) ? item : {}
      const model = typeof row.model === 'string' ? row.model.trim() : ''
      if (!model) return null
      return {
        model,
        requests: readNumber(row, 'requests') ?? 0,
        tokens: readFirstNumber(row, ['total_tokens', 'tokens']) ?? 0,
        actualCost: readFirstNumber(row, ['actual_cost', 'user_cost', 'cost'])
      }
    })
    .filter((item): item is UserModelUsageItem => item !== null)
}

export function parseModelUsageRanking(payload: unknown): ModelUsageRankItem[] {
  return parseUserModelUsage(payload)
}

export function parseModelUserUsage(payload: unknown, userIdentities: UserIdentityItem[] = []): ModelUserUsageItem[] {
  const record = unwrapData(payload)
  const users = Array.isArray(record?.users) ? record.users : []
  const userMap = new Map(userIdentities.map((user) => [user.id, user]))
  return users
    .map((item) => {
      const row = isRecord(item) ? item : {}
      const userId = readNumber(row, 'user_id')
      const user = userId === null ? undefined : userMap.get(userId)
      const email = user?.email || (typeof row.email === 'string' ? row.email.trim() : '')
      const username = user?.username || (typeof row.username === 'string' ? row.username.trim() : '')
      return {
        userId,
        displayName: username ? (email ? `${username}（${email}）` : username) : (email || (userId === null ? '未知用户' : `用户 #${userId}`)),
        requests: readNumber(row, 'requests') ?? 0,
        tokens: readFirstNumber(row, ['total_tokens', 'tokens']) ?? 0,
        actualCost: readFirstNumber(row, ['actual_cost', 'user_cost', 'cost'])
      }
    })
    .filter((item) => item.displayName !== '')
}

export function parseUsers(payload: unknown): UserIdentityItem[] {
  return readItems(payload)
    .map((item) => {
      if (!isRecord(item)) return null
      const id = readNumber(item, 'id')
      if (id === null) return null
      return {
        id,
        email: typeof item.email === 'string' ? item.email : '',
        username: typeof item.username === 'string' ? item.username : ''
      }
    })
    .filter((item): item is UserIdentityItem => item !== null)
}

export function parseGroups(payload: unknown): AdminGroupIdentityItem[] {
  return readItems(payload)
    .map((item) => {
      if (!isRecord(item)) return null
      const id = readNumber(item, 'id')
      if (id === null) return null
      return {
        id,
        name: typeof item.name === 'string' ? item.name : '',
        status: typeof item.status === 'string' ? item.status : ''
      }
    })
    .filter((item): item is AdminGroupIdentityItem => item !== null)
}

type PoolGroupIdSelector = string | number | readonly (string | number)[] | null

export function findPoolCapacitySummary(payload: unknown, groupId: PoolGroupIdSelector): PoolCapacitySummary | null {
  const wantedGroupIds = normalizeGroupIds(groupId)
  if (wantedGroupIds.length === 0) return null
  const selectedGroupIds = new Set(wantedGroupIds)
  const summaries: PoolCapacitySummary[] = []

  for (const item of readItems(payload)) {
    if (!isRecord(item)) continue
    const capacityGroupId = readNumber(item, 'group_id')
    if (capacityGroupId === null || !selectedGroupIds.has(String(capacityGroupId))) continue

    summaries.push({
      groupId: capacityGroupId,
      concurrencyUsed: readNumber(item, 'concurrency_used') ?? 0,
      concurrencyMax: readNumber(item, 'concurrency_max') ?? 0
    })
  }

  if (summaries.length === 0) return null
  if (summaries.length === 1) return summaries[0]
  return {
    groupId: null,
    concurrencyUsed: summaries.reduce((sum, item) => sum + item.concurrencyUsed, 0),
    concurrencyMax: summaries.reduce((sum, item) => sum + item.concurrencyMax, 0)
  }
}

export function findExactGroupIdByName(groups: AdminGroupIdentityItem[], groupName: string): number | null {
  const wantedGroupName = groupName.trim()
  if (!wantedGroupName) return null
  const matched = groups.find((group) => group.name.trim() === wantedGroupName && groupIsActive(group))
  return matched?.id ?? null
}

export function findExactGroupIdsByNames(groups: AdminGroupIdentityItem[], groupNames: readonly string[]): number[] {
  const groupIds = groupNames
    .map((groupName) => findExactGroupIdByName(groups, groupName))
    .filter((groupId): groupId is number => groupId !== null)
  return Array.from(new Set(groupIds))
}

export function calculatePoolRemainingPercent(
  accounts: unknown[],
  groupId: PoolGroupIdSelector = null,
  now = new Date(),
  windowType: PoolAccountUsageWindowType = '5h'
): number | null {
  const wantedGroupIds = normalizeGroupIds(groupId)
  const percents = accounts
    .filter((item) => accountMatchesGroupId(item, wantedGroupIds))
    .filter((item) => accountCountsInPool(item, now))
    .map((item) => {
      if (!isRecord(item)) return null
      const extra = isRecord(item.extra) ? item.extra : item
      const used = readUsageUsedPercent(extra, windowType, now)
      return used === null ? null : Math.max(0, 100 - used)
    })
    .filter((value): value is number => value !== null)

  if (percents.length === 0) return null
  return percents.reduce((sum, value) => sum + value, 0) / percents.length
}

export function countPoolAccounts(accounts: unknown[], groupId: PoolGroupIdSelector = null): PoolAccountSummary {
  const wantedGroupIds = normalizeGroupIds(groupId)
  return accounts
    .filter((item) => accountMatchesGroupId(item, wantedGroupIds))
    .reduce<PoolAccountSummary>((summary, item) => {
      if (!isRecord(item)) return summary
      summary.total += 1
      if (accountIsErrored(item)) {
        summary.error += 1
      } else if (accountIsLimited(item)) {
        summary.limited += 1
      } else if (accountIsActive(item)) {
        summary.active += 1
      }
      return summary
    }, { active: 0, limited: 0, error: 0, total: 0 })
}

export function findLatestPoolResetAt(
  accounts: unknown[],
  groupId: PoolGroupIdSelector = null,
  now = new Date(),
  windowType: PoolAccountUsageWindowType = '5h'
): string | null {
  return findNearestPoolResetAt(accounts, groupId, now, windowType)
}

export function findNearestPoolResetAt(
  accounts: unknown[],
  groupId: PoolGroupIdSelector = null,
  now = new Date(),
  windowType: PoolAccountUsageWindowType = '5h'
): string | null {
  const resetTimes = listPoolResetItems(accounts, groupId, now, windowType).map((item) => Date.parse(item.resetAt))

  if (resetTimes.length === 0) return null
  return new Date(Math.min(...resetTimes)).toISOString()
}

export function listPoolResetItems(
  accounts: unknown[],
  groupId: PoolGroupIdSelector = null,
  now = new Date(),
  windowType: PoolAccountUsageWindowType = '5h'
): PoolResetItem[] {
  const wantedGroupIds = normalizeGroupIds(groupId)
  return accounts
    .filter((item) => accountMatchesGroupId(item, wantedGroupIds))
    .filter((item) => accountCountsInPool(item, now))
    .map((item) => {
      if (!isRecord(item)) return null
      const extra = isRecord(item.extra) ? item.extra : item
      const resetAt = readUsageResetAt(extra, windowType)
      if (resetAt === null || resetAt <= now.getTime()) return null
      return {
        status: accountIsLimited(item, now) ? 'limited' : 'normal',
        resetAt: new Date(resetAt).toISOString()
      }
    })
    .filter((item): item is PoolResetItem => item !== null)
    .sort((a, b) => Date.parse(a.resetAt) - Date.parse(b.resetAt))
}

export function listPoolAccountDetails(
  accounts: unknown[],
  groupId: PoolGroupIdSelector = null,
  now = new Date(),
  todayStatsByAccountId: Record<string, PoolAccountTodayStats> = {},
  sevenDayCostByAccountId: Record<string, number | null> = {}
): PoolAccountDetailItem[] {
  const wantedGroupIds = normalizeGroupIds(groupId)
  return accounts
    .filter((item) => accountMatchesGroupId(item, wantedGroupIds))
    .map((item, sourceIndex): PoolAccountDetailSortItem | null => {
      if (!isRecord(item)) return null
      const extra = isRecord(item.extra) ? item.extra : null
      const status = getAccountDetailStatus(item, now)
      const accountId = readAccountIdString(item)
      const todayStats = todayStatsByAccountId[accountId] ?? null
      return {
        sourceIndex,
        rank: 0,
        priority: readNumber(item, 'priority'),
        name: formatAccountDetailName(item),
        status,
        statusText: formatAccountStatusText(status),
        schedulable: item.schedulable !== false,
        scheduleText: item.schedulable === false ? '已关闭' : '调度中',
        capacityText: formatAccountCapacity(item),
        capacityUsed: readAccountCapacityUsed(item),
        todayTokens: readAccountTodayTokens(item, extra, todayStats),
        sevenDayCost: sevenDayCostByAccountId[accountId] ?? null,
        usageWindows: listAccountUsageWindows(extra, now)
      }
    })
    .filter((item): item is PoolAccountDetailSortItem => item !== null)
    .sort((a, b) => {
      const leftPriority = a.priority ?? Number.POSITIVE_INFINITY
      const rightPriority = b.priority ?? Number.POSITIVE_INFINITY
      if (leftPriority !== rightPriority) return leftPriority - rightPriority

      const leftCapacity = a.capacityUsed ?? Number.NEGATIVE_INFINITY
      const rightCapacity = b.capacityUsed ?? Number.NEGATIVE_INFINITY
      if (leftCapacity !== rightCapacity) return rightCapacity - leftCapacity

      return a.sourceIndex - b.sourceIndex
    })
    .map(({ sourceIndex: _sourceIndex, ...item }, index) => ({ ...item, rank: index + 1 }))
}

export function formatTokenCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toFixed(2)
}

export function formatCost(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

export function formatFixedCost(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `$${value.toFixed(2)}`
}

export function formatFirstToken(valueMs: number | null): string {
  if (valueMs === null || Number.isNaN(valueMs)) return '--'
  return `${(valueMs / 1000).toFixed(2)}s`
}

export function formatPoolCapacity(value: PoolCapacitySummary | null): string {
  if (!value) return '--'
  return `${value.concurrencyUsed} / ${value.concurrencyMax}`
}

export function formatPoolAccountCount(value: PoolAccountSummary | null): PoolAccountDisplay {
  if (!value) return { active: '--', limited: '--', error: '--', total: '--' }
  return {
    active: String(value.active),
    limited: String(value.limited),
    error: String(value.error),
    total: String(value.total)
  }
}

function unwrapData(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  if (isRecord(payload.data)) return payload.data
  return payload
}

export function readItems(payload: unknown): unknown[] {
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.data)) return payload.data
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.items)) return payload.data.items
    if (Array.isArray(payload.data.data)) return payload.data.data
  }
  return []
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readFirstNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  for (const key of keys) {
    const value = readNumber(record, key)
    if (value !== null) return value
  }
  return null
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readUsageUsedPercent(extra: Record<string, unknown>, type: PoolAccountUsageWindowType, now: Date): number | null {
  const used = readNumber(extra, `codex_${type}_used_percent`)
  if (used === null) return null
  if (isExpiredUsageWindow(extra, type, now)) return 0
  return Math.min(100, Math.max(0, used))
}

function readUsageResetAt(extra: Record<string, unknown>, type: PoolAccountUsageWindowType): number | null {
  const resetAtRaw = extra[`codex_${type}_reset_at`]
  if (typeof resetAtRaw === 'string' && resetAtRaw.trim() !== '') {
    const resetAt = Date.parse(resetAtRaw)
    if (Number.isFinite(resetAt)) return resetAt
  }

  const resetAfterSeconds = readNumber(extra, `codex_${type}_reset_after_seconds`)
  const updatedAtRaw = extra.codex_usage_updated_at
  if (resetAfterSeconds === null || typeof updatedAtRaw !== 'string' || updatedAtRaw.trim() === '') return null

  const updatedAt = Date.parse(updatedAtRaw)
  if (!Number.isFinite(updatedAt)) return null
  return updatedAt + resetAfterSeconds * 1000
}

function isExpiredUsageWindow(extra: Record<string, unknown>, type: PoolAccountUsageWindowType, now: Date): boolean {
  const resetAtRaw = extra[`codex_${type}_reset_at`]
  if (typeof resetAtRaw === 'string' && resetAtRaw.trim() !== '') {
    const resetAt = Date.parse(resetAtRaw)
    return Number.isFinite(resetAt) && now.getTime() >= resetAt
  }

  const resetAfterSeconds = readNumber(extra, `codex_${type}_reset_after_seconds`)
  if (resetAfterSeconds === null) return false
  if (resetAfterSeconds <= 0) return true

  const updatedAtRaw = extra.codex_usage_updated_at
  if (typeof updatedAtRaw !== 'string' || updatedAtRaw.trim() === '') return false
  const updatedAt = Date.parse(updatedAtRaw)
  if (!Number.isFinite(updatedAt)) return false
  return now.getTime() >= updatedAt + resetAfterSeconds * 1000
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function groupIsActive(item: unknown): boolean {
  if (!isRecord(item)) return false
  const status = String(item.status ?? '').trim().toLowerCase()
  return status === '' || status === 'active'
}

function accountCountsInPool(item: unknown, now: Date): boolean {
  return !accountIsErrored(item) && (accountIsActive(item, now) || accountIsLimited(item, now))
}

function accountIsActive(item: unknown, now = new Date()): boolean {
  if (!isRecord(item)) return false
  const status = String(item.status ?? '').trim().toLowerCase()
  if (status !== 'active') return false
  if (item.schedulable === false) return false
  if (accountIsErrored(item) || accountIsLimited(item, now)) return false
  return true
}

function accountIsLimited(item: unknown, now = new Date()): boolean {
  if (!isRecord(item)) return false
  const status = String(item.status ?? '').trim().toLowerCase()
  if (['ratelimit', 'rate_limited', 'rate-limited', 'limited', 'overload', 'overloaded'].includes(status)) return true
  if (isFutureTimestamp(item.rate_limit_reset_at, now)) return true
  if (isFutureTimestamp(item.overload_until, now)) return true
  if (isFutureTimestamp(item.temp_unschedulable_until, now)) return true
  // 模型级限流只影响对应模型，不代表账号整体不可调度。
  return false
}

function accountIsErrored(item: unknown): boolean {
  if (!isRecord(item)) return false
  const status = String(item.status ?? '').trim().toLowerCase()
  return status === 'error' || hasNonEmptyString(item.error_message) || hasNonEmptyString(item.errorMessage)
}

function getAccountDetailStatus(item: Record<string, unknown>, now: Date): PoolAccountDetailStatus {
  const status = String(item.status ?? '').trim().toLowerCase()
  if (accountIsErrored(item)) return 'error'
  if (accountIsLimited(item, now)) return 'limited'
  if (accountIsActive(item, now)) return 'normal'
  if (status === 'active' && item.schedulable === false) return 'disabled'
  return 'disabled'
}

function formatAccountStatusText(status: PoolAccountDetailStatus): string {
  if (status === 'normal') return '正常'
  if (status === 'limited') return '限流中'
  if (status === 'error') return '错误'
  return '停用'
}

function formatAccountDetailName(item: Record<string, unknown>): string {
  const displayName = readFirstString(item, ['name', 'username'])
  const email = readFirstString(item, ['email', 'account'])
  if (displayName && email && displayName !== email) return `${displayName}（${email}）`
  if (displayName) return displayName
  if (email) return email
  const id = readFirstString(item, ['id', 'account_id', 'accountId', 'token_id', 'tokenId'])
  return id ? `账号 ${id}` : '账号'
}

function formatAccountCapacity(item: Record<string, unknown>): string {
  const max = readFirstNumber(item, ['concurrency', 'capacity', 'max_concurrency', 'maxConcurrency'])
  if (max === null) return '--'
  const current = readAccountCapacityUsed(item) ?? 0
  return `${Math.max(0, Math.round(current))} / ${Math.max(0, Math.round(max))}`
}

function readAccountCapacityUsed(item: Record<string, unknown>): number | null {
  return readFirstNumber(item, ['current_concurrency', 'currentConcurrency', 'used_concurrency', 'usedConcurrency'])
}

function readAccountTodayTokens(
  item: Record<string, unknown>,
  extra: Record<string, unknown> | null,
  todayStats: PoolAccountTodayStats | null
): number | null {
  return todayStats?.tokens
    ?? readFirstNumber(item, ['today_tokens', 'todayTokens', 'tokens', 'total_tokens', 'daily_tokens'])
    ?? readFirstNumber(extra, ['today_tokens', 'todayTokens', 'tokens', 'total_tokens', 'daily_tokens'])
}

function readAccountIdString(item: Record<string, unknown>): string {
  return readFirstString(item, ['id', 'account_id', 'accountId', 'token_id', 'tokenId'])
}

function listAccountUsageWindows(extra: Record<string, unknown> | null, now: Date): PoolAccountUsageWindow[] {
  if (!extra) return []
  return (['5h', '7d'] as const)
    .map((type) => {
      const usedPercent = readUsageUsedPercent(extra, type, now)
      if (usedPercent === null) return null
      const resetAt = readUsageResetAt(extra, type)
      return {
        type,
        usedPercent,
        resetAt: resetAt === null || resetAt <= now.getTime() ? null : new Date(resetAt).toISOString()
      }
    })
    .filter((item): item is PoolAccountUsageWindow => item !== null)
}

function normalizeGroupIds(groupId: PoolGroupIdSelector): string[] {
  const values = Array.isArray(groupId) ? groupId : [groupId]
  const ids = values.map((value) => String(value ?? '').trim()).filter((value) => value !== '')
  return Array.from(new Set(ids))
}

function accountMatchesGroupId(item: unknown, groupIds: string[]): boolean {
  if (groupIds.length === 0) return true
  if (!isRecord(item)) return false
  const candidates = [item.group_id, item.groupId, item.group]
  if (candidates.some((value) => groupIds.includes(String(value ?? '')))) return true
  return [item.group_ids, item.groupIds, item.groups, item.account_groups, item.accountGroups].some((value) =>
    valueContainsGroupId(value, groupIds)
  )
}

function valueContainsGroupId(value: unknown, groupIds: string[]): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    if (groupIds.includes(String(item ?? ''))) return true
    if (!isRecord(item)) return false
    return [item.id, item.group_id, item.groupId].some((candidate) => groupIds.includes(String(candidate ?? '')))
  })
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function isFutureTimestamp(value: unknown, now: Date): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > now.getTime()
}
