/**
 * 全局状态管理模块（单例模式）
 *
 * 封装插件的配置持久化和运行时状态，提供在项目任意位置访问
 * ctx、config、logger 等对象的能力，无需逐层传递参数。
 *
 * 使用方法：
 *   import { pluginState } from '../core/state';
 *   pluginState.config.enabled;       // 读取配置
 *   pluginState.ctx.logger.info(...); // 使用日志
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NapCatPluginContext, PluginLogger } from 'napcat-types/napcat-onebot/network/plugin/types';
import { DEFAULT_CONFIG } from '../config';
import type {
    CustomApiBodyType,
    CustomApiHttpMethod,
    CustomApiRule,
    CustomApiTriggerType,
    FeatureFlags,
    FeatureKey,
    GroupConfig,
    PluginConfig,
} from '../types';

const HTTP_METHODS: CustomApiHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const BODY_TYPES: CustomApiBodyType[] = ['none', 'json', 'form', 'multipart', 'raw'];

// ==================== 配置清洗工具 ====================

function isObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 生成 Webhook 密钥（首次创建配置时使用） */
function generateWebhookSecret(): string {
    return crypto.randomBytes(24).toString('hex');
}

/** 清洗单条自定义 API 规则 */
function sanitizeCustomApiRule(raw: unknown): CustomApiRule | null {
    if (!isObject(raw)) return null;
    const triggerType = raw.triggerType;
    if (triggerType !== 'exact' && triggerType !== 'fuzzy' && triggerType !== 'regex') return null;

    const methodRaw = String(raw.method || 'GET').toUpperCase();
    const method = (HTTP_METHODS.includes(methodRaw as CustomApiHttpMethod)
        ? methodRaw
        : 'GET') as CustomApiHttpMethod;

    // 兼容旧配置：仅有 bodyTemplate 且无 bodyType 时，按 POST→json / 其他→none
    let bodyType: CustomApiBodyType = 'none';
    if (typeof raw.bodyType === 'string' && BODY_TYPES.includes(raw.bodyType as CustomApiBodyType)) {
        bodyType = raw.bodyType as CustomApiBodyType;
    } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        bodyType = 'json';
    }

    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : crypto.randomBytes(8).toString('hex');
    const name = typeof raw.name === 'string' ? raw.name.trim() : '未命名规则';
    const trigger = typeof raw.trigger === 'string' ? raw.trigger : '';
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!trigger || !url) return null;

    const headers: Record<string, string> = {};
    if (isObject(raw.headers)) {
        for (const [k, v] of Object.entries(raw.headers)) {
            if (typeof v === 'string') headers[k] = v;
        }
    }
    // 未配置请求头时补默认 Content-Type
    if (Object.keys(headers).length === 0) {
        headers['Content-Type'] = 'application/json';
    }

    const targetGroupIds = Array.isArray(raw.targetGroupIds)
        ? raw.targetGroupIds.map((x) => String(x).trim()).filter(Boolean)
        : [];
    const targetUserIds = Array.isArray(raw.targetUserIds)
        ? raw.targetUserIds.map((x) => String(x).trim()).filter(Boolean)
        : [];

    return {
        id,
        name: name || '未命名规则',
        enabled: raw.enabled !== false,
        triggerType: triggerType as CustomApiTriggerType,
        trigger,
        method,
        url,
        headers,
        queryTemplate: typeof raw.queryTemplate === 'string' ? raw.queryTemplate : '',
        bodyType,
        bodyTemplate: typeof raw.bodyTemplate === 'string' ? raw.bodyTemplate : '',
        replyTemplate: typeof raw.replyTemplate === 'string' ? raw.replyTemplate : '{{res}}',
        // 默认关闭「回复当前会话」
        replyToCurrent: raw.replyToCurrent === true,
        targetGroupIds,
        targetUserIds,
    };
}

/**
 * 配置清洗函数
 * 确保从文件读取的配置符合预期类型，防止运行时错误
 */
