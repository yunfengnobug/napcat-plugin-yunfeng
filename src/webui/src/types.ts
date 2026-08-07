/** WebUI 前端类型定义 */

export interface PluginStatus {
    pluginName: string
    uptime: number
    uptimeFormatted: string
    config: PluginConfig
    webhookPath?: string
    stats: {
        processed: number
        todayProcessed: number
        lastUpdateDay: string
        notifySent?: number
    }
}

export interface FeatureFlags {
    notify?: boolean
    customApi?: boolean
}

export type CustomApiTriggerType = 'exact' | 'fuzzy' | 'regex'
export type CustomApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
export type CustomApiBodyType = 'none' | 'json' | 'form' | 'multipart' | 'raw'

/**
 * 预期条件：path 须为本步 resN. 开头
 * value 非空则须相等（可写 {{变量}}）；value 为空则仅要求 key 存在
 */
export interface CustomApiExpectedCondition {
    path: string
    value: string
}

/** 串行请求中的一步 */
export interface CustomApiStep {
    id: string
    name: string
    method: CustomApiHttpMethod
    url: string
    headers?: Record<string, string>
    queryTemplate?: string
    bodyType: CustomApiBodyType
    bodyTemplate?: string
    /** 超时毫秒，默认 8000 */
    timeoutMs: number
    /** 预期条件（最多 2 条） */
    expectedConditions: CustomApiExpectedCondition[]
    /** 且 / 或 */
    expectedLogic: 'and' | 'or'
}

export interface CustomApiRule {
    id: string
    name: string
    enabled: boolean
    triggerType: CustomApiTriggerType
    trigger: string
    steps: CustomApiStep[]
    /** 超时/缺字段/缺变量时中止且不发送，默认 true */
    strictAbort: boolean
    replyTemplate: string
    replyToCurrent: boolean
    targetGroupIds: string[]
    targetUserIds: string[]
}

/** 自定义 API 规则接口返回体 */
export interface CustomApiRulesPayload {
    rules: CustomApiRule[]
    oncePerMessage: boolean
}

/** 试跑：单步结果 */
export interface CustomApiTestStepResult {
    index: number
    name: string
    method: string
    url: string
    status: number | null
    httpOk: boolean
    durationMs: number
    text: string
    json: unknown
    expectOk: boolean
    expectMessage: string | null
    error: string | null
}

/** 试跑：触发匹配详情 */
export interface CustomApiTestMatchInfo {
    mockMsg: string
    triggerType: CustomApiTriggerType
    trigger: string
    matched: boolean
    match: string | null
    groups: string[]
    named: Record<string, string>
}

/** 试跑：整体结果（不发送消息） */
export interface CustomApiTestResult {
    steps: CustomApiTestStepResult[]
    match: CustomApiTestMatchInfo
    replyPreview: string | null
    replyError: string | null
    aborted: boolean
    abortReason: string | null
}

export interface PluginConfig {
    enabled: boolean
    debug: boolean
    commandPrefix: string
    cooldownSeconds: number
    webhookSecret: string
    featureDefaults: {
        notify: boolean
        customApi: boolean
    }
    customApiRules?: CustomApiRule[]
    customApiOncePerMessage?: boolean
    groupConfigs?: Record<string, GroupConfig>
    webhookPath?: string
}

export interface GroupConfig {
    poweredOn?: boolean
    authExpireAt?: number
    settingsInitialized?: boolean
    features?: FeatureFlags
}

export interface GroupInfo {
    group_id: number
    group_name: string
    member_count: number
    max_member_count: number
    poweredOn: boolean
    authExpireAt: number
    authExpireText: string
    authorized: boolean
    canProcess: boolean
    settingsInitialized: boolean
    features: {
        notify: boolean
        customApi: boolean
    }
}

export interface FriendInfo {
    user_id: number
    nickname: string
    remark: string
}

export interface ApiResponse<T = unknown> {
    code: number
    data?: T
    message?: string
}
