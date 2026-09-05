export type TpsWindowMinutes = 5 | 1440
export type TpsMetricState = 'loading' | 'ready' | 'empty' | 'error' | 'incomplete'

/** A usage row containing enough timing and token data for a text TPS calculation. */
export interface UsageTpsRecord {
  id: string | number
  created_at: string | number
  status_code?: number | string | null
  status?: number | string | null
  output_tokens?: number | string | null
  duration_ms?: number | string | null
  first_token_ms?: number | string | null
  image_count?: number | string | null
  endpoint?: string | null
  endpoint_path?: string | null
  path?: string | null
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
}

export interface TpsMetricOptions {
  windowMinutes?: TpsWindowMinutes
  now?: Date | string | number
  incomplete?: boolean
  error?: unknown
}

export interface TpsWindowCache {
  key: string
  initialized: boolean
  complete: boolean
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
}

export function createTpsWindowCache(): TpsWindowCache {
  return { key: '', initialized: false, complete: false, records: [] }
}

export function resetTpsWindowCache(cache: TpsWindowCache, key = ''): void {
  cache.key = key
  cache.initialized = false
  cache.complete = false
  cache.records = []
}

export async function loadTpsMetricWindow(options: LoadTpsWindowOptions): Promise<TpsMetric> {
  const now = options.now ?? new Date()
  const cutoff = now.getTime() - options.windowMinutes * 60_000
  const pageSize = options.pageSize ?? 200
  const maxRecords = options.maxRecords ?? 10_000
  const maxPages = Math.ceil(maxRecords / pageSize)
  if (options.cache.key !== options.cacheKey) resetTpsWindowCache(options.cache, options.cacheKey)

  const knownIds = new Set(options.cache.complete ? options.cache.records.map((record) => String(record.id)) : [])
  const fetched: UsageTpsRecord[] = []
  let complete = false

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await options.fetchPage({
      page,
      pageSize,
      startDate: formatLocalDateForQuery(new Date(cutoff)),
      endDate: formatLocalDateForQuery(now),
      timezone: options.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'),
      userId: options.userId
    })
    const records = normalizeUsageTpsRecords(response.items)
    fetched.push(...records)
    const reachedKnownRecord = options.cache.initialized
      && options.cache.complete
      && records.some((record) => knownIds.has(String(record.id)))
    const reachedWindowBoundary = records.some((record) => {
      const timestamp = toTimestamp(record.created_at)
      return timestamp !== null && timestamp < cutoff
    })
    const reachedEnd = response.items.length === 0
      || (response.total !== null && response.total >= 0
        ? countUniqueTpsRecords(fetched) >= response.total
        : response.items.length < pageSize)
    if (reachedKnownRecord || reachedWindowBoundary || reachedEnd) {
      complete = true
      break
    }
  }

  const cachedRecords = options.cache.key === options.cacheKey ? options.cache.records : []
  const mergedRecords = dedupeTpsRecords([...fetched, ...cachedRecords])
    .filter((record) => {
      const timestamp = toTimestamp(record.created_at)
      return timestamp !== null && timestamp >= cutoff
    })
  if (options.cache.key === options.cacheKey) {
    options.cache.records = mergedRecords
    options.cache.initialized = true
    options.cache.complete = complete
  }
  return calculateTpsMetric(mergedRecords, { windowMinutes: options.windowMinutes, now, incomplete: !complete })
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
export function calculateTpsMetric(
  records: readonly UsageTpsRecord[],
  options: TpsMetricOptions = {}
): TpsMetric {
  const windowMinutes = options.windowMinutes ?? 5
  if (options.error !== undefined && options.error !== null) return errorTpsMetric(options.error, windowMinutes)

  const now = toTimestamp(options.now ?? new Date())
  if (now === null) return errorTpsMetric('Invalid reference time', windowMinutes)
  const lowerBound = now - windowMinutes * 60_000
  const seen = new Set<string>()
  const valid = records.filter((record) => {
    const createdAt = toTimestamp(record.created_at)
    if (createdAt === null || createdAt < lowerBound || createdAt > now || !isSuccessfulTextRecord(record)) return false
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

export function isSuccessfulTextRecord(record: UsageTpsRecord): boolean {
  const status = numberValue(record.status_code ?? record.status)
  const outputTokens = numberValue(record.output_tokens)
  const durationMs = numberValue(record.duration_ms)
  const firstTokenMs = numberValue(record.first_token_ms)
  if (!Number.isFinite(status) || !Number.isFinite(outputTokens) || !Number.isFinite(durationMs) || !Number.isFinite(firstTokenMs)) return false
  if (status < 200 || status >= 300 || outputTokens <= 0 || durationMs <= firstTokenMs) return false
  if (numberValue(record.image_count) > 0) return false

  const endpoint = String(record.endpoint ?? record.endpoint_path ?? record.path ?? '').toLowerCase()
  if (/(^|\/)images?(\/|$)|(^|\/)image-generation(\/|$)/.test(endpoint)) return false
  const type = `${record.content_type ?? ''} ${record.response_content_type ?? ''} ${record.type ?? ''}`.toLowerCase()
  return !/(^|[\s;,])image\//.test(type) && !/\b(image|audio|video)\b/.test(type) && !/application\/(octet-stream|pdf)/.test(type)
}

function emptyMetric(state: TpsMetricState, windowMinutes: TpsWindowMinutes): TpsMetric {
  return { state, windowMinutes, value: null, sampleCount: 0, outputTokens: 0, generationMs: 0, updatedAt: null }
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
