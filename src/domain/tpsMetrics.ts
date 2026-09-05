export type TpsWindowMinutes = 5 | 1440
export type TpsMetricState = 'loading' | 'ready' | 'empty' | 'error' | 'incomplete'
export const TPS_SCHEMA_INCOMPATIBLE_CODE = 'TPS_SCHEMA_INCOMPATIBLE'
export const TPS_SCHEMA_INCOMPATIBLE_MESSAGE = '数据格式不兼容'

/** A usage row containing enough timing and token data for a text TPS calculation. */
export interface UsageTpsRecord {
  id: string | number
  created_at: string | number
  status_code?: number | string | null
  status?: number | string | null
  user_id?: number | string | null
  request_type?: string | null
  billing_mode?: string | null
  media_type?: string | null
  output_tokens?: number | string | null
  duration_ms?: number | string | null
  first_token_ms?: number | string | null
  image_count?: number | string | null
  video_count?: number | string | null
  endpoint?: string | null
  endpoint_path?: string | null
  path?: string | null
  inbound_endpoint?: string | null
  upstream_endpoint?: string | null
  content_type?: string | null
  response_content_type?: string | null
  type?: string | null
}

export interface TpsMetric {
  state: TpsMetricState
  windowMinutes: TpsWindowMinutes
  value: number | null
  sampleCount: number
  outputTokens: number
  generationMs: number
  updatedAt: string | null
  error?: string
  errorCode?: string
  sampleLimit?: 5
}

export interface TpsMetricOptions {
  windowMinutes?: TpsWindowMinutes
  now?: Date | string | number
  incomplete?: boolean
  error?: unknown
  userId?: number | string | null
  startAt?: Date
  endExclusive?: boolean
}

export interface TpsWindowCache {
  key: string
  initialized: boolean
  complete: boolean
  capped?: boolean
  records: UsageTpsRecord[]
}

export interface TpsUsagePageQuery {
  page: number
  pageSize: number
  startDate: string
  endDate: string
  timezone: string
  userId?: number
}

export interface TpsUsagePage {
  items: unknown[]
  total: number | null
}

export interface LoadTpsWindowOptions {
  windowMinutes: TpsWindowMinutes
  cache: TpsWindowCache
  cacheKey: string
  fetchPage: (query: TpsUsagePageQuery) => Promise<TpsUsagePage>
  userId?: number
  now?: Date
  timezone?: string
  pageSize?: number
  maxRecords?: number
  pageDelayMs?: number
  shouldContinue?: () => boolean
  sleep?: (milliseconds: number) => Promise<void>
  startAt?: Date
  endExclusive?: boolean
}

export function yesterdayTpsPeriod(now = new Date()): { start: Date; end: Date; date: string } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - 1)
  return { start, end, date: formatLocalDateForQuery(start) }
}

export function calculateRecentTpsMetric(records: readonly UsageTpsRecord[], userId: number, now = new Date(), incomplete = false): TpsMetric {
  const ordered = dedupeTpsRecords(records).filter((record) => String(record.user_id) === String(userId))
    .sort((left, right) => (toTimestamp(right.created_at) ?? 0) - (toTimestamp(left.created_at) ?? 0))
  const valid = ordered.filter((record) => isSuccessfulTextRecord(record) && (toTimestamp(record.created_at) ?? Infinity) <= now.getTime()).slice(0, 5)
  return {
    ...calculateTpsMetric(valid.length ? valid : ordered, { now, startAt: new Date(0), userId, incomplete }),
    sampleLimit: 5
  }
}

