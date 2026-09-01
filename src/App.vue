<template>
  <main v-if="isTrayMenuView" class="tray-menu-shell">
    <button class="tray-menu-item" type="button" @click="runTrayCommand('monitor')">
      <ListChecks :size="18" />
      <span>显示监控面板</span>
    </button>
    <button class="tray-menu-item" type="button" @click="runTrayCommand('settings')">
      <Settings :size="18" />
      <span>设置</span>
    </button>
    <button class="tray-menu-item" type="button" @click="runTrayCommand('update')">
      <RefreshCw :size="18" />
      <span>{{ platformUpdateAvailable ? '有版本更新' : '检查更新' }}</span>
      <i v-if="platformUpdateAvailable" class="tray-menu-update-dot"></i>
    </button>
    <div class="tray-menu-version">当前版本 v{{ appVersion }}</div>
    <div class="tray-menu-separator"></div>
    <button class="tray-menu-item tray-menu-item--quit" type="button" @click="runTrayCommand('quit')">
      <Power :size="18" />
      <span>退出 Token Orb</span>
    </button>
  </main>

  <main v-else-if="isSettingsView" class="settings-shell">
    <section class="settings-panel standalone">
      <div class="section-title">
        <MonitorDot :size="18" />
        <span>连接设置</span>
      </div>

      <label class="field">
        <span>sub2api Base URL</span>
        <input v-model="draft.sub2apiBaseUrl" placeholder="http://172.16.5.12:8081" />
      </label>

      <label class="field">
        <span>管理员 API Key</span>
        <input v-model="draft.adminApiKey" type="password" placeholder="用于读取系统监控数据" />
      </label>

      <label class="field switch-field">
        <span>悬浮球</span>
        <span class="switch-control">
          <input v-model="draft.personalFloatingEnabled" name="personal-floating-enabled" type="checkbox" />
          <i></i>
        </span>
      </label>

      <label v-if="draft.personalFloatingEnabled" class="field personal-token-field">
        <span class="field-heading">
          <span>个人 JWT / Bearer Token（可选）</span>
          <button class="secondary-mini-button" type="button" :disabled="personalTokenTesting" @click.prevent.stop="testPersonalToken">
            {{ personalTokenTesting ? '测试中' : '测试' }}
          </button>
        </span>
        <input v-model="draft.personalToken" type="password" placeholder="用于悬浮球个人数据" />
        <em v-if="personalTokenTestMessage" class="field-message" :class="personalTokenTestState">
          {{ personalTokenTestMessage }}
        </em>
      </label>

      <label class="field pool-group-field">
        <span>号池分组名称（可选）</span>
        <div class="tag-input" @click="focusPoolGroupInput">
          <button
            v-for="name in draft.poolGroupNames"
            :key="name"
            class="tag-chip"
            type="button"
            :title="`移除 ${name}`"
            @click.stop="removePoolGroupName(name)"
          >
            <span>{{ name }}</span>
            <X :size="13" />
          </button>
          <input
            ref="poolGroupInputRef"
            v-model="poolGroupNameInput"
            placeholder="输入后按回车添加，留空统计全部正常账号"
            @keydown.enter.prevent="addPoolGroupName"
            @keydown.backspace="removeLastPoolGroupNameWhenEmpty"
          />
        </div>
      </label>

      <section class="status-bar-settings" aria-labelledby="status-bar-settings-title">
        <div class="section-title status-bar-settings__title">
          <MonitorDot :size="18" />
          <span id="status-bar-settings-title">状态栏显示</span>
        </div>

        <div class="status-bar-preview" :class="{ empty: draftStatusBarItems.length === 0 }">
          <span v-if="draftStatusBarItems.length === 0">Token Orb</span>
          <div v-for="item in draftStatusBarItems" v-else :key="item.key" class="status-bar-preview__item">
            <small>{{ item.topText }}</small>
            <strong>{{ item.bottomText }}</strong>
          </div>
        </div>

        <div class="status-bar-options">
          <label v-for="option in statusBarMetricOptions" :key="option.key" class="status-bar-option">
            <input
              v-model="draft.statusBarMetrics"
              :name="`status-bar-${option.key}`"
              :value="option.key"
              type="checkbox"
            />
            <span>{{ option.label }}</span>
          </label>
        </div>

        <label v-if="draft.statusBarMetrics.includes('selectedUserUsage')" class="field status-bar-user-field">
          <span>指定用户</span>
          <select v-model="draft.statusBarUserId" name="status-bar-user-id">
            <option :value="null">请选择用户</option>
            <option v-if="draft.statusBarUserId && !draftStatusBarUserExists" :value="draft.statusBarUserId">
              用户 #{{ draft.statusBarUserId }}（当前不可用）
            </option>
            <option v-for="user in statusBarUserOptions" :key="user.id" :value="user.id">
              {{ user.label }}
            </option>
          </select>
        </label>
      </section>

      <label class="field compact-field">
        <span>刷新间隔</span>
        <input v-model.number="draft.refreshSeconds" min="10" max="300" step="5" type="number" />
        <em>秒</em>
      </label>

      <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

      <div class="settings-panel__actions">
        <button class="primary-button" type="button" @click="saveDraft">保存配置</button>
        <span v-if="saveMessage" class="save-message">{{ saveMessage }}</span>
      </div>
    </section>
  </main>

  <main v-else-if="isUpdaterView" class="settings-shell update-shell">
    <section ref="updatePanelRef" class="settings-panel standalone update-panel">
      <div class="section-title">
        <span>当前版本</span>
        <button class="update-refresh-button" type="button" :disabled="updateBusy" title="重新检查更新" @click="checkForAppUpdate">
          <RefreshCw :class="{ spinning: updateState === 'checking' || updateState === 'downloading' }" :size="20" />
        </button>
      </div>

      <div class="update-version-hero">
        <strong>v{{ appVersion }}</strong>
        <span v-if="updateVersion">最新版本：v{{ updateVersion }}</span>
      </div>

      <div v-if="updateState === 'available'" class="update-available-card">
        <Download :size="25" />
        <div>
          <strong>有新版本可用！</strong>
          <span>v{{ updateVersion }}</span>
        </div>
      </div>

      <div v-else class="update-status" :class="updateState">{{ updateMessage }}</div>

      <div v-if="updateBody" class="update-notes">
        <span>更新内容</span>
        <pre>{{ updateBody }}</pre>
      </div>

      <div v-if="downloadPercent !== null" class="update-progress">
        <i :style="{ width: `${downloadPercent}%` }"></i>
      </div>

      <div class="settings-panel__actions update-actions">
        <button v-if="updateState === 'available'" class="primary-button" type="button" @click="installAppUpdate">
          <Download :size="19" />
          立即更新
        </button>
        <button v-if="updateState === 'installed'" class="primary-button" type="button" @click="restartApp">
          重启完成更新
        </button>
      </div>
      <button class="update-release-notes" type="button" @click="openReleaseNotes">
        查看更新日志
        <ExternalLink :size="14" />
      </button>
    </section>
  </main>

  <main v-else-if="isPlatformView" class="platform-shell">
    <section ref="monitorPanelRef" class="monitor-panel" data-tauri-drag-region>
      <div class="section-title">
        <ListChecks :size="16" />
        <span>平台信息</span>
        <button
          class="platform-version"
          :class="{ 'platform-version--available': platformUpdateAvailable }"
          type="button"
          :title="platformUpdateAvailable ? '发现新版本，点击更新' : '检查更新'"
          @click.stop="openUpdateWindow"
        >
          <span>v{{ appVersion }}</span>
          <i v-if="platformUpdateAvailable" class="platform-version__update-dot" aria-label="有版本更新"></i>
        </button>
        <time>{{ platformUpdatedText }}</time>
      </div>

      <div v-if="hasAdmin" class="monitor-grid">
        <article class="monitor-card">
          <span>今日总 Token</span>
          <strong>{{ formattedAdminToday }}</strong>
          <em class="token-cost">{{ formattedAdminTodayCost }}</em>
        </article>
        <article class="monitor-card">
          <div class="monitor-card__header">
            <span>{{ selectedPoolWindowLabel }}号池剩余量</span>
            <div class="pool-window-tabs" role="tablist" aria-label="号池统计周期">
              <button
                class="pool-window-tab"
                :class="{ active: poolWindowType === '7d' }"
                :aria-selected="poolWindowType === '7d'"
                data-window="7d"
                type="button"
                role="tab"
                @click="poolWindowType = '7d'"
              >7d</button>
              <button
                class="pool-window-tab"
                :class="{ active: poolWindowType === '5h' }"
                :aria-selected="poolWindowType === '5h'"
                data-window="5h"
                type="button"
                role="tab"
                @click="poolWindowType = '5h'"
              >5h</button>
            </div>
          </div>
          <div class="pool-value-line">
            <strong :class="selectedPoolStatusClass">{{ formattedSelectedPoolRemaining }}</strong>
            <span v-if="formattedSelectedPoolLatestReset !== '--'" class="pool-reset-hover">
              <em>{{ formattedSelectedPoolLatestReset }} 后刷新</em>
              <span class="pool-reset-popover">
                <span class="pool-reset-popover__title">{{ selectedPoolWindowLabel }}刷新时间列表</span>
                <span v-if="formattedSelectedPoolResetItems.length === 0" class="pool-reset-empty">暂无刷新时间</span>
                <span v-for="(item, index) in formattedSelectedPoolResetItems" :key="`${item.resetAt}-${index}`" class="pool-reset-row">
                  <span class="pool-reset-status" :class="item.statusClass">{{ item.statusText }}</span>
                  <time>{{ item.displayTime }}</time>
                </span>
              </span>
            </span>
          </div>
          <div class="pool-progress" :class="selectedPoolStatusClass">
            <i :style="{ width: selectedPoolProgressWidth }"></i>
          </div>
        </article>
      </div>

      <div v-if="hasAdmin" class="monitor-grid monitor-grid--secondary">
        <article class="monitor-card">
          <span>总 Token</span>
          <strong>{{ formattedAdminTotal }}</strong>
          <em class="token-cost" title="实际消费">{{ formattedAdminTotalActualCost }}</em>
        </article>
        <article class="monitor-card">
          <span>平均响应</span>
          <strong class="response-duration">{{ formattedAverageDuration }}</strong>
          <em class="active-users">{{ formattedActiveUsers }}</em>
        </article>
      </div>

      <div v-if="hasAdmin" class="ranking-box">
        <div class="section-title">
          <Users :size="16" />
          <span class="ranking-title-label">排行榜</span>
          <div class="ranking-tabs" role="tablist" aria-label="今日榜单切换">
            <button
              class="ranking-tab"
              :class="{ active: rankingView === 'users' && rankingMode === 'tokens' }"
              type="button"
              role="tab"
              :aria-selected="rankingView === 'users' && rankingMode === 'tokens'"
              @click="showUserRanking('tokens')"
            >
              今日用量榜
            </button>
            <button
              class="ranking-tab"
              :class="{ active: rankingView === 'users' && rankingMode === 'cost' }"
              type="button"
              role="tab"
              :aria-selected="rankingView === 'users' && rankingMode === 'cost'"
              @click="showUserRanking('cost')"
            >
              今日消费榜
            </button>
            <button
              class="ranking-tab"
              :class="{ active: rankingView === 'models' }"
              type="button"
              role="tab"
              :aria-selected="rankingView === 'models'"
              @click="showModelRanking"
            >
              模型用量榜
            </button>
          </div>
          <button
            class="ranking-toggle"
            :aria-expanded="rankingExpanded"
            :title="rankingExpanded ? '收起排行榜' : '展开排行榜'"
            type="button"
            @click="toggleRanking"
          >
            <ChevronUp v-if="rankingExpanded" :size="16" />
            <ChevronDown v-else :size="16" />
          </button>
        </div>
        <div v-if="rankingExpanded" class="ranking-content">
        <template v-if="rankingView === 'users'">
          <div v-if="adminMetrics.userRanking.length === 0" class="empty-line">暂无数据</div>
          <div v-for="(item, index) in displayedUserRanking" :key="rankingUserKey(item)" class="ranking-entry">
          <button
            class="ranking-row"
            :aria-controls="`ranking-models-${rankingUserKey(item)}`"
            :aria-expanded="isRankingUserExpanded(item)"
            :title="isRankingUserExpanded(item) ? '收起模型用量' : '展开模型用量'"
            type="button"
            @click="toggleRankingUser(item)"
          >
            <b>#{{ index + 1 }}</b>
            <span>{{ item.displayName }}</span>
            <div class="ranking-value" :class="{ 'ranking-value--cost': rankingMode === 'cost' }">
              <strong>{{ formatTokenCount(item.tokens) }}</strong>
              <em class="token-cost">{{ formatCost(item.actualCost) }}</em>
            </div>
            <ChevronUp v-if="isRankingUserExpanded(item)" class="ranking-chevron" :size="15" />
            <ChevronDown v-else class="ranking-chevron" :size="15" />
          </button>
          <div
            v-if="isRankingUserExpanded(item)"
            :id="`ranking-models-${rankingUserKey(item)}`"
            class="ranking-model-list"
          >
            <div v-if="rankingModelUsageState[rankingUserKey(item)] === 'loading'" class="ranking-model-empty">加载模型用量中...</div>
            <div v-else-if="rankingModelUsageState[rankingUserKey(item)] === 'error'" class="ranking-model-empty">模型用量加载失败</div>
            <div v-else-if="sortedRankingModelUsage(item).length === 0" class="ranking-model-empty">暂无模型用量</div>
            <div v-for="model in sortedRankingModelUsage(item)" :key="model.model" class="ranking-model-row">
              <span>{{ model.model }}</span>
              <div class="ranking-value ranking-value--model" :class="{ 'ranking-value--cost': rankingMode === 'cost' }">
                <strong>{{ formatTokenCount(model.tokens) }}</strong>
                <em class="token-cost">{{ formatCost(model.actualCost) }}</em>
              </div>
            </div>
          </div>
        </div>
        </template>
        <div v-else class="model-ranking-table">
          <div class="model-ranking-head">
            <span>模型</span>
            <button
              :class="{ active: modelRankingSort === 'requests' }"
              :aria-pressed="modelRankingSort === 'requests'"
              title="按请求数从高到低排序"
              type="button"
              @click="modelRankingSort = 'requests'"
            >
              <span>请求</span>
              <ArrowDown v-if="modelRankingSort === 'requests'" :size="11" />
              <ArrowUpDown v-else :size="11" />
            </button>
            <button
              :class="{ active: modelRankingSort === 'tokens' }"
              :aria-pressed="modelRankingSort === 'tokens'"
              title="按 Token 从高到低排序"
              type="button"
              @click="modelRankingSort = 'tokens'"
            >
              <span>Token</span>
              <ArrowDown v-if="modelRankingSort === 'tokens'" :size="11" />
              <ArrowUpDown v-else :size="11" />
            </button>
            <button
              :class="{ active: modelRankingSort === 'cost' }"
              :aria-pressed="modelRankingSort === 'cost'"
              title="按消费从高到低排序"
              type="button"
              @click="modelRankingSort = 'cost'"
            >
              <span>消费</span>
              <ArrowDown v-if="modelRankingSort === 'cost'" :size="11" />
              <ArrowUpDown v-else :size="11" />
            </button>
            <span></span>
          </div>
          <div v-if="modelRankingState === 'loading'" class="ranking-model-empty">加载模型用量中...</div>
          <div v-else-if="modelRankingState === 'error'" class="ranking-model-empty">模型用量加载失败</div>
          <div v-else-if="sortedModelRanking.length === 0" class="ranking-model-empty">暂无模型用量</div>
          <div v-for="item in sortedModelRanking" :key="item.model" class="model-ranking-entry">
            <button
              class="model-ranking-row"
              :aria-controls="`model-ranking-users-${modelRankingKey(item.model)}`"
              :aria-expanded="isModelRankingExpanded(item.model)"
              :title="isModelRankingExpanded(item.model) ? '收起用户用量' : '展开用户用量'"
              type="button"
              @click="toggleModelRanking(item.model)"
            >
              <span :title="item.model">{{ item.model }}</span>
              <strong>{{ formatRequestCount(item.requests) }}</strong>
              <strong>{{ formatTokenCount(item.tokens) }}</strong>
              <em>{{ formatCost(item.actualCost) }}</em>
              <ChevronUp v-if="isModelRankingExpanded(item.model)" :size="15" />
              <ChevronDown v-else :size="15" />
            </button>
            <div v-if="isModelRankingExpanded(item.model)" :id="`model-ranking-users-${modelRankingKey(item.model)}`" class="model-ranking-users">
              <div v-if="modelRankingUserState[modelRankingKey(item.model)] === 'loading'" class="ranking-model-empty">加载用户用量中...</div>
              <div v-else-if="modelRankingUserState[modelRankingKey(item.model)] === 'error'" class="ranking-model-empty">用户用量加载失败</div>
              <div v-else-if="sortedModelRankingUsers(item.model).length === 0" class="ranking-model-empty">暂无用户用量</div>
              <div v-for="user in sortedModelRankingUsers(item.model)" :key="`${item.model}-${user.userId ?? user.displayName}`" class="model-ranking-user-row">
                <span :title="user.displayName">{{ user.displayName }}</span>
                <strong>{{ formatRequestCount(user.requests) }}</strong>
                <strong>{{ formatTokenCount(user.tokens) }}</strong>
                <em>{{ formatCost(user.actualCost) }}</em>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      <div v-if="hasAdmin" class="account-details-box">
        <div class="account-details-header">
          <span class="account-details-title">
            <Users :size="16" />
            <span>账号信息</span>
          </span>
          <span class="pool-summary-badges">
            <span class="pool-summary-badge account-badge" title="账号：正常 / 限流中 / 错误 / 总数量">
              <Users :size="12" />
              <span>账号：</span>
              <strong class="account-counts">
                <button
                  class="account-filter account-status-filter normal"
                  :aria-pressed="selectedAccountStatus === 'normal'"
                  data-status="normal"
                  title="筛选正常账号"
                  type="button"
                  @click="setAccountStatusFilter('normal')"
                >{{ formattedPoolAccounts.active }}</button>
                <span class="account-separator">/</span>
                <button
                  class="account-filter account-status-filter limited"
                  :aria-pressed="selectedAccountStatus === 'limited'"
                  data-status="limited"
                  title="筛选限流中账号"
                  type="button"
                  @click="setAccountStatusFilter('limited')"
                >{{ formattedPoolAccounts.limited }}</button>
                <span class="account-separator">/</span>
                <button
                  class="account-filter account-status-filter error"
                  :aria-pressed="selectedAccountStatus === 'error'"
                  data-status="error"
                  title="筛选错误账号"
                  type="button"
                  @click="setAccountStatusFilter('error')"
                >{{ formattedPoolAccounts.error }}</button>
                <span class="account-separator">/</span>
                <button
                  class="account-filter account-status-filter total"
                  :aria-pressed="selectedAccountStatus === 'all'"
                  data-status="all"
                  title="显示全部账号"
                  type="button"
                  @click="setAccountStatusFilter('all')"
                >{{ formattedPoolAccounts.total }}</button>
              </strong>
            </span>
            <span class="pool-summary-badge capacity-badge" title="当前容量 / 总容量">
              <Network :size="12" />
              <span>容量：</span>
              <strong>{{ formattedPoolCapacity }}</strong>
            </span>
          </span>
          <button
            class="account-details-toggle"
            :aria-expanded="accountDetailsExpanded"
            :title="accountDetailsExpanded ? '收起账号详情' : '展开账号详情'"
            type="button"
            @click="toggleAccountDetails"
          >
          <ChevronUp v-if="accountDetailsExpanded" class="account-details-chevron" :size="16" />
          <ChevronDown v-else class="account-details-chevron" :size="16" />
          </button>
        </div>

        <div v-if="accountDetailsExpanded" class="account-details-list">
          <div v-if="filteredPoolAccountDetails.length === 0" class="empty-line">暂无符合条件的账号</div>
          <article
            v-for="item in filteredPoolAccountDetails"
            :key="`${item.rank}-${item.name}`"
            class="account-detail-card"
            :class="item.status"
          >
            <div class="account-detail-card__head">
              <span class="account-detail-card__identity">
                <b>#{{ item.priority ?? '--' }}</b>
                <span class="account-detail-card__name">{{ item.name }}</span>
              </span>
              <span class="account-status-pill" :class="item.status">{{ item.statusText }}</span>
            </div>
            <div class="account-detail-card__meta">
              <span class="account-today-stats">
                <span>金额 <strong>{{ formatFixedCost(item.sevenDayCost) }}</strong></span>
                <span>Token <strong>{{ formatCompactTokenCount(item.todayTokens) }}</strong></span>
              </span>
              <span class="account-schedule-stack">
                <span class="schedule-pill" :class="{ off: !item.schedulable }">
                  <i></i>
                  {{ item.scheduleText }}
                </span>
                <span class="account-capacity-pill" :class="{ active: (item.capacityUsed ?? 0) > 0 }">{{ item.capacityText }}</span>
              </span>
              <span class="usage-windows">
                <span v-if="item.usageWindows.length === 0" class="usage-window empty">无可用窗口</span>
                <span v-for="window in item.usageWindows" :key="window.type" class="usage-window">
                  <span class="usage-window-label">{{ window.type }}</span>
                  <span class="usage-window-bar">
                    <i
                      :class="formatAccountWindowClass(window.usedPercent)"
                      :style="{ width: formatAccountWindowWidth(window.usedPercent) }"
                    ></i>
                  </span>
                  <span>{{ formatAccountWindowText(window) }}</span>
                </span>
              </span>
            </div>
          </article>
        </div>
      </div>

      <div v-else class="empty-line">配置管理员 API Key 后显示系统监控列表</div>
    </section>
  </main>

  <main v-else class="personal-shell" :class="{ collapsed: personalCollapsed }">
    <button
      v-if="personalCollapsed"
      class="collapsed-orb"
      :class="poolStatusClass"
      :style="poolFillStyle"
      type="button"
      title="展开个人信息"
      @click="toggleCollapsedOrb"
      @mousedown="startCollapsedOrbDrag"
    >
      <span>{{ formattedFirstToken }}</span>
      <em>{{ formattedPoolRemaining }}</em>
    </button>

    <section v-else class="orb" @mousedown.self="startWindowDrag">
      <div class="orb__header" @mousedown.self="startWindowDrag">
        <div class="orb__identity">
          <div class="orb__status" :class="statusClass"></div>
          <span>个人信息</span>
        </div>
        <div class="orb__actions">
          <button class="icon-button" type="button" title="折叠到屏幕边缘" @click.stop="togglePersonalCollapsed">
            <PanelRightClose :size="15" />
          </button>
          <button class="icon-button" type="button" title="关闭个人悬浮球" @click.stop="hidePersonalOrb">
            <X :size="15" />
          </button>
        </div>
      </div>

      <div class="metric-row">
        <span class="metric-row__label">今日 Token</span>
        <strong>{{ formattedPersonalToday }}</strong>
      </div>
      <div class="metric-row">
        <span class="metric-row__label">首 Token</span>
        <strong>{{ formattedFirstToken }}</strong>
      </div>

      <div class="orb__footer">
        <span>{{ footerText }}</span>
        <button class="icon-button" type="button" title="刷新" :disabled="loading" @click.stop="refreshAll">
          <RefreshCw :class="{ spinning: loading }" :size="15" />
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  ListChecks,
  MonitorDot,
  Network,
  PanelRightClose,
  Power,
  RefreshCw,
  Settings,
  Users,
  X
} from 'lucide-vue-next'
import { fetchAdminModelUsageRanking, fetchAdminModelUserUsage, fetchAdminMonitorMetrics, fetchAdminUserModelUsage, fetchSub2apiMetrics } from '@/domain/sub2apiClient'
import {
  formatCost,
  formatFixedCost,
  formatFirstToken,
  formatPoolAccountCount,
  formatPoolCapacity,
  formatTokenCount,
  type AdminMonitorMetrics,
  type ModelUsageRankItem,
  type ModelUserUsageItem,
  type PoolAccountUsageWindow,
  type PoolAccountUsageWindowType,
  type PoolResetItem,
  type TokenOrbMetrics,
  type UserIdentityItem,
  type UserModelUsageItem,
  type UserTodayUsageRankItem
} from '@/domain/tokenMetrics'
import {
  aggregateUserModelUsage,
  buildStatusBarDisplayItems,
  type SelectedUserUsage,
  type StatusBarDisplayItem
} from '@/domain/statusBar'
import {
  hasAdminSettings,
  hasPersonalSettings,
  loadSettings,
  saveSettings,
  settingsStorageKey,
  type AppSettings,
  type StatusBarMetricKey
} from '@/domain/settings'