function sanitizeConfig(raw: unknown): PluginConfig {
    if (!isObject(raw)) {
        return {
            ...DEFAULT_CONFIG,
            webhookSecret: generateWebhookSecret(),
            featureDefaults: { ...DEFAULT_CONFIG.featureDefaults },
            customApiRules: [],
            groupConfigs: {},
        };
    }

    const out: PluginConfig = {
        ...DEFAULT_CONFIG,
        featureDefaults: { ...DEFAULT_CONFIG.featureDefaults },
        customApiRules: [],
        groupConfigs: {},
        webhookSecret: '',
    };

    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
    if (typeof raw.debug === 'boolean') out.debug = raw.debug;
    if (typeof raw.commandPrefix === 'string') out.commandPrefix = raw.commandPrefix;
    if (typeof raw.cooldownSeconds === 'number') out.cooldownSeconds = raw.cooldownSeconds;
    if (typeof raw.webhookSecret === 'string' && raw.webhookSecret.trim()) {
        out.webhookSecret = raw.webhookSecret.trim();
    } else {
        out.webhookSecret = generateWebhookSecret();
    }

    // 全局功能默认开关
    if (isObject(raw.featureDefaults)) {
        if (typeof raw.featureDefaults.notify === 'boolean') {
            out.featureDefaults.notify = raw.featureDefaults.notify;
        }
        if (typeof raw.featureDefaults.customApi === 'boolean') {
            out.featureDefaults.customApi = raw.featureDefaults.customApi;
        }
    }

    // 自定义 API 规则
    if (Array.isArray(raw.customApiRules)) {
        for (const item of raw.customApiRules) {
            const rule = sanitizeCustomApiRule(item);
            if (rule) out.customApiRules.push(rule);
        }
    }

    // 群配置清洗（兼容旧字段 enabled → poweredOn）
    if (isObject(raw.groupConfigs)) {
        for (const [groupId, groupConfig] of Object.entries(raw.groupConfigs)) {
            if (!isObject(groupConfig)) continue;
            const cfg: GroupConfig = {};
            if (typeof groupConfig.poweredOn === 'boolean') {
                cfg.poweredOn = groupConfig.poweredOn;
            } else if (typeof groupConfig.enabled === 'boolean') {
                // 旧模板字段兼容
                cfg.poweredOn = groupConfig.enabled;
            }
            if (typeof groupConfig.authExpireAt === 'number') {
                cfg.authExpireAt = groupConfig.authExpireAt;
            }
            if (typeof groupConfig.settingsInitialized === 'boolean') {
                cfg.settingsInitialized = groupConfig.settingsInitialized;
            }
            if (isObject(groupConfig.features)) {
                const features: FeatureFlags = {};
                if (typeof groupConfig.features.notify === 'boolean') {
                    features.notify = groupConfig.features.notify;
                }
                if (typeof groupConfig.features.customApi === 'boolean') {
                    features.customApi = groupConfig.features.customApi;
                }
                cfg.features = features;
            }
            // 已开机但未标记：视为已开启过，用当前全局默认补全缺失功能项（仅迁移一次）
            if (cfg.poweredOn && !cfg.settingsInitialized) {
                cfg.settingsInitialized = true;
                cfg.features = {
                    notify: cfg.features?.notify ?? out.featureDefaults.notify,
                    customApi: cfg.features?.customApi ?? out.featureDefaults.customApi,
                };
            }
            out.groupConfigs[groupId] = cfg;
        }
    }

    return out;
}

// ==================== 插件全局状态类 ====================

class PluginState {
    /** NapCat 插件上下文（init 后可用） */
    private _ctx: NapCatPluginContext | null = null;

    /** 插件配置 */
    config: PluginConfig = {
        ...DEFAULT_CONFIG,
        featureDefaults: { ...DEFAULT_CONFIG.featureDefaults },
        groupConfigs: {},
    };

    /** 插件启动时间戳 */
    startTime: number = 0;

    /** 机器人自身 QQ 号 */
    selfId: string = '';

    /** 活跃的定时器 Map: jobId -> NodeJS.Timeout */
    timers: Map<string, ReturnType<typeof setInterval>> = new Map();

    /** 运行时统计 */
    stats = {
        processed: 0,
        todayProcessed: 0,
        lastUpdateDay: new Date().toDateString(),
        /** Webhook 通知成功次数 */
        notifySent: 0,
    };

    /** 获取上下文（确保已初始化） */
    get ctx(): NapCatPluginContext {
        if (!this._ctx) throw new Error('PluginState 尚未初始化，请先调用 init()');
        return this._ctx;
    }

    /** 获取日志器的快捷方式 */
    get logger(): PluginLogger {
        return this.ctx.logger;
    }

    // ==================== 生命周期 ====================

    /**
     * 初始化（在 plugin_init 中调用）
     */
    init(ctx: NapCatPluginContext): void {
        this._ctx = ctx;
        this.startTime = Date.now();
        this.loadConfig();
        this.ensureDataDir();
        this.fetchSelfId();
    }

    /**
     * 获取机器人自身 QQ 号（异步，init 时自动调用）
     */
    private async fetchSelfId(): Promise<void> {
        try {
            const res = await this.ctx.actions.call(
                'get_login_info', {}, this.ctx.adapterName, this.ctx.pluginManager.config
            ) as { user_id?: number | string };
            if (res?.user_id) {
                this.selfId = String(res.user_id);
                this.logger.debug('机器人 QQ: ' + this.selfId);
            }
        } catch (e) {
            this.logger.warn('获取机器人 QQ 号失败:', e);
        }
    }

