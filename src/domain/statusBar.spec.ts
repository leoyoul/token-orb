import { describe, expect, it } from 'vitest'
import { defaultSettings } from './settings'
import { aggregateUserModelUsage, buildStatusBarDisplayItems } from './statusBar'
import type { AdminMonitorMetrics } from './tokenMetrics'

const metrics: AdminMonitorMetrics = {
  todayTotalTokens: 2_240_000,
  todayTotalCost: 2.66,
  totalTokens: 25_990_000_000,
  totalActualCost: 17_730,
  poolRemainingPercent: 92,
  poolLatestResetAt: null,
  poolResetItems: [],
  poolSevenDayRemainingPercent: 89,
  poolAccounts: null,
  poolCapacity: { groupId: 1, concurrencyUsed: 2, concurrencyMax: 100 },
  poolAccountDetails: [],
  userRanking: [],
  updatedAt: null
}

describe('status bar display', () => {
  it('builds selected metrics in the persisted order with two display rows', () => {
    const items = buildStatusBarDisplayItems({
      ...defaultSettings,
      statusBarMetrics: ['todayUsage', 'totalUsage', 'capacity', 'poolSevenDayRemaining', 'selectedUserUsage']
    }, metrics, { tokens: 2_200_000, actualCost: 2.66 })

    expect(items).toEqual([
      { key: 'todayUsage', topText: '今日 2.24M', bottomText: '$2.66' },
      { key: 'totalUsage', topText: '总计 25.99B', bottomText: '$17.73K' },
      { key: 'capacity', topText: '容量', bottomText: '2 / 100' },
      { key: 'poolSevenDayRemaining', topText: '周余额', bottomText: '89%' },
      { key: 'selectedUserUsage', topText: '用户 2.20M', bottomText: '$2.66' }
    ])
  })

  it('aggregates a selected user across models without inventing a missing cost', () => {
    expect(aggregateUserModelUsage([
      { model: 'a', requests: 1, tokens: 1_000, actualCost: null },
      { model: 'b', requests: 2, tokens: 2_000, actualCost: null }
    ])).toEqual({ tokens: 3_000, actualCost: null })

    expect(aggregateUserModelUsage([])).toEqual({ tokens: 0, actualCost: 0 })

    expect(aggregateUserModelUsage([
      { model: 'a', requests: 1, tokens: 1_000, actualCost: 0.25 },
      { model: 'b', requests: 2, tokens: 2_000, actualCost: 0.75 }
    ])).toEqual({ tokens: 3_000, actualCost: 1 })
  })
})