type TauriWindowApi = typeof import('@tauri-apps/api/window')

interface FloatingState {
  x: number | null
  y: number | null
  collapsed: boolean
  expandedX: number | null
  expandedY: number | null
}

type AccountStatusFilter = 'normal' | 'limited' | 'error' | 'all'
type RankingView = 'users' | 'models'
type ModelRankingSort = 'requests' | 'tokens' | 'cost'

const statusBarMetricOptions: Array<{ key: StatusBarMetricKey; label: string }> = [
  { key: 'todayUsage', label: '今日总消耗' },
  { key: 'totalUsage', label: '总消耗' },
  { key: 'capacity', label: '容量' },
  { key: 'poolSevenDayRemaining', label: '7 日号池剩余量' },
  { key: 'selectedUserUsage', label: '用户' }
]

const floatingStorageKey = 'token-orb-floating-v1'
const accountFilterStorageKey = 'token-orb-account-filter-v1'
const expandedSize = { width: 184, height: 132 }
const collapsedSize = { width: 44, height: 44 }
const settings = ref<AppSettings>(loadSettings())
const draft = reactive<AppSettings>(createSettingsDraft(settings.value))
const poolGroupNameInput = ref('')
const poolGroupInputRef = ref<HTMLInputElement | null>(null)
const personalMetrics = ref<TokenOrbMetrics>({ todayTokens: null, firstTokenMs: null, updatedAt: null })
const adminMetrics = ref<AdminMonitorMetrics>({
  todayTotalTokens: null,
  todayTotalCost: null,
  totalTokens: null,
  totalActualCost: null,
  totalAccountCost: null,
  totalStandardCost: null,
  averageDurationMs: null,
  activeUsers: null,
  poolRemainingPercent: null,
  poolLatestResetAt: null,
  poolResetItems: [],
  poolAccounts: null,
  poolCapacity: null,
  poolAccountDetails: [],
  userRanking: [],
  updatedAt: null
})
const selectedUserUsage = ref<SelectedUserUsage | null>(null)
const view = new URLSearchParams(window.location.search).get('view') ?? 'personal'
const isSettingsView = view === 'settings'
const isPlatformView = view === 'platform'
const isUpdaterView = view === 'updater'
const isTrayMenuView = view === 'tray-menu'
const isMainView = !isSettingsView && !isPlatformView && !isUpdaterView && !isTrayMenuView
const isStatusBarPublisher = isMainView || isPlatformView
const loading = ref(false)
const errorMessage = ref('')
const saveMessage = ref('')
const personalTokenTesting = ref(false)
const personalTokenTestState = ref<'success' | 'error' | ''>('')
const personalTokenTestMessage = ref('')
const personalCollapsed = ref(false)
const personalOrbDismissed = ref(false)
const accountDetailsExpanded = ref(true)
const rankingExpanded = ref(true)
const selectedAccountStatus = ref<AccountStatusFilter>(loadAccountStatusFilter())
const monitorPanelRef = ref<HTMLElement | null>(null)
const poolWindowType = ref<PoolAccountUsageWindowType>('7d')
const rankingMode = ref<'tokens' | 'cost'>('tokens')
const rankingView = ref<RankingView>('users')
const modelRankingSort = ref<ModelRankingSort>('tokens')
const modelRanking = ref<ModelUsageRankItem[]>([])
const modelRankingState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const expandedModelRankingKeys = ref<string[]>([])
const modelRankingUsers = ref<Record<string, ModelUserUsageItem[]>>({})
const modelRankingUserState = ref<Record<string, 'loading' | 'ready' | 'error'>>({})
const expandedRankingUserKeys = ref<string[]>([])
const rankingModelUsage = ref<Record<string, UserModelUsageItem[]>>({})
const rankingModelUsageState = ref<Record<string, 'loading' | 'ready' | 'error'>>({})
const platformUpdateAvailable = ref(false)
const updatePanelRef = ref<HTMLElement | null>(null)
const appVersion = ref('0.1.0')
const updateVersion = ref('')
const updateBody = ref('')
const updateState = ref<'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'installed' | 'error'>('idle')
const updateMessage = ref('点击重新检查获取最新版本。')
const downloadPercent = ref<number | null>(null)
let availableUpdate: import('@tauri-apps/plugin-updater').Update | null = null
let timer: number | null = null
let platformUpdateTimer: number | null = null
let saveMessageTimer: number | null = null
const rankingModelUsageRequestEpochs = new Map<string, number>()
let modelRankingRefreshEpoch = 0
let unlistenMoved: (() => void) | null = null
let unlistenSettingsChanged: (() => void) | null = null
let unlistenPlatformUpdateCheck: (() => void) | null = null
let tauriWindowApi: TauriWindowApi | null = null
let floatingWindowInitialized = false
let checkingPlatformUpdate = false
let adminRefreshEpoch = 0
let collapsedDragStarted = false
let collapsedDragStartAt = 0

