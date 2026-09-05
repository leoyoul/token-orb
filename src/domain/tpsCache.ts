import type { UsageTpsRecord } from './tpsMetrics'

export const tpsCacheStorageKey = 'token-orb-tps-cache-v2'
export const TPS_CACHE_MAX_RECORDS = 10_000

export type TpsCacheRecord = Pick<UsageTpsRecord,
  | 'id'
  | 'user_id'
  | 'created_at'
  | 'output_tokens'
  | 'duration_ms'
  | 'first_token_ms'
>

export interface TpsCacheBucket {
  records: TpsCacheRecord[]
  lastIncrementalAt: string | null
  lastCompleteAt: string | null
  capped?: boolean
  periodDate?: string
}

export interface TpsCache {
  personal: TpsCacheBucket
  global: TpsCacheBucket
}

export interface TpsCacheContext {
  configFingerprint: string
  schemaVersion: number | string
}

interface StoredTpsCache extends TpsCacheContext {
  personal: TpsCacheBucket
  global: TpsCacheBucket
}

const recordFields = [
  'id', 'user_id', 'created_at', 'output_tokens', 'duration_ms', 'first_token_ms'
] as const

export function emptyTpsCache(): TpsCache {
  return {
    personal: emptyBucket(),
    global: emptyBucket()
  }
}

export function loadTpsCache(context: TpsCacheContext): TpsCache
export function loadTpsCache(configFingerprint: string, schemaVersion: number | string): TpsCache
export function loadTpsCache(
  contextOrFingerprint: TpsCacheContext | string,
  schemaVersion?: number | string
): TpsCache {
  const context = normalizeContext(contextOrFingerprint, schemaVersion)
  if (!context) return emptyTpsCache()
  try {
    const raw = localStorage.getItem(tpsCacheStorageKey)
    if (!raw) return emptyTpsCache()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)
      || parsed.configFingerprint !== context.configFingerprint
      || parsed.schemaVersion !== context.schemaVersion) {
      return emptyTpsCache()
    }
    return sanitizeCache(parsed)
  } catch {
    return emptyTpsCache()
  }
}

export function saveTpsCache(cache: TpsCache, context: TpsCacheContext): TpsCache
export function saveTpsCache(cache: TpsCache, configFingerprint: string, schemaVersion: number | string): TpsCache
export function saveTpsCache(
  cache: TpsCache,
  contextOrFingerprint: TpsCacheContext | string,
  schemaVersion?: number | string
): TpsCache {
  const context = normalizeContext(contextOrFingerprint, schemaVersion)
  const sanitized = sanitizeCache(cache)
  if (!context) return sanitized
  const stored: StoredTpsCache = { ...context, ...sanitized }
  try {
    localStorage.setItem(tpsCacheStorageKey, JSON.stringify(stored))
  } catch {
    // Storage quota and unavailable-storage errors must not break TPS display.
  }
  return sanitized
}

export function clearTpsCache(): void {
  try {
    localStorage.removeItem(tpsCacheStorageKey)
  } catch {
    // A missing or unavailable storage is already equivalent to a cleared cache.
  }
}

function emptyBucket(): TpsCacheBucket {
  return { records: [], lastIncrementalAt: null, lastCompleteAt: null }
}

function normalizeContext(contextOrFingerprint: TpsCacheContext | string, schemaVersion?: number | string): TpsCacheContext | null {
  if (typeof contextOrFingerprint === 'string') {
    return contextOrFingerprint !== '' && schemaVersion !== undefined
      ? { configFingerprint: contextOrFingerprint, schemaVersion }
      : null
  }
  return typeof contextOrFingerprint?.configFingerprint === 'string'
    && contextOrFingerprint.configFingerprint !== ''
    && contextOrFingerprint.schemaVersion !== undefined
    ? contextOrFingerprint
    : null
}

function sanitizeCache(value: unknown): TpsCache {
  if (!isRecord(value)) return emptyTpsCache()
  return {
    personal: sanitizeBucket(value.personal),
    global: sanitizeBucket(value.global)
  }
}

function sanitizeBucket(value: unknown): TpsCacheBucket {
  if (!isRecord(value)) return emptyBucket()
  const records = Array.isArray(value.records)
    ? value.records.slice(0, TPS_CACHE_MAX_RECORDS).map(sanitizeRecord).filter((record): record is TpsCacheRecord => record !== null)
    : []
  return {
    records,
    ...(value.capped === true ? { capped: true } : {}),
    ...(typeof value.periodDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.periodDate) ? { periodDate: value.periodDate } : {}),
    lastIncrementalAt: normalizeTimestamp(value.lastIncrementalAt),
    lastCompleteAt: normalizeTimestamp(value.lastCompleteAt)
  }
}

function sanitizeRecord(value: unknown): TpsCacheRecord | null {
  if (!isRecord(value) || !('id' in value) || !('created_at' in value)) return null
  const result: Partial<TpsCacheRecord> = {}
  for (const field of recordFields) {
    if (!(field in value)) continue
    const fieldValue = value[field]
    if (isSafeRecordValue(fieldValue)) result[field] = fieldValue as never
  }
  return result as TpsCacheRecord
}

function normalizeTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function isSafeRecordValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
