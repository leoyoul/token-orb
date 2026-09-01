import type { AppSettings, StatusBarMetricKey } from './settings'
import {
  formatCost,
  formatPoolCapacity,
  formatTokenCount,
  type AdminMonitorMetrics,
  type UserModelUsageItem
} from './tokenMetrics'

export interface SelectedUserUsage {
  tokens: number | null
  actualCost: number | null
}

export interface StatusBarDisplayItem {
  key: StatusBarMetricKey
  topText: string
  bottomText: string
}

export function aggregateUserModelUsage(items: UserModelUsageItem[]): Pick<SelectedUserUsage, 'tokens' | 'actualCost'> {
  const tokens = items.reduce((sum, item) => sum + item.tokens, 0)
  const hasUnknownCost = items.some((item) => item.actualCost === null || !Number.isFinite(item.actualCost))
  return {
    tokens,
    actualCost: hasUnknownCost ? null : items.reduce((sum, item) => sum + (item.actualCost ?? 0), 0)
  }
}

export function buildStatusBarDisplayItems(
  settings: Pick<AppSettings, 'statusBarMetrics'>,
  metrics: AdminMonitorMetrics,
  selectedUser: SelectedUserUsage | null
): StatusBarDisplayItem[] {
  const itemByKey: Record<StatusBarMetricKey, StatusBarDisplayItem | null> = {
    todayUsage: {
      key: 'todayUsage',
      topText: `今日 ${formatTokenCount(metrics.todayTotalTokens)}`,
      bottomText: formatCost(metrics.todayTotalCost)
    },
    totalUsage: {
      key: 'totalUsage',
      topText: `总计 ${formatTokenCount(metrics.totalTokens ?? null)}`,
      bottomText: formatCost(metrics.totalActualCost ?? null)
    },
    capacity: {
      key: 'capacity',
      topText: '容量',
      bottomText: formatPoolCapacity(metrics.poolCapacity)
    },
    poolSevenDayRemaining: {
      key: 'poolSevenDayRemaining',
      topText: '周余额',
      bottomText: formatRemainingPercent(metrics.poolSevenDayRemainingPercent ?? null)
    },
    selectedUserUsage: selectedUser
      ? {
          key: 'selectedUserUsage',
          topText: `用户 ${formatTokenCount(selectedUser.tokens)}`,
          bottomText: formatCost(selectedUser.actualCost)
        }
      : {
          key: 'selectedUserUsage',
          topText: '用户 --',
          bottomText: '--'
        }
  }

  return settings.statusBarMetrics
    .map((key) => itemByKey[key])
    .filter((item): item is StatusBarDisplayItem => item !== null)
}

function formatRemainingPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '--' : `${Math.round(value)}%`
}