const platformUpdateCheckIntervalMs = 5 * 60 * 1000

const hasAdmin = computed(() => hasAdminSettings(settings.value))
const hasPersonal = computed(() => hasPersonalSettings(settings.value))
const formattedPersonalToday = computed(() => formatTokenCount(personalMetrics.value.todayTokens))
const formattedFirstToken = computed(() => formatFirstToken(personalMetrics.value.firstTokenMs))
const formattedAdminToday = computed(() => formatTokenCount(adminMetrics.value.todayTotalTokens))
const formattedAdminTodayCost = computed(() => formatCost(adminMetrics.value.todayTotalCost))
const formattedAdminTotal = computed(() => formatTokenCount(adminMetrics.value.totalTokens ?? null))
const formattedAdminTotalActualCost = computed(() => formatCost(adminMetrics.value.totalActualCost ?? null))
const formattedAverageDuration = computed(() => formatDuration(adminMetrics.value.averageDurationMs ?? null))
const formattedActiveUsers = computed(() => adminMetrics.value.activeUsers == null ? '活跃用户 --' : `${formatRequestCount(adminMetrics.value.activeUsers)} 活跃用户`)
const formattedPoolAccounts = computed(() => formatPoolAccountCount(adminMetrics.value.poolAccounts))
const formattedPoolCapacity = computed(() => formatPoolCapacity(adminMetrics.value.poolCapacity))
const formattedPoolRemaining = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent
  return value === null ? '--' : `${Math.round(value)}%`
})
const formattedPoolLatestReset = computed(() => formatResetRemain(adminMetrics.value.poolLatestResetAt))
const formattedPoolResetItems = computed(() => adminMetrics.value.poolResetItems.map(formatPoolResetItem))
const selectedPoolWindowLabel = computed(() => poolWindowType.value === '7d' ? '7日' : '5小时')
const selectedPoolRemainingPercent = computed(() => poolWindowType.value === '7d'
  ? adminMetrics.value.poolSevenDayRemainingPercent ?? null
  : adminMetrics.value.poolRemainingPercent)
