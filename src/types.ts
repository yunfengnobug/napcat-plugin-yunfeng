/**
 * 类型定义文件
 * 定义插件内部使用的接口和类型
 *
 * 注意：OneBot 相关类型（OB11Message, OB11PostSendMsg 等）
 * 以及插件框架类型（NapCatPluginContext, PluginModule 等）
 * 均来自 napcat-types 包，无需在此重复定义。
 */

// ==================== 功能开关 ====================

/** 群聊业务功能键（后续新功能在此扩展） */
export type FeatureKey = 'notify' | 'customApi';

/** 各功能开关 */
export interface FeatureFlags {
    /** Webhook 通知推群 */
    notify?: boolean;
    /** 自定义 API（消息触发后请求外部接口并拼话术发送） */
    customApi?: boolean;
}

// ==================== 自定义 API 规则 ====================

/** 触发匹配方式 */
export type CustomApiTriggerType = 'exact' | 'fuzzy' | 'regex';

/** HTTP 方法 */
export type CustomApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/**
 * 请求体/参数编码方式
 * - none：无请求体（常见于 GET/HEAD/DELETE）
 * - json：application/json
 * - form：application/x-www-form-urlencoded（参数用 JSON 对象模板描述）
 * - multipart：multipart/form-data（参数用 JSON 对象模板描述）
 * - raw：原始文本（按模板渲染后原样作为 body）
 */
export type CustomApiBodyType = 'none' | 'json' | 'form' | 'multipart' | 'raw';

/**
 * 一条自定义 API 规则
 * 消息命中触发词后请求外部接口，用返回值按模板拼话术，发到指定群/好友
 */
export interface CustomApiRule {
    /** 规则 ID */
    id: string;
    /** 显示名称 */
    name: string;
    /** 是否启用本规则 */
    enabled: boolean;
    /** 触发方式：精确词 / 模糊词 / 正则 */
    triggerType: CustomApiTriggerType;
    /** 触发内容（关键词或正则） */
    trigger: string;
    /** 请求方法 */
    method: CustomApiHttpMethod;
    /** 外部接口 URL，可用 {{msg}} {{user_id}} {{group_id}} 等占位 */
    url: string;
    /** 请求头（普通对象） */
    headers?: Record<string, string>;
    /**
     * Query 参数模板（JSON 对象字符串，值可含占位符）
     * 例：{"q":"{{msg}}","uid":"{{user_id}}"}
     */
    queryTemplate?: string;
    /** 请求体编码方式 */
    bodyType: CustomApiBodyType;
    /**
     * 请求体/表单参数模板
     * - json/raw：整段文本模板
     * - form/multipart：JSON 对象模板，键值均可含占位符
     */
    bodyTemplate?: string;
    /**
     * 话术模板
     * 正则捕获：整段 {{match}}；第 n 个括号 {{match1}}…；命名分组 (?&lt;city&gt;…) → {{city}}
     */
    replyTemplate: string;
    /** 是否同时回复当前会话 */
    replyToCurrent: boolean;
    /** 额外发送的目标群号 */
    targetGroupIds: string[];
    /** 额外发送的目标好友 QQ */
    targetUserIds: string[];
}

// ==================== 插件配置 ====================

/**
 * 插件主配置接口
 * 在此定义你的插件所需的所有配置项
 */
export interface PluginConfig {
    /** 全局开关：是否启用插件功能（兼容字段，启停以 NapCat 插件管理为准） */
    enabled: boolean;
    /** 调试模式：启用后输出详细日志 */
    debug: boolean;
    /** 触发命令前缀，默认为 #yf */
    commandPrefix: string;
    /** 同一命令请求冷却时间（秒），0 表示不限制 */
    cooldownSeconds: number;
    /** 外部 Webhook 密钥（请求头 X-Webhook-Secret 或 body.secret） */
    webhookSecret: string;
    /**
     * 功能全局初始设置
     * 仅在群「首次开机」时写入该群作为初始值；之后改全局不影响已开启过的群
     */
    featureDefaults: Required<FeatureFlags>;
    /** 自定义 API 规则列表（全局配置，群侧用功能开关控制是否响应） */
    customApiRules: CustomApiRule[];
    /** 按群的单独配置 */
    groupConfigs: Record<string, GroupConfig>;
}

/**
 * 群配置
 * - poweredOn：开机状态
 * - authExpireAt：授权到期时间戳（毫秒）
 * - settingsInitialized：是否已应用过全局初始设置（首次开机时置 true）
 * - features：本群功能开关（开启后独立于全局）
 */
export interface GroupConfig {
    /** 是否开机；关机时不处理该群任何后续功能 */
    poweredOn?: boolean;
    /** 授权到期时间（毫秒时间戳），0 表示未授权 */
    authExpireAt?: number;
    /** 是否已应用全局初始设置（首次开机时写入） */
    settingsInitialized?: boolean;
    /** 本群功能开关（已开启群以本字段为准） */
    features?: FeatureFlags;
}

// ==================== Webhook ====================

/**
 * 外部后台推送通知的简易字段（后续可扩展）
 * 不传群号：由插件按「已授权 + 开机 + 通知开启」的群列表自行推送
 */
export interface NotifyWebhookBody {
    /** 标题（可选） */
    title?: string;
    /** 详情正文 */
    content?: string;
    /** 相关链接（可选） */
    url?: string;
    /** 密钥（也可用请求头 X-Webhook-Secret） */
    secret?: string;
}

// ==================== API 响应 ====================

/**
 * 统一 API 响应格式
 */
export interface ApiResponse<T = unknown> {
    /** 状态码，0 表示成功，-1 表示失败 */
    code: number;
    /** 错误信息（仅错误时返回） */
    message?: string;
    /** 响应数据（仅成功时返回） */
    data?: T;
}
