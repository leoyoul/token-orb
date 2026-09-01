import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSub2apiHeaders,
  calculatePoolRemainingPercent,
  countPoolAccounts,
  findExactGroupIdByName,
  findExactGroupIdsByNames,
  findLatestPoolResetAt,
  findPoolCapacitySummary,
  formatCost,
  formatFixedCost,
  formatFirstToken,
  formatPoolCapacity,
  formatPoolAccountCount,
  formatTokenCount,
  listPoolAccountDetails,
  listPoolResetItems,
  normalizeBaseUrl,
  parseGroups,
  parseLatestFirstTokenMs,
  parseTodayActualCost,
  parseTotalTokens,
  parseTotalActualCost,
  parseTotalAccountCost,
  parseTotalStandardCost,
  parseAverageDurationMs,
  parseActiveUsers,
  parseTodayTokens,
  parseModelUserUsage,
  parseUserModelUsage,
  parseUserRanking,
  parseUsers
} from './tokenMetrics'
import { buildRealtimeUrl, fetchAdminMonitorMetrics, fetchAdminUserModelUsage, fetchSub2apiMetrics } from './sub2apiClient'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('tokenMetrics', () => {
  it('normalizes sub2api base url without trailing slash', () => {
    expect(normalizeBaseUrl(' http://127.0.0.1:8081/ ')).toBe('http://127.0.0.1:8081')
  })

  it('parses today token count from dashboard stats', () => {
    expect(parseTodayTokens({ today_tokens: 55900000 })).toBe(55900000)
    expect(parseTodayTokens({ data: { today_tokens: 42 } })).toBe(42)
  })

  it('parses today actual cost from dashboard stats', () => {
    expect(parseTodayActualCost({ today_actual_cost: 32.481 })).toBe(32.481)
    expect(parseTodayActualCost({ data: { today_actual_cost: '0.0098' } })).toBe(0.0098)
    expect(parseTodayActualCost({ today_cost: 12.5 })).toBeNull()
  })

  it('parses supplemental dashboard costs and activity metrics', () => {
    const payload = { total_tokens: 1_000_000, total_actual_cost: 1.2, total_account_cost: 1.25, total_cost: 1.5, average_duration_ms: 16540, active_users: 7 }
    expect(parseTotalTokens(payload)).toBe(1_000_000)
    expect(parseTotalActualCost(payload)).toBe(1.2)
    expect(parseTotalAccountCost(payload)).toBe(1.25)
    expect(parseTotalStandardCost(payload)).toBe(1.5)
    expect(parseAverageDurationMs(payload)).toBe(16540)
    expect(parseActiveUsers(payload)).toBe(7)
  })

  it('parses latest first token from usage list', () => {
    expect(parseLatestFirstTokenMs({ items: [{ first_token_ms: 14620 }] })).toBe(14620)
    expect(parseLatestFirstTokenMs({ data: { items: [{ first_token_ms: 7060 }] } })).toBe(7060)
  })

  it('finds concurrency capacity summary by group id', () => {
    const payload = {
      data: [
        { group_id: 2, concurrency_used: 3, concurrency_max: 40 },
        { group_id: 5, concurrency_used: '1', concurrency_max: '10' }
      ]
    }

    expect(findPoolCapacitySummary(payload, 2)).toEqual({ groupId: 2, concurrencyUsed: 3, concurrencyMax: 40 })
    expect(findPoolCapacitySummary(payload, '5')).toEqual({ groupId: 5, concurrencyUsed: 1, concurrencyMax: 10 })
    expect(findPoolCapacitySummary(payload, 9)).toBeNull()
  })

  it('aggregates concurrency capacity summary by multiple group ids', () => {
    const payload = {
      data: [
        { group_id: 2, concurrency_used: 3, concurrency_max: 40 },
        { group_id: 5, concurrency_used: '1', concurrency_max: '10' },
        { group_id: 8, concurrency_used: 2, concurrency_max: 20 }
      ]
    }

    expect(findPoolCapacitySummary(payload, [2, '5'])).toEqual({ groupId: null, concurrencyUsed: 4, concurrencyMax: 50 })
    expect(findPoolCapacitySummary(payload, [9])).toBeNull()
  })

  it('counts active and total accounts for selected group', () => {
    const accounts = [
      { group_id: 2, status: 'active' },
      { group_id: 2, status: 'rate_limited' },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active' },
      { group_id: 5, status: 'active' },
      { group_id: 2, status: 'disabled' }
    ]

    expect(countPoolAccounts(accounts, 2)).toEqual({ active: 2, limited: 1, error: 0, total: 4 })
  })

  it('counts active and total accounts across selected groups', () => {
    const accounts = [
      { group_id: 2, status: 'active' },
      { group_id: 5, status: 'rate_limited' },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active' },
      { group_id: 8, status: 'active' },
      { group_ids: [5], status: 'error' }
    ]

    expect(countPoolAccounts(accounts, [2, 5])).toEqual({ active: 2, limited: 1, error: 1, total: 4 })
  })

  it('lists account details for selected groups with status, scheduling, usage and window fields', () => {
    const accounts = [
      {
        id: 11,
        name: '由磊',
        email: '707200583@163.com',
        group_id: 2,
        status: 'active',
        schedulable: true,
        current_concurrency: 0,
        concurrency: 10,
        today_requests: 159,
        today_tokens: 52220000,
        extra: {
          codex_5h_used_percent: 9,
          codex_5h_reset_at: '2026-03-16T12:37:00Z',
          codex_7d_used_percent: 7,
          codex_7d_reset_at: '2026-03-23T09:00:00Z'
        }
      },
      {
        id: 12,
        email: 'punks.salver_6h+g4@icloud.com',
        group_ids: [5],
        status: 'rate_limited',
        schedulable: true,
        extra: {
          daily_requests: 158,
          daily_tokens: 22560000,
          codex_5h_used_percent: 51,
          codex_5h_reset_at: '2026-03-20T08:00:00Z',
          codex_7d_used_percent: 50,
          codex_usage_updated_at: '2026-03-16T08:00:00Z',
          codex_7d_reset_after_seconds: 604800
        }
      },
      {
        id: 13,
        account: 'globs-artless.1n+g3@icloud.com',
        groups: [{ id: 2, name: 'codex池' }],
        status: 'error',
        schedulable: false,
        error_message: 'upstream auth failed'
      },
      {
        id: 14,
        name: '其它分组',
        group_id: 9,
        status: 'active',
        today_tokens: 999
      }
    ]

    expect(listPoolAccountDetails(accounts, [2, 5], new Date('2026-03-16T09:00:00Z'))).toEqual([
      {
        rank: 1,
        priority: null,
        name: '由磊（707200583@163.com）',
        status: 'normal',
        statusText: '正常',
        schedulable: true,
        scheduleText: '调度中',
        capacityText: '0 / 10',
        capacityUsed: 0,
        todayTokens: 52220000,
        sevenDayCost: null,
        usageWindows: [
          { type: '5h', usedPercent: 9, resetAt: '2026-03-16T12:37:00.000Z' },
          { type: '7d', usedPercent: 7, resetAt: '2026-03-23T09:00:00.000Z' }
        ]
      },
      {
        rank: 2,
        priority: null,
        name: 'punks.salver_6h+g4@icloud.com',
        status: 'limited',
        statusText: '限流中',
        schedulable: true,
        scheduleText: '调度中',
        capacityText: '--',
        capacityUsed: null,
        todayTokens: 22560000,
        sevenDayCost: null,
        usageWindows: [
          { type: '5h', usedPercent: 51, resetAt: '2026-03-20T08:00:00.000Z' },
          { type: '7d', usedPercent: 50, resetAt: '2026-03-23T08:00:00.000Z' }
        ]
      },
      {
        rank: 3,
        priority: null,
        name: 'globs-artless.1n+g3@icloud.com',
        status: 'error',
        statusText: '错误',
        schedulable: false,
        scheduleText: '已关闭',
        capacityText: '--',
        capacityUsed: null,
        todayTokens: null,
        sevenDayCost: null,
        usageWindows: []
      }
    ])
  })

  it('sorts accounts by priority and then current capacity usage', () => {
    const accounts = [
      { id: 1, name: '同优先级低占用', group_id: 2, status: 'active', priority: 2, current_concurrency: 1 },
      { id: 2, name: '低优先级', group_id: 2, status: 'active', priority: 3, current_concurrency: 9 },
      { id: 3, name: '同优先级高占用', group_id: 2, status: 'active', priority: 2, current_concurrency: 4 },
      { id: 4, name: '未设置优先级', group_id: 2, status: 'active', current_concurrency: 10 }
    ]

    expect(listPoolAccountDetails(accounts, 2)).toMatchObject([
      { rank: 1, name: '同优先级高占用', priority: 2, capacityUsed: 4 },
      { rank: 2, name: '同优先级低占用', priority: 2, capacityUsed: 1 },
      { rank: 3, name: '低优先级', priority: 3, capacityUsed: 9 },
      { rank: 4, name: '未设置优先级', priority: null, capacityUsed: 10 }
    ])
  })

  it('uses batch today tokens and 7d window cost by account id for account details', () => {
    const accounts = [
      {
        id: 11,
        name: 'CR39-UQY5-9C6N-402',
        group_id: 2,
        status: 'active',
        current_concurrency: 3,
        concurrency: 10,
        extra: {
          codex_5h_used_percent: 32
        }
      }
    ]

    expect(listPoolAccountDetails(accounts, 2, new Date('2026-03-16T09:00:00Z'), {
      '11': { tokens: 18090000 }
    }, {
      '11': 5.4
    })).toEqual([
      expect.objectContaining({
        name: 'CR39-UQY5-9C6N-402',
        capacityText: '3 / 10',
        capacityUsed: 3,
        todayTokens: 18090000,
        sevenDayCost: 5.4
      })
    ])
  })

  it('excludes account-limited and errored accounts from selected group active count', () => {
    const accounts = [
      { group_id: 2, status: 'active' },
      { group_id: 2, status: 'active' },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active' },
      { group_id: 2, status: 'inactive' },
      { group_id: 2, status: 'active', rate_limit_reset_at: '2099-03-15T00:00:00Z' },
      {
        group_id: 2,
        status: 'active',
        extra: {
          model_rate_limits: {
            'claude-sonnet-4-5': {
              rate_limited_at: '2026-03-15T00:00:00Z',
              rate_limit_reset_at: '2099-03-15T00:00:00Z'
            }
          }
        }
      },
      { group_id: 2, status: 'error', error_message: 'upstream auth failed' }
    ]

    expect(countPoolAccounts(accounts, 2)).toEqual({ active: 4, limited: 1, error: 1, total: 7 })

    expect(listPoolAccountDetails(accounts.slice(5, 6), 2, new Date('2026-03-16T09:00:00Z'))[0]).toMatchObject({
      status: 'normal',
      statusText: '正常'
    })
  })

  it('formats compact values for orb display', () => {
    expect(formatTokenCount(101330000)).toBe('101.33M')
    expect(formatTokenCount(55900000)).toBe('55.90M')
    expect(formatTokenCount(204200)).toBe('204.20K')
    expect(formatTokenCount(980)).toBe('980.00')
    expect(formatFirstToken(14620)).toBe('14.62s')
    expect(formatFirstToken(null)).toBe('--')
    expect(formatCost(32.481)).toBe('$32.48')
    expect(formatCost(0.1284)).toBe('$0.128')
    expect(formatCost(0.0098)).toBe('$0.0098')
    expect(formatCost(null)).toBe('--')
    expect(formatFixedCost(5.406)).toBe('$5.41')
    expect(formatFixedCost(0.009)).toBe('$0.01')
    expect(formatFixedCost(0)).toBe('$0.00')
    expect(formatFixedCost(null)).toBe('--')
    expect(formatPoolCapacity({ groupId: 2, concurrencyUsed: 3, concurrencyMax: 40 })).toBe('3 / 40')
    expect(formatPoolCapacity(null)).toBe('--')
    expect(formatPoolAccountCount({ active: 2, limited: 1, error: 0, total: 4 })).toEqual({
      active: '2',
      limited: '1',
      error: '0',
      total: '4'
    })
    expect(formatPoolAccountCount(null)).toEqual({ active: '--', limited: '--', error: '--', total: '--' })
  })

  it('builds bearer headers without duplicating prefix', () => {
    expect(buildSub2apiHeaders('abc').Authorization).toBe('Bearer abc')
    expect(buildSub2apiHeaders('Bearer xyz').Authorization).toBe('Bearer xyz')
  })

  it('adds a changing cache buster to realtime admin urls', () => {
    expect(buildRealtimeUrl('http://127.0.0.1/api/v1/admin/accounts?page=1', 1710000000000)).toBe(
      'http://127.0.0.1/api/v1/admin/accounts?page=1&_ts=1710000000000'
    )
    expect(buildRealtimeUrl('http://127.0.0.1/api/v1/admin/groups/capacity-summary', 1710000000000)).toBe(
      'http://127.0.0.1/api/v1/admin/groups/capacity-summary?_ts=1710000000000'
    )
  })

  it('requests ranking user model usage for the current local date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T09:00:00.000Z'))
    let requestedUrl = ''
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      requestedUrl = String(url)
      return new Response(JSON.stringify({ data: { models: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }))

    await fetchAdminUserModelUsage({
      baseUrl: 'http://127.0.0.1:8081',
      apiKey: 'admin-key'
    }, 987)

    const url = new URL(requestedUrl)
    expect(url.pathname).toBe('/api/v1/admin/dashboard/models')
    expect(url.searchParams.get('start_date')).toBe('2026-03-16')
    expect(url.searchParams.get('end_date')).toBe('2026-03-16')
    expect(url.searchParams.get('timezone')).toBeTruthy()
    expect(url.searchParams.get('user_id')).toBe('987')
  })

  it('requests full admin account records so account details can show today requests and tokens', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T09:00:00.000Z'))
    const requestedUrls: string[] = []
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      requestedUrls.push(String(url))
      const pathname = new URL(String(url)).pathname
      const payload = pathname.endsWith('/api/v1/admin/accounts')
        ? { data: [{ id: 1, group_id: 2, status: 'active', today_requests: 9, today_tokens: 1200 }] }
        : { data: [] }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }))

    await fetchAdminMonitorMetrics({
      baseUrl: 'http://127.0.0.1:8081',
      apiKey: 'admin-key'
    })

    const accountUrl = requestedUrls.find((url) => url.includes('/api/v1/admin/accounts?'))
    expect(accountUrl).toBeTruthy()
    expect(accountUrl).toContain('page_size=200')
    expect(accountUrl).not.toContain('lite=true')
  })

  it('loads batch today stats and merges them into admin account details', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T09:00:00.000Z'))
    const requests: Array<{ url: string; init?: RequestInit }> = []
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlText = String(url)
      requests.push({ url: urlText, init })
      const pathname = new URL(urlText).pathname
      const payload = pathname.endsWith('/api/v1/admin/accounts')
        ? { data: [
            { id: 11, name: 'CR39-UQY5-9C6N-402', group_id: 2, status: 'active', extra: { codex_7d_used_percent: 7 } },
            { id: 12, name: '没有 7d 窗口', group_id: 2, status: 'active', extra: {} }
          ] }
        : pathname.endsWith('/api/v1/admin/accounts/today-stats/batch')
          ? { data: { stats: { '11': { requests: 159, tokens: 18090000, cost: 13.08, user_cost: 13.08 } } } }
          : pathname.endsWith('/api/v1/admin/accounts/11/usage')
            ? { data: { seven_day: { window_stats: { requests: 88, tokens: 8100000, cost: 5.4, user_cost: 5.4 } } } }
          : { data: [] }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }))

    const metrics = await fetchAdminMonitorMetrics({
      baseUrl: 'http://127.0.0.1:8081',
      apiKey: 'admin-key'
    })

    const batchRequest = requests.find((item) => item.url.includes('/api/v1/admin/accounts/today-stats/batch'))
    expect(batchRequest?.init?.method).toBe('POST')
    expect(batchRequest?.init?.body).toBe(JSON.stringify({ account_ids: [11, 12] }))
    expect(metrics.poolAccountDetails[0]).toEqual(expect.objectContaining({
      todayTokens: 18090000,
      sevenDayCost: 5.4
    }))
    const usageRequest = requests.find((item) => item.url.includes('/api/v1/admin/accounts/11/usage'))
    expect(usageRequest?.url).toContain('source=active')
    expect(requests.some((item) => item.url.includes('/api/v1/admin/accounts/12/usage'))).toBe(false)
  })

  it('surfaces personal token auth errors from sub2api responses', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      message: 'token invalid or expired'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })))

    await expect(fetchSub2apiMetrics({
      baseUrl: 'http://127.0.0.1:8081',
      token: 'expired-jwt'
    })).rejects.toThrow('认证失败，Token 错误或已失效：token invalid or expired')
  })

  it('parses user token ranking for admin monitor list', () => {
    expect(parseUserRanking({ ranking: [{ user_id: 2, email: 'a@test.com', tokens: 1200, actual_cost: 0.1284 }] })).toEqual([
      { rank: 1, userId: 2, name: '用户', email: 'a@test.com', displayName: '用户（a@test.com）', tokens: 1200, actualCost: 0.1284 }
    ])
  })

  it('uses admin user list username for today usage ranking names', () => {
    const users = parseUsers({ data: [{ id: 2, email: 'a@test.com', username: '阿唐' }] })
    expect(parseUserRanking({ ranking: [{ user_id: 2, email: 'a@test.com', tokens: 1200 }] }, users)).toEqual([
      { rank: 1, userId: 2, name: '阿唐', email: 'a@test.com', displayName: '阿唐（a@test.com）', tokens: 1200, actualCost: null }
    ])
  })

  it('parses model usage rows for an expanded ranking user', () => {
    expect(parseUserModelUsage({ data: { models: [
      { model: 'gpt-5.4', requests: 12, total_tokens: 1200, actual_cost: 0.1284 },
      { model: 'claude-sonnet-4-5', requests: 8, tokens: 800, cost: 0.06 },
      { model: '  ', total_tokens: 99 }
    ] } })).toEqual([
      { model: 'gpt-5.4', requests: 12, tokens: 1200, actualCost: 0.1284 },
      { model: 'claude-sonnet-4-5', requests: 8, tokens: 800, actualCost: 0.06 }
    ])
  })

  it('uses admin usernames for model user breakdown rows', () => {
    const users = parseUsers({ data: [{ id: 2, email: 'a@test.com', username: '阿唐' }] })
    expect(parseModelUserUsage({ users: [{ user_id: 2, email: 'legacy@test.com', requests: 3, total_tokens: 1200, actual_cost: 0.12 }] }, users)).toEqual([
      { userId: 2, displayName: '阿唐（a@test.com）', requests: 3, tokens: 1200, actualCost: 0.12 }
    ])
  })

  it('limits today usage ranking to top 10 and accepts backend token aliases', () => {
    const ranking = Array.from({ length: 12 }, (_, index) => ({
      user_id: index + 1,
      email: `user${index + 1}@test.com`,
      total_tokens: (index + 1) * 1000
    }))

    const parsed = parseUserRanking({ ranking })
    expect(parsed).toHaveLength(10)
    expect(parsed[0].tokens).toBe(12000)
    expect(parsed[9].tokens).toBe(3000)
  })

  it('calculates average remaining percent for selected group accounts', () => {
    const accounts = [
      { group_ids: [1], status: 'active', extra: { codex_5h_used_percent: 60 } },
      { groups: [{ id: 1, name: 'gpt-plus' }], status: 'active', extra: { codex_5h_used_percent: 40 } },
      { group_id: 2, extra: { codex_5h_used_percent: 90 } }
    ]
    expect(calculatePoolRemainingPercent(accounts, '1')).toBe(50)
  })

  it('calculates average remaining percent for selected group accounts across multiple groups', () => {
    const accounts = [
      { group_ids: [1], status: 'active', extra: { codex_5h_used_percent: 60 } },
      { groups: [{ id: 2, name: 'codex池' }], status: 'active', extra: { codex_5h_used_percent: 40 } },
      { group_id: 3, status: 'active', extra: { codex_5h_used_percent: 90 } }
    ]

    expect(calculatePoolRemainingPercent(accounts, [1, 2])).toBe(50)
  })

  it('calculates 5h pool remaining by active and rate-limited accounts in the named group', () => {
    const poolGroupId = findExactGroupIdByName(
      parseGroups({
        data: [
          { id: 1, name: 'codex池', status: 'active' },
          { id: 2, name: 'codex池备用', status: 'active' }
        ]
      }),
      'codex池'
    )
    const accounts = [
      { status: 'active', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 0 } },
      { status: 'active', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 3 } },
      { status: 'active', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 5 } },
      { status: 'rate_limited', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 100 } },
      { status: 'error', groups: [{ id: 1, name: 'codex池' }], extra: { codex_5h_used_percent: 100 } },
      { status: 'active', groups: [{ id: 2, name: '其它池' }], extra: { codex_5h_used_percent: 100 } }
    ]

    expect(poolGroupId).toBe(1)
    expect(calculatePoolRemainingPercent(accounts, poolGroupId)).toBeCloseTo(73, 2)
  })

  it('calculates 7d pool remaining from the 7d usage window', () => {
    const accounts = [
      {
        group_id: 1,
        status: 'active',
        extra: {
          codex_5h_used_percent: 10,
          codex_7d_used_percent: 30,
          codex_7d_reset_at: '2026-03-23T09:00:00Z'
        }
      },
      {
        group_id: 1,
        status: 'limited',
        extra: {
          codex_5h_used_percent: 80,
          codex_7d_used_percent: 50,
          codex_7d_reset_at: '2026-03-23T09:00:00Z'
        }
      },
      {
        group_id: 1,
        status: 'error',
        extra: { codex_7d_used_percent: 0 }
      }
    ]

    expect(calculatePoolRemainingPercent(accounts, 1, new Date('2026-03-16T09:00:00Z'), '7d')).toBe(60)
  })

  it('excludes disabled and errored accounts from the 7d pool average', () => {
    const accounts = [
      {
        group_id: 1,
        status: 'active',
        schedulable: true,
        extra: { codex_7d_used_percent: 11, codex_7d_reset_at: '2026-03-23T09:00:00Z' }
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: index + 2,
        group_id: 1,
        status: 'active',
        schedulable: false,
        extra: { codex_7d_used_percent: 0, codex_7d_reset_at: '2026-03-23T09:00:00Z' }
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: index + 20,
        group_id: 1,
        status: 'error',
        extra: { codex_7d_used_percent: 0, codex_7d_reset_at: '2026-03-23T09:00:00Z' }
      }))
    ]

    expect(calculatePoolRemainingPercent(accounts, 1, new Date('2026-03-16T09:00:00Z'), '7d')).toBe(89)
  })

  it('treats expired 5h usage windows as fully remaining', () => {
    const accounts = [
      {
        status: 'active',
        groups: [{ id: 1, name: 'codex池' }],
        extra: {
          codex_5h_used_percent: 42,
          codex_5h_reset_at: '2026-03-16T10:00:00Z'
        }
      }
    ]

    expect(calculatePoolRemainingPercent(accounts, 1, new Date('2026-03-16T12:00:00Z'))).toBe(100)
  })

  it('finds nearest future 5h reset time from counted accounts in selected group', () => {
    const accounts = [
      {
        status: 'active',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T10:00:00Z' }
      },
      {
        status: 'rate_limited',
        groups: [{ id: 1, name: 'codex池' }],
        extra: {
          codex_usage_updated_at: '2026-03-16T08:00:00Z',
          codex_5h_reset_after_seconds: 12600
        }
      },
      {
        status: 'error',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T20:00:00Z' }
      },
      {
        status: 'active',
        groups: [{ id: 2, name: '其它池' }],
        extra: { codex_5h_reset_at: '2026-03-16T22:00:00Z' }
      }
    ]

    expect(findLatestPoolResetAt(accounts, 1, new Date('2026-03-16T09:00:00Z'))).toBe('2026-03-16T10:00:00.000Z')
  })

  it('lists pool reset times by nearest first with normal and limited status', () => {
    const accounts = [
      {
        status: 'active',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T12:00:00Z' }
      },
      {
        status: 'active',
        rate_limit_reset_at: '2026-03-16T11:00:00Z',
        groups: [{ id: 1, name: 'codex池' }],
        extra: { codex_5h_reset_at: '2026-03-16T10:00:00Z' }
      },
      {
        status: 'active',
        groups: [{ id: 2, name: '其它池' }],
        extra: { codex_5h_reset_at: '2026-03-16T09:30:00Z' }
      }
    ]

    expect(listPoolResetItems(accounts, 1, new Date('2026-03-16T09:00:00Z'))).toEqual([
      { status: 'limited', resetAt: '2026-03-16T10:00:00.000Z' },
      { status: 'normal', resetAt: '2026-03-16T12:00:00.000Z' }
    ])
  })

  it('does not fuzzy match group names before resolving group id', () => {
    const groups = parseGroups({
      data: [
        { id: 1, name: 'codex池', status: 'active' },
        { id: 2, name: 'codex池备用', status: 'active' },
        { id: 3, name: 'codex', status: 'inactive' }
      ]
    })

    expect(findExactGroupIdByName(groups, 'codex池')).toBe(1)
    expect(findExactGroupIdByName(groups, 'codex')).toBeNull()
    expect(findExactGroupIdByName(groups, 'codex池备')).toBeNull()
  })

  it('resolves multiple exact active group names and removes duplicates', () => {
    const groups = parseGroups({
      data: [
        { id: 1, name: 'codex池', status: 'active' },
        { id: 2, name: 'codex池备用', status: 'active' },
        { id: 3, name: 'codex', status: 'inactive' }
      ]
    })

    expect(findExactGroupIdsByNames(groups, ['codex池', 'codex池备用', 'codex池'])).toEqual([1, 2])
    expect(findExactGroupIdsByNames(groups, ['codex'])).toEqual([])
  })
})