const formattedSelectedPoolRemaining = computed(() => {
  const value = selectedPoolRemainingPercent.value
  return value === null ? '--' : `${Math.round(value)}%`
})
const formattedSelectedPoolLatestReset = computed(() => formatResetRemain(poolWindowType.value === '7d'
  ? adminMetrics.value.poolSevenDayLatestResetAt ?? null
  : adminMetrics.value.poolLatestResetAt))
const formattedSelectedPoolResetItems = computed(() => (poolWindowType.value === '7d'
  ? adminMetrics.value.poolSevenDayResetItems ?? []
  : adminMetrics.value.poolResetItems).map(formatPoolResetItem))
const displayedUserRanking = computed(() => sortUserRanking(adminMetrics.value.userRanking, rankingMode.value))
const sortedModelRanking = computed(() => sortModelRanking(modelRanking.value, modelRankingSort.value))
const statusBarUserOptions = computed(() => (adminMetrics.value.userIdentities ?? []).map((user) => ({
  id: user.id,
  label: formatUserIdentityLabel(user)
})))
const draftStatusBarUserExists = computed(() => draft.statusBarUserId === null
  || statusBarUserOptions.value.some((user) => user.id === draft.statusBarUserId))
const draftStatusBarItems = computed(() => buildStatusBarDisplayItems(
  draft,
  adminMetrics.value,
  draft.statusBarUserId === settings.value.statusBarUserId ? selectedUserUsage.value : null
))
const statusBarItems = computed(() => buildStatusBarDisplayItems(settings.value, adminMetrics.value, selectedUserUsage.value))
const filteredPoolAccountDetails = computed(() => {
  if (selectedAccountStatus.value === 'all') return adminMetrics.value.poolAccountDetails
  return adminMetrics.value.poolAccountDetails.filter((item) => item.status === selectedAccountStatus.value)
})
const poolProgressWidth = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent
  if (value === null || Number.isNaN(value)) return '0%'
  return `${Math.min(100, Math.max(0, value))}%`
})
const poolStatusClass = computed(() => {
  const value = adminMetrics.value.poolRemainingPercent
  if (value === null || Number.isNaN(value)) return 'unknown'
  if (value < 10) return 'danger'
  if (value < 20) return 'warning'
  return 'healthy'
})
const selectedPoolProgressWidth = computed(() => {
  const value = selectedPoolRemainingPercent.value
  if (value === null || Number.isNaN(value)) return '0%'
  return `${Math.min(100, Math.max(0, value))}%`
})
const selectedPoolStatusClass = computed(() => {
  const value = selectedPoolRemainingPercent.value
  if (value === null || Number.isNaN(value)) return 'unknown'
  if (value < 10) return 'danger'
  if (value < 20) return 'warning'
  return 'healthy'
})
const poolFillStyle = computed(() => {
  const colorMap = {
    healthy: '#20e3b2',
    warning: '#f59e0b',
    danger: '#fb4d5f',
    unknown: '#64748b'
  }
  return {
    '--fill-level': poolProgressWidth.value,
    '--fill-color': colorMap[poolStatusClass.value]
  }
})
const statusClass = computed(() => {
  if (!hasAdmin.value && !hasPersonal.value) return 'idle'
  return errorMessage.value ? 'error' : 'online'
})
const footerText = computed(() => {
  if (!hasAdmin.value && !hasPersonal.value) return '待配置'
  if (errorMessage.value) return '连接异常'
  const updatedAt = personalMetrics.value.updatedAt || adminMetrics.value.updatedAt
  if (!updatedAt) return '待刷新'
  return new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
})
const platformUpdatedText = computed(() => {
  const updatedAt = adminMetrics.value.updatedAt || personalMetrics.value.updatedAt
  if (!updatedAt) return '待刷新'
  return new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
})
const updateBusy = computed(() => updateState.value === 'checking' || updateState.value === 'downloading')

