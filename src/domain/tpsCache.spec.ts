import { beforeEach, describe, expect, it } from 'vitest'
import { clearTpsCache, emptyTpsCache, loadTpsCache, saveTpsCache, tpsCacheStorageKey, type TpsCache } from './tpsCache'

const context = { configFingerprint: 'fingerprint-a', schemaVersion: 2 }
const record = {
  id: 'row-1', user_id: 7, created_at: '2026-09-05T00:00:00Z', output_tokens: 100,
  duration_ms: 2_000, first_token_ms: 200, request_type: 'chat', billing_mode: 'standard',
  media_type: 'text', inbound_endpoint: 'https://api.example.test/v1/chat?api_key=secret',
  upstream_endpoint: '/v1/chat#secret', image_count: 0, video_count: 0,
  status_code: 200, status: 'success', api_key: 'secret', baseUrl: 'https://api.example.test'
}

describe('tpsCache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists only the allowlisted, sanitized record fields', () => {
    const cache: TpsCache = { ...emptyTpsCache(), personal: { records: [record], lastIncrementalAt: 'i', lastCompleteAt: 'c' } }
    saveTpsCache(cache, context)
    const stored = JSON.parse(localStorage.getItem(tpsCacheStorageKey) ?? '{}')
    expect(stored.personal.records[0]).toEqual({
      id: 'row-1', user_id: 7, created_at: '2026-09-05T00:00:00Z', output_tokens: 100,
      duration_ms: 2_000, first_token_ms: 200
    })
    expect(JSON.stringify(stored)).not.toContain('secret')
    expect(JSON.stringify(stored)).not.toContain('api_key')
    expect(JSON.stringify(stored)).not.toContain('baseUrl')
  })

  it('truncates each bucket at 10000 records', () => {
    const records = Array.from({ length: 10_001 }, (_, index) => ({ id: index, created_at: 'now' }))
    const saved = saveTpsCache({ ...emptyTpsCache(), global: { records, lastIncrementalAt: null, lastCompleteAt: null } }, context)
    expect(saved.global.records).toHaveLength(10_000)
    expect(loadTpsCache(context).global.records).toHaveLength(10_000)
  })

  it('returns an empty cache for malformed JSON or mismatched context', () => {
    localStorage.setItem(tpsCacheStorageKey, '{bad json')
    expect(loadTpsCache(context)).toEqual(emptyTpsCache())
    saveTpsCache({ ...emptyTpsCache(), global: { records: [record], lastIncrementalAt: null, lastCompleteAt: null } }, context)
    expect(loadTpsCache({ configFingerprint: 'fingerprint-b', schemaVersion: 2 })).toEqual(emptyTpsCache())
    expect(loadTpsCache({ configFingerprint: 'fingerprint-a', schemaVersion: 3 })).toEqual(emptyTpsCache())
  })

  it('round-trips personal/global records and update timestamps', () => {
    const cache: TpsCache = {
      personal: { records: [record], lastIncrementalAt: '2026-09-05T01:00:00Z', lastCompleteAt: null },
      global: { records: [{ id: 2, created_at: '2026-09-05T02:00:00Z', output_tokens: 20 }], lastIncrementalAt: null, lastCompleteAt: '2026-09-05T03:00:00Z' }
    }
    saveTpsCache(cache, context)
    expect(loadTpsCache(context)).toEqual({
      personal: { records: [{
        id: record.id, user_id: record.user_id, created_at: record.created_at, output_tokens: record.output_tokens,
        duration_ms: record.duration_ms, first_token_ms: record.first_token_ms
      }], lastIncrementalAt: '2026-09-05T01:00:00Z', lastCompleteAt: null },
      global: cache.global
    })
  })

  it('clears the persisted cache', () => {
    saveTpsCache(emptyTpsCache(), context)
    clearTpsCache()
    expect(localStorage.getItem(tpsCacheStorageKey)).toBeNull()
    expect(loadTpsCache(context)).toEqual(emptyTpsCache())
  })
})
