import { describe, expect, it, vi } from 'vitest'
import { calculateRecentTpsMetric, loadRecentTpsMetric, yesterdayTpsPeriod, calculateTpsMetric, createTpsWindowCache, emptyTpsMetric, errorTpsMetric, filterTpsRecordsByUser, isSuccessfulTextRecord, loadTpsMetricWindow, loadingTpsMetric, normalizeUsageTpsRecords, TPS_SCHEMA_INCOMPATIBLE_CODE, TPS_SCHEMA_INCOMPATIBLE_MESSAGE, type UsageTpsRecord } from './tpsMetrics'

const now = '2026-09-05T12:00:00.000Z'
const record = (overrides: Partial<UsageTpsRecord> = {}): UsageTpsRecord => ({
  id: 'r1', created_at: '2026-09-05T11:59:00.000Z', status_code: 200, output_tokens: 120, duration_ms: 12_000, first_token_ms: 2_000, ...overrides
})

describe('tpsMetrics', () => {
  it('uses the latest five valid personal requests even when they are older than five minutes', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => record({ id: index, user_id: 7, created_at: `2026-09-04T0${index}:00:00Z`, output_tokens: (index + 1) * 100 }))
    rows.push(record({ id: 'failed', user_id: 7, request_type: 'cyber', output_tokens: 99999 }))
    const metric = calculateRecentTpsMetric(rows, 7, new Date(now))
    expect(metric).toMatchObject({ state: 'ready', sampleCount: 5, outputTokens: 2500, generationMs: 50000, value: 50, sampleLimit: 5 })
    const fetchPage = vi.fn(async () => ({ items: rows, total: rows.length }))
    const loaded = await loadRecentTpsMetric({ windowMinutes: 5, userId: 7, cache: createTpsWindowCache(), cacheKey: 'recent', now: new Date(now), fetchPage })
    expect(loaded.value).toBe(50)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, startDate: '', endDate: '' }))
  })

  it('queries only yesterday and excludes the first instant of today', async () => {
    const reference = new Date(2026, 8, 5, 14)
    const period = yesterdayTpsPeriod(reference)
    const fetchPage = vi.fn(async () => ({ items: [
      record({ id: 1, created_at: period.start.toISOString() }),
      record({ id: 2, created_at: period.end.toISOString() })
    ], total: 2 }))
    const metric = await loadTpsMetricWindow({ windowMinutes: 1440, cache: createTpsWindowCache(), cacheKey: 'yesterday', now: period.end, startAt: period.start, endExclusive: true, fetchPage })
    expect(metric.sampleCount).toBe(1)
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-09-04', endDate: '2026-09-04' }))
  })
  it('calculates TPS from total output tokens divided by total generation seconds', () => {
    const result = calculateTpsMetric([record(), record({ id: 'r2', output_tokens: 80, duration_ms: 7_000, first_token_ms: 2_000 })], { now })
    expect(result).toEqual({ state: 'ready', windowMinutes: 5, value: 200 / 15, outputTokens: 200, generationMs: 15_000, sampleCount: 2, updatedAt: now })
  })

  it('filters errors, invalid timing, images, image endpoints, and non-text content', () => {
    const valid = record()
    expect(isSuccessfulTextRecord(valid)).toBe(true)
    expect(calculateTpsMetric([valid, record({ id: 'bad-status', status_code: 500 }), record({ id: 'bad-output', output_tokens: 0 }), record({ id: 'bad-time', duration_ms: 2_000 }), record({ id: 'image-count', image_count: 1 }), record({ id: 'video-count', video_count: 1 }), record({ id: 'image-endpoint', endpoint: '/v1/images/generations' }), record({ id: 'image-type', content_type: 'image/png' }), record({ id: 'cyber', request_type: 'cyber' }), record({ id: 'live', request_type: 'live' }), record({ id: 'audio', media_type: 'audio' }), record({ id: 'billing', billing_mode: 'usd' })], { now }).sampleCount).toBe(1)
  })

  it('accepts a real redacted UsageLog row and status-code-less forward-compatible rows', () => {
    const realRow = record({ id: 42, user_id: 7, request_type: 'stream', billing_mode: 'token', media_type: 'text', inbound_endpoint: '/v1/chat/completions', upstream_endpoint: '/v1/responses' } as Partial<UsageTpsRecord>)
    const noStatus = record({ id: 43, status_code: undefined, status: undefined, request_type: 'ws_v2' })
    expect(calculateTpsMetric([realRow, noStatus], 5, now)).toMatchObject({ state: 'ready', sampleCount: 2 })
  })

  it('returns a stable schema incompatibility error when window rows lack TPS fields', () => {
    const result = calculateTpsMetric([{ id: 1, created_at: '2026-09-05T11:59:00.000Z', request_type: 'stream' }], { now })
    expect(result).toMatchObject({ state: 'error', errorCode: TPS_SCHEMA_INCOMPATIBLE_CODE, error: TPS_SCHEMA_INCOMPATIBLE_MESSAGE })
    expect(calculateTpsMetric([], { now }).state).toBe('empty')
  })

  it('supports local user filtering for a personal metric derived from global rows', () => {
    const rows = [record({ id: 1, user_id: 7 }), record({ id: 2, user_id: 8, output_tokens: 80 })]
    expect(filterTpsRecordsByUser(rows, 7)).toEqual([rows[0]])
    expect(calculateTpsMetric(rows, { now, userId: 7 })).toMatchObject({ sampleCount: 1, outputTokens: 120 })
  })

  it('uses an inclusive lower time boundary and excludes future or stale records', () => {
    const result = calculateTpsMetric([
      record({ id: 'boundary', created_at: '2026-09-05T11:55:00.000Z' }),
      record({ id: 'stale', created_at: '2026-09-05T11:54:59.999Z' }),
      record({ id: 'future', created_at: '2026-09-05T12:00:00.001Z' })
    ], { now, windowMinutes: 5 })
    expect(result.sampleCount).toBe(1)
  })

  it('deduplicates by id before aggregation', () => {
    const result = calculateTpsMetric([record(), record({ output_tokens: 999, duration_ms: 99_000 })], { now })
    expect(result).toMatchObject({ sampleCount: 1, outputTokens: 120, generationMs: 10_000, value: 12 })
  })

  it('supports the daily window and reports empty or incomplete results', () => {
    expect(calculateTpsMetric([record({ created_at: '2026-09-04T12:01:00.000Z' })], { now, windowMinutes: 1440 }).state).toBe('ready')
    expect(calculateTpsMetric([], { now }).state).toBe('empty')
    expect(calculateTpsMetric([record()], { now, incomplete: true })).toMatchObject({ state: 'incomplete', value: null, sampleCount: 1 })
  })

  it('provides explicit loading, empty, and error states', () => {
    expect(loadingTpsMetric(1440).state).toBe('loading')
    expect(emptyTpsMetric().state).toBe('empty')
    expect(errorTpsMetric(new Error('network')).error).toBe('network')
  })

  it('normalizes object rows and rejects rows without identity or creation time', () => {
    expect(normalizeUsageTpsRecords([record(), null, { id: 2 }, { created_at: now }])).toEqual([record()])
  })

  it('paginates until the time boundary and forwards the selected user', async () => {
    const cache = createTpsWindowCache()
    const fetchPage = vi.fn(async ({ page }: { page: number }) => ({
      items: page === 1
        ? [record({ id: 'new', user_id: 7 })]
        : [record({ id: 'boundary', user_id: 7, created_at: '2026-09-05T11:54:00.000Z' })],
      total: null
    }))
    const result = await loadTpsMetricWindow({
      windowMinutes: 5,
      cache,
      cacheKey: 'user-7',
      now: new Date(now),
      pageSize: 1,
      userId: 7,
      fetchPage
    })
    expect(result).toMatchObject({ state: 'ready', sampleCount: 1 })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 1, userId: 7 }))
  })

  it('continues after a short page when total reports more rows', async () => {
    const cache = createTpsWindowCache()
    const fetchPage = vi.fn(async ({ page }: { page: number }) => ({
      items: page === 1
        ? [record({ id: 'page-1' })]
        : [record({ id: 'page-2', output_tokens: 80 })],
      total: 2
    }))
    const result = await loadTpsMetricWindow({
      windowMinutes: 5,
      cache,
      cacheKey: 'short-page',
      now: new Date(now),
      pageSize: 200,
      fetchPage
    })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ state: 'ready', sampleCount: 2, outputTokens: 200 })
  })

  it('does not count cross-page duplicate ids toward the reported total', async () => {
    const cache = createTpsWindowCache()
    const fetchPage = vi.fn(async ({ page }: { page: number }) => ({
      items: page === 1
        ? [record({ id: 'duplicate' })]
        : page === 2
          ? [record({ id: 'duplicate' })]
          : [record({ id: 'unique', output_tokens: 80 })],
      total: 2
    }))
    const result = await loadTpsMetricWindow({
      windowMinutes: 5,
      cache,
      cacheKey: 'duplicate-pages',
      now: new Date(now),
      pageSize: 1,
      fetchPage
    })
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ state: 'ready', sampleCount: 2, outputTokens: 200 })
  })

  it('uses a complete cache for incremental refresh and deduplicates the known row', async () => {
    const cache = createTpsWindowCache()
    const firstFetch = vi.fn(async () => ({ items: [record({ id: 'known' })], total: 1 }))
    await loadTpsMetricWindow({ windowMinutes: 5, cache, cacheKey: 'global', now: new Date(now), fetchPage: firstFetch })
    const incrementalFetch = vi.fn(async () => ({
      items: [record({ id: 'fresh', output_tokens: 80 }), record({ id: 'known' })],
      total: null
    }))
    const result = await loadTpsMetricWindow({
      windowMinutes: 5,
      cache,
      cacheKey: 'global',
      now: new Date(now),
      pageSize: 2,
      fetchPage: incrementalFetch
    })
    expect(incrementalFetch).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ state: 'ready', sampleCount: 2, outputTokens: 200 })
  })

  it('marks the metric incomplete after the 10000-record protection limit', async () => {
    const cache = createTpsWindowCache()
    const fetchPage = vi.fn(async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      items: Array.from({ length: pageSize }, (_, index) => record({ id: `${page}-${index}` })),
      total: null
    }))
    const result = await loadTpsMetricWindow({
      windowMinutes: 5,
      cache,
      cacheKey: 'limit',
      now: new Date(now),
      fetchPage
    })
    expect(fetchPage).toHaveBeenCalledTimes(50)
    expect(result).toMatchObject({ state: 'incomplete', value: null, sampleCount: 10_000 })
  })

  it('paces backfill pages and stops before the next request when demand disappears', async () => {
    const cache = createTpsWindowCache()
    const fetchPage = vi.fn(async ({ page }: { page: number }) => ({
      items: [record({ id: page })],
      total: 3
    }))
    const sleep = vi.fn(async () => undefined)
    let needed = true
    sleep.mockImplementationOnce(async () => {
      needed = false
    })

    const result = await loadTpsMetricWindow({
      windowMinutes: 5,
      cache,
      cacheKey: 'cancelled-backfill',
      now: new Date(now),
      pageSize: 1,
      pageDelayMs: 150,
      shouldContinue: () => needed,
      sleep,
      fetchPage
    })

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(150)
    expect(result).toMatchObject({ state: 'incomplete', value: null, sampleCount: 1 })
    const resume = vi.fn(async ({ page }: { page: number }) => ({ items: [record({ id: page })], total: 3 }))
    await loadTpsMetricWindow({ windowMinutes: 5, cache, cacheKey: 'cancelled-backfill', now: new Date(now), pageSize: 1, fetchPage: resume })
    expect(resume).toHaveBeenCalledTimes(3)
    expect(cache.complete).toBe(true)
  })

  it('does not repeat a capped backfill every minute', async () => {
    const cache = createTpsWindowCache()
    const fetchPage = vi.fn(async ({ page }: { page: number }) => ({ items: [record({ id: page })], total: 100 }))
    const options = { windowMinutes: 5 as const, cache, cacheKey: 'capped', now: new Date(now), pageSize: 1, maxRecords: 2, fetchPage }
    await loadTpsMetricWindow(options)
    expect(cache.capped).toBe(true)
    fetchPage.mockClear()
    const metric = await loadTpsMetricWindow(options)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(metric.state).toBe('incomplete')
  })
})