async function refreshAll() {
  if (!hasAdmin.value && !hasPersonal.value) {
    selectedUserUsage.value = null
    await updateTrayStatus()
    return
  }
  loading.value = true
  errorMessage.value = ''
  const errors: string[] = []
  let successCount = 0
  try {
    if (hasAdmin.value) {
      try {
        await refreshAdmin()
        successCount += 1
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '管理员 API 请求失败')
      }
    }
    if (hasPersonal.value) {
      try {
        await refreshPersonal()
        successCount += 1
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '个人 JWT 请求失败')
      }
    }
    if (errors.length > 0 && successCount === 0) {
      errorMessage.value = errors[0] || '请求失败'
    }
  } finally {
    loading.value = false
    await updateTrayStatus()
  }
}

async function refreshPersonal() {
  if (!hasPersonal.value) return
  personalMetrics.value = await fetchSub2apiMetrics({
    baseUrl: settings.value.sub2apiBaseUrl,
    token: settings.value.personalToken
  })
}

async function refreshAdmin() {
  if (!hasAdmin.value) return
  const refreshEpoch = ++adminRefreshEpoch
  const adminRequest = fetchAdminMonitorMetrics({
    baseUrl: settings.value.sub2apiBaseUrl,
    apiKey: settings.value.adminApiKey,
    poolGroupNames: settings.value.poolGroupNames
  })
  const selectedUserId = settings.value.statusBarMetrics.includes('selectedUserUsage')
    ? settings.value.statusBarUserId
    : null
  const selectedUserRequest = selectedUserId === null
    ? Promise.resolve(null)
    : fetchAdminUserModelUsage({
        baseUrl: settings.value.sub2apiBaseUrl,
        apiKey: settings.value.adminApiKey
      }, selectedUserId).catch(() => null)

  const [nextAdminMetrics, selectedUserModels] = await Promise.all([adminRequest, selectedUserRequest])
  if (refreshEpoch !== adminRefreshEpoch) return
  adminMetrics.value = nextAdminMetrics
  if (selectedUserId !== null && selectedUserModels !== null) {
    selectedUserUsage.value = {
      ...aggregateUserModelUsage(selectedUserModels)
    }
  } else if (selectedUserId !== null) {
    const rankingUsage = nextAdminMetrics.userRanking.find((item) => item.userId === selectedUserId)
    selectedUserUsage.value = rankingUsage
      ? { tokens: rankingUsage.tokens, actualCost: rankingUsage.actualCost }
      : null
  } else {
    selectedUserUsage.value = null
  }
  // 人员榜刷新后在后台更新已展开的模型明细，避免跨天或持续运行时展示旧快照。
  const expandedUsers = adminMetrics.value.userRanking.filter((item) => isRankingUserExpanded(item))
  void Promise.allSettled(expandedUsers.map((item) => loadRankingUserModels(item, true)))
  if (rankingView.value === 'models') void loadModelRanking()
}

function showUserRanking(mode: 'tokens' | 'cost') {
  rankingView.value = 'users'
  rankingMode.value = mode
  void resizePlatformWindowToContent()
}

function toggleRanking() {
  rankingExpanded.value = !rankingExpanded.value
}

async function showModelRanking() {
  rankingView.value = 'models'
  modelRankingSort.value = 'tokens'
  if (modelRankingState.value === 'idle') await loadModelRanking()
  void resizePlatformWindowToContent()
}

async function loadModelRanking() {
  if (!hasAdmin.value || modelRankingState.value === 'loading') return
  const refreshEpoch = ++modelRankingRefreshEpoch
  modelRankingState.value = 'loading'
  try {
    const items = await fetchAdminModelUsageRanking({
      baseUrl: settings.value.sub2apiBaseUrl,
      apiKey: settings.value.adminApiKey
    })
    if (refreshEpoch !== modelRankingRefreshEpoch) return
    modelRanking.value = items
    modelRankingState.value = 'ready'
  } catch {
    if (refreshEpoch !== modelRankingRefreshEpoch) return
    modelRankingState.value = 'error'
  } finally {
    void resizePlatformWindowToContent()
  }
}

function modelRankingKey(model: string): string {
  return model
}

function isModelRankingExpanded(model: string): boolean {
  return expandedModelRankingKeys.value.includes(modelRankingKey(model))
}

async function toggleModelRanking(model: string) {
  const key = modelRankingKey(model)
  if (isModelRankingExpanded(model)) {
    expandedModelRankingKeys.value = expandedModelRankingKeys.value.filter((value) => value !== key)
    void resizePlatformWindowToContent()
    return
  }

  expandedModelRankingKeys.value = [...expandedModelRankingKeys.value, key]
  if (modelRankingUserState.value[key]) {
    void resizePlatformWindowToContent()
    return
  }

  const refreshEpoch = modelRankingRefreshEpoch
  modelRankingUserState.value = { ...modelRankingUserState.value, [key]: 'loading' }
  void resizePlatformWindowToContent()
  try {
    const users = await fetchAdminModelUserUsage({
      baseUrl: settings.value.sub2apiBaseUrl,
      apiKey: settings.value.adminApiKey
    }, model, adminMetrics.value.userIdentities ?? [])
    if (refreshEpoch === modelRankingRefreshEpoch) {
      modelRankingUsers.value = { ...modelRankingUsers.value, [key]: users }
      modelRankingUserState.value = { ...modelRankingUserState.value, [key]: 'ready' }
    }
  } catch {
    if (refreshEpoch === modelRankingRefreshEpoch) {
      modelRankingUserState.value = { ...modelRankingUserState.value, [key]: 'error' }
    }
  } finally {
    void resizePlatformWindowToContent()
  }
}

function rankingUserKey(item: UserTodayUsageRankItem): string {
  return item.userId === null ? item.displayName : String(item.userId)
}

function isRankingUserExpanded(item: UserTodayUsageRankItem): boolean {
  return expandedRankingUserKeys.value.includes(rankingUserKey(item))
}

async function toggleRankingUser(item: UserTodayUsageRankItem) {
  const key = rankingUserKey(item)
  if (isRankingUserExpanded(item)) {
    expandedRankingUserKeys.value = expandedRankingUserKeys.value.filter((value) => value !== key)
    void resizePlatformWindowToContent()
    return
  }

  expandedRankingUserKeys.value = [...expandedRankingUserKeys.value, key]
  await loadRankingUserModels(item)
  void resizePlatformWindowToContent()
}