export async function loadRecentTpsMetric(options: LoadTpsWindowOptions & { userId: number }): Promise<TpsMetric> {
  const now = options.now ?? new Date()
  const rows: UsageTpsRecord[] = []
  const pageSize = 200
  const maxPages = Math.ceil((options.maxRecords ?? 10_000) / pageSize)
  let complete = false
  for (let page = 1; page <= maxPages; page += 1) {
    if (options.shouldContinue?.() === false) break
    if (page > 1) await (options.sleep ?? sleep)(options.pageDelayMs ?? 150)
    if (options.shouldContinue?.() === false) break
    const response = await options.fetchPage({ page, pageSize, startDate: '', endDate: '', timezone: options.timezone ?? 'Asia/Shanghai', userId: options.userId })
    rows.push(...normalizeUsageTpsRecords(response.items))
    if (calculateRecentTpsMetric(rows, options.userId, now).sampleCount >= 5
      || response.items.length === 0
      || (response.total !== null ? countUniqueTpsRecords(rows) >= response.total : response.items.length < pageSize)) {
      complete = true
      break
    }
  }
  options.cache.key = options.cacheKey
  options.cache.initialized = true
  options.cache.complete = complete
  options.cache.capped = !complete && rows.length >= (options.maxRecords ?? 10_000)
  options.cache.records = rows
  return calculateRecentTpsMetric(rows, options.userId, now, !complete)
}

export function createTpsWindowCache(): TpsWindowCache {
  return { key: '', initialized: false, complete: false, records: [] }
}

export function resetTpsWindowCache(cache: TpsWindowCache, key = ''): void {
  cache.key = key
  cache.initialized = false
  cache.complete = false
  cache.capped = false
  cache.records = []
}

export async function loadTpsMetricWindow(options: LoadTpsWindowOptions): Promise<TpsMetric> {
  const now = options.now ?? new Date()
  const cutoff = options.startAt?.getTime() ?? now.getTime() - options.windowMinutes * 60_000
  const pageSize = options.pageSize ?? 200
  const maxRecords = options.maxRecords ?? 10_000
  const maxPages = Math.ceil(maxRecords / pageSize)
  if (options.cache.key !== options.cacheKey) resetTpsWindowCache(options.cache, options.cacheKey)

  const knownIds = new Set(options.cache.complete || options.cache.capped
    ? options.cache.records.map((record) => String(record.id)) : [])
  const fetched: UsageTpsRecord[] = []
  let complete = false
  let capped = false

  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1) {
      if (options.shouldContinue?.() === false) break
      const delayMs = options.pageDelayMs ?? 0
      if (delayMs > 0) await (options.sleep ?? sleep)(delayMs)
      if (options.shouldContinue?.() === false) break
    }
    const response = await options.fetchPage({
      page,
      pageSize,
      startDate: formatLocalDateForQuery(new Date(cutoff)),
      endDate: formatLocalDateForQuery(options.endExclusive ? new Date(now.getTime() - 1) : now),
      timezone: options.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'),
      userId: options.userId
    })
    const records = normalizeUsageTpsRecords(response.items)
    fetched.push(...records)
    const reachedKnownRecord = options.cache.initialized
      && records.some((record) => knownIds.has(String(record.id)))
    const reachedWindowBoundary = records.some((record) => {
      const timestamp = toTimestamp(record.created_at)
      return timestamp !== null && timestamp < cutoff
    })
    const reachedEnd = response.items.length === 0
      || (response.total !== null && response.total >= 0
        ? countUniqueTpsRecords(fetched) >= response.total
        : response.items.length < pageSize)
    if (reachedWindowBoundary || reachedEnd) {
      complete = true
      break
    }
    if (reachedKnownRecord) {
      complete = options.cache.complete || options.cache.records.some((record) => {
        const timestamp = toTimestamp(record.created_at)
        return timestamp !== null && timestamp <= cutoff
      })
      capped = options.cache.capped === true
      break
    }
    if (page === maxPages) capped = true
  }

  const cachedRecords = options.cache.key === options.cacheKey ? options.cache.records : []
  const mergedRecords = dedupeTpsRecords([...fetched, ...cachedRecords])
    .filter((record) => {
      const timestamp = toTimestamp(record.created_at)
      return timestamp !== null && timestamp >= cutoff
    })
  if (mergedRecords.length > maxRecords) {
    complete = false
    capped = true
  }
  mergedRecords.splice(maxRecords)
  if (options.cache.key === options.cacheKey) {
    options.cache.records = mergedRecords
    options.cache.initialized = true
    options.cache.complete = complete
    options.cache.capped = !complete && capped
  }
  return calculateTpsMetric(mergedRecords, {
    windowMinutes: options.windowMinutes,
    now,
    incomplete: !complete,
    userId: options.userId,
    startAt: options.startAt,
    endExclusive: options.endExclusive
  })
}

