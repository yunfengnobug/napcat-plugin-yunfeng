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

export interface CustomApiRule {
    id: string
    name: string
    enabled: boolean
    triggerType: CustomApiTriggerType
    trigger: string
    method: CustomApiHttpMethod
    url: string
    headers?: Record<string, string>
    queryTemplate?: string
    bodyType: CustomApiBodyType
    bodyTemplate?: string
    replyTemplate: string
    replyToCurrent: boolean
    targetGroupIds: string[]
    targetUserIds: string[]
}

/** 自定义 API 规则接口返回体 */
export interface CustomApiRulesPayload {
    rules: CustomApiRule[]
    /** 一条消息命中多条规则时是否只调用一次，默认 true */
    oncePerMessage: boolean
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
    groupConfigs?: Record<string, GroupConfig>
    /** 仅展示用，后端 /config 会附带 */
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