async function loadRankingUserModels(item: UserTodayUsageRankItem, force = false) {
  const key = rankingUserKey(item)
  const state = rankingModelUsageState.value[key]
  if (item.userId === null || (!force && (state === 'loading' || state === 'ready'))) return

  const preserveExisting = force && rankingModelUsage.value[key] !== undefined
  if (!preserveExisting) {
    rankingModelUsageState.value = { ...rankingModelUsageState.value, [key]: 'loading' }
  }
  const requestEpoch = (rankingModelUsageRequestEpochs.get(key) ?? 0) + 1
  rankingModelUsageRequestEpochs.set(key, requestEpoch)
  void resizePlatformWindowToContent()
  try {
    const models = await fetchAdminUserModelUsage({
      baseUrl: settings.value.sub2apiBaseUrl,
      apiKey: settings.value.adminApiKey
    }, item.userId)
    if (rankingModelUsageRequestEpochs.get(key) === requestEpoch) {
      rankingModelUsage.value = { ...rankingModelUsage.value, [key]: models }
      rankingModelUsageState.value = { ...rankingModelUsageState.value, [key]: 'ready' }
    }
  } catch {
    if (rankingModelUsageRequestEpochs.get(key) === requestEpoch) {
      rankingModelUsageState.value = {
        ...rankingModelUsageState.value,
        [key]: preserveExisting ? 'ready' : 'error'
      }
    }
  } finally {
    void resizePlatformWindowToContent()
  }
}

function toggleAccountDetails() {
  accountDetailsExpanded.value = !accountDetailsExpanded.value
}

function loadAccountStatusFilter(): AccountStatusFilter {
  const storedStatus = localStorage.getItem(accountFilterStorageKey)
  return storedStatus === 'normal' || storedStatus === 'limited' || storedStatus === 'error' || storedStatus === 'all'
    ? storedStatus
    : 'all'
}

function setAccountStatusFilter(status: AccountStatusFilter) {
  selectedAccountStatus.value = status
  localStorage.setItem(accountFilterStorageKey, status)
}

function formatAccountWindowWidth(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '0%'
  return `${Math.min(100, Math.max(0, Math.round(value)))}%`
}

function formatAccountWindowClass(value: number | null): '' | 'warning' | 'danger' {
  if (value === null || Number.isNaN(value)) return ''
  const used = Math.min(100, Math.max(0, value))
  if (used >= 100) return 'danger'
  if (used > 80) return 'warning'
  return ''
}

function formatRequestCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

function formatDuration(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value >= 1_000) {
    const seconds = (value / 1_000).toFixed(2).replace(/\.?0+$/, '')
    return `${seconds}s`
  }
  return `${Math.round(value)}ms`
}

function formatCompactTokenCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  if (value >= 1_000_000_000) return `${formatCompactNumber(value / 1_000_000_000)}B`
  if (value >= 1_000_000) return `${formatCompactNumber(value / 1_000_000)}M`
  if (value >= 1_000) return `${formatCompactNumber(value / 1_000)}K`
  return formatCompactNumber(value)
}

function formatCompactNumber(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

function sortUserRanking(items: UserTodayUsageRankItem[], mode: 'tokens' | 'cost'): UserTodayUsageRankItem[] {
  return [...items].sort((left, right) => {
    if (mode === 'cost') {
      const costDiff = (right.actualCost ?? 0) - (left.actualCost ?? 0)
      if (costDiff !== 0) return costDiff
    }

    const tokenDiff = right.tokens - left.tokens
    if (tokenDiff !== 0) return tokenDiff
    return (left.userId ?? 0) - (right.userId ?? 0)
  })
}

function sortedRankingModelUsage(item: UserTodayUsageRankItem): UserModelUsageItem[] {
  return sortModelUsage(rankingModelUsage.value[rankingUserKey(item)] ?? [], rankingMode.value)
}

function sortModelUsage(items: UserModelUsageItem[], mode: 'tokens' | 'cost'): UserModelUsageItem[] {
  return [...items].sort((left, right) => {
    if (mode === 'cost') {
      const costDiff = (right.actualCost ?? 0) - (left.actualCost ?? 0)
      if (costDiff !== 0) return costDiff
    }

    const tokenDiff = right.tokens - left.tokens
    if (tokenDiff !== 0) return tokenDiff
    return left.model.localeCompare(right.model)
  })
}

function sortModelRanking(items: ModelUsageRankItem[], mode: ModelRankingSort): ModelUsageRankItem[] {
  return [...items].sort((left, right) => compareUsageRows(left, right, mode, left.model, right.model))
}

function sortedModelRankingUsers(model: string): ModelUserUsageItem[] {
  return [...(modelRankingUsers.value[modelRankingKey(model)] ?? [])]
    .sort((left, right) => compareUsageRows(left, right, modelRankingSort.value, left.displayName, right.displayName))
}

function compareUsageRows(
  left: Pick<ModelUsageRankItem, 'requests' | 'tokens' | 'actualCost'>,
  right: Pick<ModelUsageRankItem, 'requests' | 'tokens' | 'actualCost'>,
  mode: ModelRankingSort,
  leftName: string,
  rightName: string
): number {
  if (mode === 'requests') {
    const requestDiff = right.requests - left.requests
    if (requestDiff !== 0) return requestDiff
  }
  if (mode === 'cost') {
    const costDiff = (right.actualCost ?? 0) - (left.actualCost ?? 0)
    if (costDiff !== 0) return costDiff
  }
  const tokenDiff = right.tokens - left.tokens
  if (tokenDiff !== 0) return tokenDiff
  return leftName.localeCompare(rightName)
}

function formatAccountWindowText(item: PoolAccountUsageWindow): string {
  const used = Math.round(item.usedPercent)
  const resetRemain = formatUsageWindowRemain(item.resetAt)
  return resetRemain === '--' ? `使用量 ${used}%` : `使用量 ${used}% · ${resetRemain}`
}

function formatUsageWindowRemain(value: string | null): string {
  if (!value) return '--'
  const resetAt = Date.parse(value)
  if (!Number.isFinite(resetAt)) return '--'
  const remainingMs = resetAt - Date.now()
  if (remainingMs <= 0) return '现在'
  const totalMinutes = Math.ceil(remainingMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

async function initUpdaterView() {
  if (!isUpdaterView) return
  await initAppVersion()

  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      await listen('token-orb-check-update', () => {
        void checkForAppUpdate()
      })
    } catch {
      // 事件监听失败时仍允许手动点击检查。
    }
  }

  await checkForAppUpdate()
}

async function initAppVersion() {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    appVersion.value = await getVersion()
  } catch {
    appVersion.value = '0.1.0'
  }
}

async function checkForAppUpdate() {
  updateState.value = 'checking'
  updateMessage.value = '正在检查更新...'
  updateVersion.value = ''
  updateBody.value = ''
  downloadPercent.value = null
  availableUpdate = null

  if (!('__TAURI_INTERNALS__' in window)) {
    updateState.value = 'error'
    updateMessage.value = 'Web 调试模式不支持在线更新，请在桌面应用中检查。'
    return
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      updateState.value = 'latest'
      updateMessage.value = '当前已经是最新版本。'
      return
    }

    availableUpdate = update
    updateVersion.value = update.version
    updateBody.value = update.body || '暂无更新说明。'
    updateState.value = 'available'
    updateMessage.value = '发现新版本，可以立即更新。'
  } catch (error) {
    updateState.value = 'error'
    updateMessage.value = error instanceof Error ? error.message : '检查更新失败'
  }
}

async function checkPlatformUpdate() {
  if ((!isPlatformView && !isTrayMenuView) || !('__TAURI_INTERNALS__' in window) || checkingPlatformUpdate) return
  checkingPlatformUpdate = true
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    platformUpdateAvailable.value = (await check()) !== null
  } catch {
    // 网络短暂失败时保留已发现的更新，下一轮定时检查会再次确认。
  } finally {
    checkingPlatformUpdate = false
  }
}

function schedulePlatformUpdateChecks() {
  if (!isPlatformView || !('__TAURI_INTERNALS__' in window)) return
  if (platformUpdateTimer !== null) window.clearInterval(platformUpdateTimer)
  platformUpdateTimer = window.setInterval(() => {
    void checkPlatformUpdate()
  }, platformUpdateCheckIntervalMs)
}