export function createTpsMetric(windowMinutes: TpsWindowMinutes = 5, state: TpsMetricState = 'empty'): TpsMetric {
  return emptyMetric(state, windowMinutes)
}

export function loadingTpsMetric(windowMinutes: TpsWindowMinutes = 5): TpsMetric {
  return emptyMetric('loading', windowMinutes)
}

export function errorTpsMetric(error: unknown, windowMinutes: TpsWindowMinutes = 5): TpsMetric {
  return { ...emptyMetric('error', windowMinutes), error: error instanceof Error ? error.message : String(error) }
}

export function emptyTpsMetric(windowMinutes: TpsWindowMinutes = 5): TpsMetric {
  return emptyMetric('empty', windowMinutes)
}

/** Calculate output tokens per second from successful, textual usage records. */
export function calculateTpsMetric(records: readonly UsageTpsRecord[], options?: TpsMetricOptions): TpsMetric
export function calculateTpsMetric(records: readonly UsageTpsRecord[], windowMinutes?: TpsWindowMinutes, now?: Date | string | number, incomplete?: boolean): TpsMetric
export function calculateTpsMetric(
  records: readonly UsageTpsRecord[],
  optionsOrWindow: TpsMetricOptions | TpsWindowMinutes = {},
  positionalNow?: Date | string | number,
  positionalIncomplete = false
): TpsMetric {
  const options: TpsMetricOptions = typeof optionsOrWindow === 'number'
    ? { windowMinutes: optionsOrWindow, now: positionalNow, incomplete: positionalIncomplete }
    : optionsOrWindow
  const windowMinutes = options.windowMinutes ?? 5
  if (options.error !== undefined && options.error !== null) return errorTpsMetric(options.error, windowMinutes)

  const now = toTimestamp(options.now ?? new Date())
  if (now === null) return errorTpsMetric('Invalid reference time', windowMinutes)
  const lowerBound = options.startAt?.getTime() ?? now - windowMinutes * 60_000
  const windowRecords = records.filter((record) => {
    const createdAt = toTimestamp(record.created_at)
    if (createdAt === null || createdAt < lowerBound || createdAt > now || (options.endExclusive && createdAt === now)) return false
    if (options.userId === undefined || options.userId === null) return true
    return String(record.user_id) === String(options.userId)
  })
  if (windowRecords.length > 0 && windowRecords.every((record) => !hasTpsFields(record))) {
    return {
      ...emptyMetric('error', windowMinutes),
      error: TPS_SCHEMA_INCOMPATIBLE_MESSAGE,
      errorCode: TPS_SCHEMA_INCOMPATIBLE_CODE,
      updatedAt: new Date(now).toISOString()
    }
  }
  const seen = new Set<string>()
  const valid = windowRecords.filter((record) => {
    const createdAt = toTimestamp(record.created_at)
    if (createdAt === null || !isSuccessfulTextRecord(record)) return false
    const key = String(record.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const outputTokens = valid.reduce((sum, record) => sum + numberValue(record.output_tokens), 0)
  const generationMs = valid.reduce(
    (sum, record) => sum + numberValue(record.duration_ms) - numberValue(record.first_token_ms),
    0
  )
  const state: TpsMetricState = options.incomplete ? 'incomplete' : valid.length === 0 ? 'empty' : 'ready'
  const value = state === 'ready' && generationMs > 0 ? outputTokens / (generationMs / 1000) : null
  return {
    state,
    windowMinutes,
    value,
    sampleCount: valid.length,
    outputTokens,
    generationMs,
    updatedAt: new Date(now).toISOString()
  }
}

export const deriveTpsMetric = calculateTpsMetric
export const computeTpsMetric = calculateTpsMetric

export function filterTpsRecordsByUser(records: readonly UsageTpsRecord[], userId: number | string): UsageTpsRecord[] {
  return records.filter((record) => String(record.user_id) === String(userId))
}

export function isSuccessfulTextRecord(record: UsageTpsRecord): boolean {
  const status = numberValue(record.status_code ?? record.status)
  const outputTokens = numberValue(record.output_tokens)
  const durationMs = numberValue(record.duration_ms)
  const firstTokenMs = numberValue(record.first_token_ms)
  if (!Number.isFinite(outputTokens) || !Number.isFinite(durationMs) || !Number.isFinite(firstTokenMs)) return false
  if ((record.status_code !== undefined && record.status_code !== null) || (record.status !== undefined && record.status !== null)) {
    if (!Number.isFinite(status) || status < 200 || status >= 300) return false
  }
  if (outputTokens <= 0 || durationMs <= firstTokenMs) return false
  if (numberValue(record.image_count) > 0) return false
  if (numberValue(record.video_count) > 0) return false
  if (record.billing_mode && String(record.billing_mode).toLowerCase() !== 'token') return false
  const requestType = record.request_type?.toLowerCase() ?? 'unknown'
  if (requestType !== 'sync' && requestType !== 'stream' && requestType !== 'ws_v2' && requestType !== 'unknown') return false
  const mediaType = record.media_type?.toLowerCase() ?? ''
  if (/\b(image|video|audio)\b|^(image|video|audio)\//.test(mediaType)) return false

  const endpoint = `${record.endpoint ?? ''} ${record.endpoint_path ?? ''} ${record.path ?? ''} ${record.inbound_endpoint ?? ''} ${record.upstream_endpoint ?? ''}`.toLowerCase()
  if (/(^|\/)(images?|image-generation|audio|videos?|realtime|cyber)(\/|\s|$)/.test(endpoint)) return false
  const type = `${record.content_type ?? ''} ${record.response_content_type ?? ''} ${record.type ?? ''}`.toLowerCase()
  return !/(^|[\s;,])image\//.test(type) && !/\b(image|audio|video)\b/.test(type) && !/application\/(octet-stream|pdf)/.test(type)
}

function emptyMetric(state: TpsMetricState, windowMinutes: TpsWindowMinutes): TpsMetric {
  return { state, windowMinutes, value: null, sampleCount: 0, outputTokens: 0, generationMs: 0, updatedAt: null }
}

function hasTpsFields(record: UsageTpsRecord): boolean {
  return Number.isFinite(numberValue(record.output_tokens))
    && Number.isFinite(numberValue(record.duration_ms))
    && Number.isFinite(numberValue(record.first_token_ms))
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

export function normalizeUsageTpsRecords(items: readonly unknown[]): UsageTpsRecord[] {
  return items.filter((item): item is UsageTpsRecord => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return record.id !== undefined && record.id !== null && record.created_at !== undefined && record.created_at !== null
  })
}

function dedupeTpsRecords(records: readonly UsageTpsRecord[]): UsageTpsRecord[] {
  const seen = new Set<string>()
  return records.filter((record) => {
    const key = String(record.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function countUniqueTpsRecords(records: readonly UsageTpsRecord[]): number {
  return new Set(records.map((record) => String(record.id))).size
}

function formatLocalDateForQuery(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(number) ? number : NaN
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value
  if (typeof value !== 'string' || value.trim() === '') return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