    /**
     * 清理（在 plugin_cleanup 中调用）
     */
    cleanup(): void {
        // 清理所有定时器
        for (const [jobId, timer] of this.timers) {
            clearInterval(timer);
            this.logger.debug(`清理定时器: ${jobId}`);
        }
        this.timers.clear();
        this.saveConfig();
        this._ctx = null;
    }

    // ==================== 数据目录 ====================

    /** 确保数据目录存在 */
    private ensureDataDir(): void {
        const dataPath = this.ctx.dataPath;
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
    }

    /** 获取数据文件完整路径 */
    getDataFilePath(filename: string): string {
        return path.join(this.ctx.dataPath, filename);
    }

    // ==================== 通用数据文件读写 ====================

    /**
     * 读取 JSON 数据文件
     * 常用于订阅数据、定时任务配置、推送历史等持久化数据
     * @param filename 数据文件名（如 'subscriptions.json'）
     * @param defaultValue 文件不存在或解析失败时的默认值
     */
    loadDataFile<T>(filename: string, defaultValue: T): T {
        const filePath = this.getDataFilePath(filename);
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        } catch (e) {
            this.logger.warn('读取数据文件 ' + filename + ' 失败:', e);
        }
        return defaultValue;
    }

    /**
     * 保存 JSON 数据文件
     * @param filename 数据文件名
     * @param data 要保存的数据
     */
    saveDataFile<T>(filename: string, data: T): void {
        const filePath = this.getDataFilePath(filename);
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            this.logger.error('保存数据文件 ' + filename + ' 失败:', e);
        }
    }

    // ==================== 配置管理 ====================

    /**
     * 从磁盘加载配置
     */
    loadConfig(): void {
        const configPath = this.ctx.configPath;
        try {
            if (configPath && fs.existsSync(configPath)) {
                const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                this.config = sanitizeConfig(raw);
                // 加载统计信息
                if (isObject(raw) && isObject(raw.stats)) {
                    Object.assign(this.stats, raw.stats);
                }
                this.ctx.logger.debug('已加载本地配置');
            } else {
                this.config = sanitizeConfig(null);
                this.saveConfig();
                this.ctx.logger.debug('配置文件不存在，已创建默认配置');
            }
        } catch (error) {
            this.ctx.logger.error('加载配置失败，使用默认配置:', error);
            this.config = sanitizeConfig(null);
        }
    }

    /**
     * 保存配置到磁盘
     */
    saveConfig(): void {
        if (!this._ctx) return;
        const configPath = this._ctx.configPath;
        try {
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            const data = { ...this.config, stats: this.stats };
            fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            this._ctx.logger.error('保存配置失败:', error);
        }
    }

    /**
     * 合并更新配置
     */
    updateConfig(partial: Partial<PluginConfig>): void {
        const next = { ...this.config, ...partial };
        if (partial.featureDefaults) {
            next.featureDefaults = {
                ...this.config.featureDefaults,
                ...partial.featureDefaults,
            };
        }
        if (partial.groupConfigs) {
            next.groupConfigs = partial.groupConfigs;
        }
        this.config = sanitizeConfig(next);
        this.saveConfig();
    }

    /**
     * 完整替换配置
     */
    replaceConfig(config: PluginConfig): void {
        this.config = sanitizeConfig(config);
        this.saveConfig();
    }

    /**
     * 更新指定群的配置
     */
    updateGroupConfig(groupId: string, config: Partial<GroupConfig>): void {
        const prev = this.config.groupConfigs[groupId] || {};
        const next: GroupConfig = { ...prev, ...config };
        if (config.features) {
            next.features = { ...prev.features, ...config.features };
        }
        this.config.groupConfigs[groupId] = next;
        this.saveConfig();
    }

    /**
     * 设置群开机/关机
     * 首次开机且尚未应用过全局设置时：把 featureDefaults 快照写入该群，之后改全局不再影响它
     */
    setGroupPoweredOn(groupId: string, poweredOn: boolean): void {
        const prev = this.config.groupConfigs[groupId] || {};
        const wasOn = prev.poweredOn === true;
        const initialized = prev.settingsInitialized === true;

        if (poweredOn && !wasOn && !initialized) {
            this.updateGroupConfig(groupId, {
                poweredOn: true,
                settingsInitialized: true,
                features: { ...this.config.featureDefaults },
            });
            return;
        }

        this.updateGroupConfig(groupId, { poweredOn });
    }

    // ==================== 群授权 / 开机 / 功能门禁 ====================

    /** 读取群配置（带默认值视图） */
    getGroupConfig(groupId: string): Required<Pick<GroupConfig, 'poweredOn' | 'authExpireAt' | 'settingsInitialized'>> & {
        features: FeatureFlags;
    } {
        const g = this.config.groupConfigs[groupId] || {};
        return {
            poweredOn: g.poweredOn === true,
            authExpireAt: typeof g.authExpireAt === 'number' ? g.authExpireAt : 0,
            settingsInitialized: g.settingsInitialized === true,
            features: g.features || {},
        };
    }

    /** 群是否仍在授权期内 */
    isGroupAuthorized(groupId: string): boolean {
        const expireAt = this.getGroupConfig(groupId).authExpireAt;
        return expireAt > Date.now();
    }

    /** 群是否开机 */
    isGroupPoweredOn(groupId: string): boolean {
        return this.getGroupConfig(groupId).poweredOn;
    }

    /**
     * 群是否可处理业务：全局启用 + 已授权 + 已开机
     * 未满足时后续功能应直接跳过，不响应该群
     */
    canProcessGroup(groupId: string): boolean {
        if (!this.config.enabled) return false;
        return this.isGroupAuthorized(groupId) && this.isGroupPoweredOn(groupId);
    }

    /**
     * 读取某功能对该群的开关值（不含授权/开机门禁）
     * - 已开启过（settingsInitialized）：以群内快照为准
     * - 尚未开启：返回全局初始值（仅作预览，改全局会影响下次首次开机）
     */
    getFeatureFlag(groupId: string, feature: FeatureKey): boolean {
        const g = this.getGroupConfig(groupId);
        if (g.settingsInitialized) {
            return g.features[feature] === true;
        }
        return this.config.featureDefaults[feature] === true;
    }

    /**
     * 某功能是否对该群生效（先过授权/开机门禁，再查功能开关）
     */
    isFeatureEnabled(groupId: string, feature: FeatureKey): boolean {
        if (!this.canProcessGroup(groupId)) return false;
        return this.getFeatureFlag(groupId, feature);
    }

    /** 列出当前应对某功能生效的群号（已授权 + 开机 + 功能开） */
    listFeatureTargetGroupIds(feature: FeatureKey): string[] {
        const ids = new Set<string>();
        for (const groupId of Object.keys(this.config.groupConfigs)) {
            if (this.isFeatureEnabled(groupId, feature)) ids.add(groupId);
        }
        return Array.from(ids);
    }

    /**
     * 调整授权：从「当前到期时间与现在取较大者」起延长 days 天
     * 未授权或已过期时从现在起算
     */
    addAuthDays(groupId: string, days: number): number {
        const safeDays = Math.max(0, Math.floor(days));
        const now = Date.now();
        const current = this.getGroupConfig(groupId).authExpireAt;
        const base = current > now ? current : now;
        const authExpireAt = base + safeDays * 24 * 60 * 60 * 1000;
        this.updateGroupConfig(groupId, { authExpireAt });
        return authExpireAt;
    }

    /**
     * 设置授权：从现在起共 days 天（days=0 表示立即取消授权）
     */
    setAuthDays(groupId: string, days: number): number {
        const safeDays = Math.max(0, Math.floor(days));
        const authExpireAt = safeDays === 0 ? 0 : Date.now() + safeDays * 24 * 60 * 60 * 1000;
        this.updateGroupConfig(groupId, { authExpireAt });
        return authExpireAt;
    }

    /** 校验 Webhook 密钥 */
    verifyWebhookSecret(provided: string | undefined | null): boolean {
        const expected = this.config.webhookSecret;
        if (!expected) return false;
        if (!provided) return false;
        return provided === expected;
    }

    // ==================== 统计 ====================

    /**
     * 增加处理计数
     */
    incrementProcessed(): void {
        const today = new Date().toDateString();
        if (this.stats.lastUpdateDay !== today) {
            this.stats.todayProcessed = 0;
            this.stats.lastUpdateDay = today;
        }
        this.stats.todayProcessed++;
        this.stats.processed++;
    }

    /** 增加通知发送计数 */
    incrementNotifySent(): void {
        this.stats.notifySent = (this.stats.notifySent || 0) + 1;
        this.incrementProcessed();
    }

    // ==================== 工具方法 ====================

    /** 获取运行时长（毫秒） */
    getUptime(): number {
        return Date.now() - this.startTime;
    }

    /** 获取格式化的运行时长 */
    getUptimeFormatted(): string {
        const ms = this.getUptime();
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);

        if (d > 0) return `${d}天${h % 24}小时`;
        if (h > 0) return `${h}小时${m % 60}分钟`;
        if (m > 0) return `${m}分钟${s % 60}秒`;
        return `${s}秒`;
    }
}

/** 导出全局单例 */
export const pluginState = new PluginState();