async function listenForPlatformUpdateChecks() {
  if (!isPlatformView || !('__TAURI_INTERNALS__' in window)) return
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenPlatformUpdateCheck = await listen('token-orb-check-platform-update', () => {
      void checkPlatformUpdate()
    })
  } catch {
    // 首次挂载仍会检测；事件监听失败只影响窗口再次显示时的自动重检。
  }
}

async function initRuntimeListenersAndUpdateStatus() {
  await listenForSettingsChanges()
  await listenForPlatformUpdateChecks()
  schedulePlatformUpdateChecks()
  await checkPlatformUpdate()
}

async function runTrayCommand(command: 'monitor' | 'settings' | 'update' | 'quit') {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('tray_command', { command })
  } catch {
    // 菜单命令失败时保留窗口，方便用户重试。
  }
}

async function resizePlatformWindowToContent() {
  if (!isPlatformView) return
  await nextTick()
  const height = monitorPanelRef.value?.scrollHeight
  if (!height) return
  try {
    const api = await loadTauriWindowApi()
    if (!api) return
    await api.getCurrentWindow().setSize(new api.LogicalSize(410, height))
  } catch {
    return
  }
}

async function resizeUpdaterWindowToContent() {
  if (!isUpdaterView) return
  await nextTick()
  const panelHeight = updatePanelRef.value?.scrollHeight
  if (!panelHeight) return
  try {
    const api = await loadTauriWindowApi()
    if (!api) return
    await api.getCurrentWindow().setSize(new api.LogicalSize(420, panelHeight + 36))
  } catch {
    return
  }
}

async function openUpdateWindow() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('token-orb-open-update')
  } catch {
    // 更新窗口打开失败时保留平台页，不影响监控数据展示。
  }
}

async function openReleaseNotes() {
  const version = updateVersion.value || appVersion.value
  const releaseUrl = `https://github.com/tangjiale/token-orb/releases/tag/v${version}`
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(releaseUrl)
  } catch {
    window.open(releaseUrl, '_blank', 'noopener,noreferrer')
  }
}

async function installAppUpdate() {
  if (!availableUpdate) return
  updateState.value = 'downloading'
  updateMessage.value = '正在下载更新...'
  downloadPercent.value = 0
  let downloaded = 0
  let total = 0

  try {
    await availableUpdate.download((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0
        downloaded = 0
      }
      if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        downloadPercent.value = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
      }
      if (event.event === 'Finished') {
        downloadPercent.value = 100
        updateMessage.value = '下载完成，正在安装...'
      }
    })
    await availableUpdate.install()
    updateState.value = 'installed'
    updateMessage.value = '更新已安装，点击重启完成更新。'
  } catch (error) {
    updateState.value = 'error'
    updateMessage.value = error instanceof Error ? error.message : '更新安装失败'
  }
}

async function restartApp() {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

function saveDraft() {
  addPoolGroupName()
  settings.value = saveSettings({ ...draft })
  syncSettingsDraft(settings.value)
  personalTokenTestMessage.value = ''
  personalTokenTestState.value = ''
  showSaveMessage()
  scheduleRefresh()
  void refreshAll()
  void notifySettingsChanged()
}

function formatUserIdentityLabel(user: UserIdentityItem, includeEmail = true): string {
  const username = user.username.trim()
  const email = user.email.trim()
  if (!includeEmail) return username || `用户 #${user.id}`
  if (includeEmail && username && email) return `${username}（${email}）`
  return username || email || `用户 #${user.id}`
}

async function testPersonalToken() {
  const baseUrl = draft.sub2apiBaseUrl.trim()
  const token = draft.personalToken.trim()
  personalTokenTestMessage.value = ''
  personalTokenTestState.value = ''
  if (!baseUrl) {
    personalTokenTestState.value = 'error'
    personalTokenTestMessage.value = '请先填写 Base URL'
    return
  }
  if (!token) {
    personalTokenTestState.value = 'error'
    personalTokenTestMessage.value = '请先填写个人 JWT'
    return
  }

  personalTokenTesting.value = true
  try {
    await fetchSub2apiMetrics({ baseUrl, token })
    personalTokenTestState.value = 'success'
    personalTokenTestMessage.value = '个人 JWT 正常'
  } catch (error) {
    personalTokenTestState.value = 'error'
    personalTokenTestMessage.value = formatErrorMessage(error, '个人 JWT 测试失败')
  } finally {
    personalTokenTesting.value = false
  }
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  if (typeof error === 'string' && error.trim() !== '') return error.trim()
  return fallback
}

function showSaveMessage() {
  saveMessage.value = '配置已保存'
  if (saveMessageTimer !== null) window.clearTimeout(saveMessageTimer)
  saveMessageTimer = window.setTimeout(() => {
    saveMessage.value = ''
    saveMessageTimer = null
  }, 2400)
}

function syncExternalSettingsChange(event: StorageEvent) {
  if (isUpdaterView) return
  if (event.key !== settingsStorageKey || event.newValue === null) return
  applyLatestSettings()
}

function applyLatestSettings() {
  settings.value = loadSettings()
  syncSettingsDraft(settings.value)
  scheduleRefresh()
  void refreshAll()
  void updateTrayStatus()
  void initFloatingWindow()
}

async function notifySettingsChanged() {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('token-orb-settings-updated')
  } catch {
    // 浏览器 storage 事件仍作为非桌面环境的同步兜底。
  }
}

async function listenForSettingsChanges() {
  if (isSettingsView || isUpdaterView || !('__TAURI_INTERNALS__' in window)) return
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenSettingsChanged = await listen('token-orb-settings-updated', applyLatestSettings)
  } catch {
    // Tauri 事件不可用时保留浏览器 storage 事件同步。
  }
}

function createSettingsDraft(source: AppSettings): AppSettings {
  return {
    ...source,
    poolGroupNames: [...source.poolGroupNames],
    statusBarMetrics: [...source.statusBarMetrics]
  }
}

async function updateTrayStatus() {
  if (!isStatusBarPublisher || !('__TAURI_INTERNALS__' in window)) return
  const items = statusBarItems.value
  const shouldReset = items.length === 0 || !hasAdmin.value
  if (!shouldReset && adminMetrics.value.updatedAt === null) return
  const tooltip = items.length === 0
    ? 'Token Orb'
    : items.map((item) => `${item.topText} ${item.bottomText}`).join(' | ')
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_tray_status_image', {
      image: shouldReset ? null : renderStatusBarImage(items),
      tooltip: shouldReset ? 'Token Orb' : tooltip
    })
  } catch {
    // 状态栏更新失败不应影响监控数据刷新。
  }
}

function renderStatusBarImage(items: StatusBarDisplayItem[]): { rgba: number[]; width: number; height: number } | null {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null

  const height = 36
  const horizontalPadding = 8
  const orbWidth = 24
  const columnGap = 14
  const statusBarFont = '700 15px -apple-system, BlinkMacSystemFont, sans-serif'
  context.font = statusBarFont
  const itemWidths = items.map((item) => Math.max(
    context.measureText(item.topText).width,
    measureStatusBarText(context, item.bottomText, statusBarFont)
  ) + 8)
  const width = Math.min(1024, Math.ceil(horizontalPadding * 2 + orbWidth + itemWidths.reduce((sum, value) => sum + value, 0) + columnGap * Math.max(0, items.length - 1)))
  canvas.width = width
  canvas.height = height
  context.clearRect(0, 0, width, height)
  const prefersDark = typeof window.matchMedia !== 'function'
    || window.matchMedia('(prefers-color-scheme: dark)').matches
  const foreground = prefersDark ? '#ffffff' : '#111827'
  context.fillStyle = foreground

  context.beginPath()
  context.arc(12, 18, 7, 0, Math.PI * 2)
  context.lineWidth = 3
  context.strokeStyle = foreground
  context.stroke()
  context.beginPath()
  context.arc(12, 18, 2.2, 0, Math.PI * 2)
  context.fill()

  let x = horizontalPadding + orbWidth
  for (const [index, item] of items.entries()) {
    if (x >= width - horizontalPadding) break
    const availableWidth = Math.max(0, Math.min(itemWidths[index], width - horizontalPadding - x))
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    context.font = statusBarFont
    context.fillText(item.topText, x + availableWidth / 2, 14, availableWidth)
    context.fillText(item.bottomText, x + availableWidth / 2, 31, availableWidth)
    x += availableWidth + columnGap
  }

  return {
    rgba: Array.from(context.getImageData(0, 0, width, height).data),
    width,
    height
  }
}

