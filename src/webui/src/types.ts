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
}

export interface PluginConfig {
    enabled: boolean
    debug: boolean
    commandPrefix: string
    cooldownSeconds: number
    webhookSecret: string
    featureDefaults: {
        notify: boolean
    }
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
    }
}

export interface ApiResponse<T = unknown> {
    code: number
    data?: T
    message?: string
}