function measureStatusBarText(context: CanvasRenderingContext2D, text: string, font: string): number {
  const previousFont = context.font
  context.font = font
  const width = context.measureText(text).width
  context.font = previousFont
  return width
}

function syncSettingsDraft(source: AppSettings) {
  Object.assign(draft, createSettingsDraft(source))
}

function addPoolGroupName() {
  const name = poolGroupNameInput.value.trim()
  if (!name) return
  if (!draft.poolGroupNames.includes(name)) {
    draft.poolGroupNames.push(name)
  }
  draft.poolGroupName = draft.poolGroupNames[0] ?? ''
  poolGroupNameInput.value = ''
}

function removePoolGroupName(name: string) {
  draft.poolGroupNames = draft.poolGroupNames.filter((item) => item !== name)
  draft.poolGroupName = draft.poolGroupNames[0] ?? ''
}

function removeLastPoolGroupNameWhenEmpty() {
  if (poolGroupNameInput.value !== '' || draft.poolGroupNames.length === 0) return
  draft.poolGroupNames.pop()
  draft.poolGroupName = draft.poolGroupNames[0] ?? ''
}

function focusPoolGroupInput() {
  poolGroupInputRef.value?.focus()
}

function scheduleRefresh() {
  if (timer !== null) window.clearInterval(timer)
  timer = window.setInterval(refreshAll, settings.value.refreshSeconds * 1000)
}

async function startWindowDrag() {
  if (isSettingsView || isPlatformView) return
  const api = await loadTauriWindowApi()
  if (!api) return
  await api.getCurrentWindow().startDragging()
}

async function startCollapsedOrbDrag(event: MouseEvent) {
  if (event.button !== 0) return
  collapsedDragStarted = false
  collapsedDragStartAt = Date.now()
  const markDragged = () => {
    collapsedDragStarted = true
  }
  window.addEventListener('mousemove', markDragged, { once: true })
  window.setTimeout(() => {
    window.removeEventListener('mousemove', markDragged)
  }, 220)
  await startWindowDrag()
}

function toggleCollapsedOrb() {
  if (collapsedDragStarted || Date.now() - collapsedDragStartAt > 220) {
    collapsedDragStarted = false
    return
  }
  void togglePersonalCollapsed()
}

async function togglePersonalCollapsed() {
  const api = await loadTauriWindowApi()
  if (!api) {
    personalCollapsed.value = !personalCollapsed.value
    return
  }

  const appWindow = api.getCurrentWindow()
  const state = loadFloatingState()
  const monitor = await api.currentMonitor()
  const monitorX = monitor?.position.x ?? 0
  const monitorWidth = monitor?.size.width ?? 1440
  const scaleFactor = await appWindow.scaleFactor()
  const expandedPhysicalWidth = expandedSize.width * scaleFactor
  const collapsedPhysicalWidth = collapsedSize.width * scaleFactor
  const position = await appWindow.outerPosition()

  if (!personalCollapsed.value) {
    const edgeX = position.x + expandedPhysicalWidth / 2 < monitorX + monitorWidth / 2 ? monitorX : monitorX + monitorWidth - collapsedPhysicalWidth
    await appWindow.setSize(new api.LogicalSize(collapsedSize.width, collapsedSize.height))
    await appWindow.setPosition(new api.PhysicalPosition(edgeX, position.y))
    personalCollapsed.value = true
    saveFloatingState({ ...state, collapsed: true, expandedX: position.x, expandedY: position.y, x: edgeX, y: position.y })
    return
  }

  const fallbackX = position.x <= monitorX + 4 ? monitorX : monitorX + monitorWidth - expandedPhysicalWidth
  const nextX = state.expandedX ?? fallbackX
  const nextY = state.expandedY ?? position.y
  await appWindow.setSize(new api.LogicalSize(expandedSize.width, expandedSize.height))
  await appWindow.setPosition(new api.PhysicalPosition(nextX, nextY))
  personalCollapsed.value = false
  saveFloatingState({ ...state, collapsed: false, x: nextX, y: nextY })
}

async function hidePersonalOrb() {
  const api = await loadTauriWindowApi()
  if (!api) return
  await api.getCurrentWindow().hide()
  personalOrbDismissed.value = true
}

async function initFloatingWindow() {
  if (isSettingsView || isPlatformView) return
  const api = await loadTauriWindowApi()
  if (!api) return
  const appWindow = api.getCurrentWindow()
  if (!settings.value.personalFloatingEnabled) {
    personalOrbDismissed.value = false
    await appWindow.hide()
    return
  }
  if (personalOrbDismissed.value) return

  if (floatingWindowInitialized) {
    await appWindow.show()
    return
  }

  const state = loadFloatingState()
  personalCollapsed.value = state.collapsed
  await appWindow.setShadow(false)

  if (state.collapsed) {
    await appWindow.setSize(new api.LogicalSize(collapsedSize.width, collapsedSize.height))
  } else {
    await appWindow.setSize(new api.LogicalSize(expandedSize.width, expandedSize.height))
  }

  if (typeof state.x === 'number' && typeof state.y === 'number') {
    await appWindow.setPosition(new api.PhysicalPosition(state.x, state.y))
  }

  unlistenMoved = await appWindow.onMoved((event) => {
    const current = loadFloatingState()
    if (personalCollapsed.value) {
      saveFloatingState({ ...current, x: event.payload.x, y: event.payload.y })
      return
    }
    saveFloatingState({
      ...current,
      x: event.payload.x,
      y: event.payload.y,
      expandedX: event.payload.x,
      expandedY: event.payload.y
    })
  })
  floatingWindowInitialized = true
  await appWindow.show()
}

async function loadTauriWindowApi(): Promise<TauriWindowApi | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null
  if (tauriWindowApi) return tauriWindowApi
  try {
    tauriWindowApi = await import('@tauri-apps/api/window')
    return tauriWindowApi
  } catch {
    return null
  }
}

function loadFloatingState(): FloatingState {
  const fallback: FloatingState = { x: null, y: null, collapsed: false, expandedX: null, expandedY: null }
  const raw = localStorage.getItem(floatingStorageKey)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<FloatingState>
    return {
      x: typeof parsed.x === 'number' ? parsed.x : null,
      y: typeof parsed.y === 'number' ? parsed.y : null,
      collapsed: parsed.collapsed === true,
      expandedX: typeof parsed.expandedX === 'number' ? parsed.expandedX : null,
      expandedY: typeof parsed.expandedY === 'number' ? parsed.expandedY : null
    }
  } catch {
    return fallback
  }
}

function saveFloatingState(state: FloatingState) {
  localStorage.setItem(floatingStorageKey, JSON.stringify(state))
}

function formatResetRemain(value: string | null): string {
  if (!value) return '--'
  const resetAt = Date.parse(value)
  if (!Number.isFinite(resetAt)) return '--'
  const remainingMs = resetAt - Date.now()
  if (remainingMs <= 0) return '0m'
  const totalMinutes = Math.ceil(remainingMs / 60000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function formatPoolResetItem(item: PoolResetItem) {
  const date = new Date(item.resetAt)
  return {
    resetAt: item.resetAt,
    statusClass: item.status,
    statusText: item.status === 'limited' ? '限流中' : '正常',
    displayTime: Number.isNaN(date.getTime())
      ? '--'
      : date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
  }
}

onMounted(() => {
  window.addEventListener('storage', syncExternalSettingsChange)
  if (isTrayMenuView) {
    void initAppVersion()
    void checkPlatformUpdate()
    return
  }
  if (isUpdaterView) {
    void initUpdaterView()
    return
  }
  void initAppVersion()
  scheduleRefresh()
  void refreshAll()
  void initRuntimeListenersAndUpdateStatus()
  void initFloatingWindow()
  void resizePlatformWindowToContent()
})

watch([accountDetailsExpanded, rankingExpanded, selectedAccountStatus, adminMetrics], () => {
  void resizePlatformWindowToContent()
})

watch([updateState, updateBody, downloadPercent], () => {
  void resizeUpdaterWindowToContent()
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', syncExternalSettingsChange)
  if (timer !== null) window.clearInterval(timer)
  if (platformUpdateTimer !== null) window.clearInterval(platformUpdateTimer)
  if (saveMessageTimer !== null) window.clearTimeout(saveMessageTimer)
  if (unlistenMoved) unlistenMoved()
  if (unlistenSettingsChanged) unlistenSettingsChanged()
  if (unlistenPlatformUpdateCheck) unlistenPlatformUpdateCheck()
})
</script>
