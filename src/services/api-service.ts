/**
 * API 服务模块
 * 注册 WebUI API 路由与外部 Webhook
 *
 * 路由类型说明：
 * ┌─────────────────┬──────────────────────────────────────────────┬─────────────────┐
 * │ 类型            │ 路径前缀                                      │ 注册方法        │
 * ├─────────────────┼──────────────────────────────────────────────┼─────────────────┤
 * │ 需要鉴权 API    │ /api/Plugin/ext/<plugin-id>/                 │ router.get/post │
 * │ 无需鉴权 API    │ /plugin/<plugin-id>/api/                     │ router.getNoAuth│
 * │ 静态文件        │ /plugin/<plugin-id>/files/<urlPath>/         │ router.static   │
 * │ 内存文件        │ /plugin/<plugin-id>/mem/<urlPath>/           │ router.staticOnMem│
 * │ 页面            │ /plugin/<plugin-id>/page/<path>             │ router.page     │
 * └─────────────────┴──────────────────────────────────────────────┴─────────────────┘
 *
 * 一般插件自带的 WebUI 页面使用 NoAuth 路由，因为页面本身已在 NapCat WebUI 内嵌展示。
 * 外部 Webhook 必须使用密钥校验，禁止裸奔敏感操作。
 */

import type {
    NapCatPluginContext,
} from 'napcat-types/napcat-onebot/network/plugin/types';
import type { OB11PostSendMsg } from 'napcat-types/napcat-onebot';
import { pluginState } from '../core/state';
import type { FeatureFlags, GroupConfig, NotifyWebhookBody, PluginConfig } from '../types';

/** 格式化授权到期时间展示 */
function formatExpireAt(ts: number): string {
    if (!ts || ts <= 0) return '未授权';
    if (ts <= Date.now()) return '已过期';
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 组装群列表项（附带授权/开机/功能状态） */
function buildGroupView(
    group: { group_id: number; group_name: string; member_count: number; max_member_count: number },
) {
    const groupId = String(group.group_id);
    const cfg = pluginState.getGroupConfig(groupId);

    return {
        group_id: group.group_id,
        group_name: group.group_name,
        member_count: group.member_count,
        max_member_count: group.max_member_count,
        poweredOn: cfg.poweredOn,
        authExpireAt: cfg.authExpireAt,
        authExpireText: formatExpireAt(cfg.authExpireAt),
        authorized: pluginState.isGroupAuthorized(groupId),
        canProcess: pluginState.canProcessGroup(groupId),
        settingsInitialized: cfg.settingsInitialized,
        features: {
            notify: pluginState.getFeatureFlag(groupId, 'notify'),
        },
    };
}

/**
 * 应用单群配置补丁（开机、功能开关、授权天数）
 */
function applyGroupPatch(groupId: string, body: Record<string, unknown>): GroupConfig {
    // 开机走专用逻辑：首次开机时写入全局功能快照
    if (typeof body.poweredOn === 'boolean') {
        pluginState.setGroupPoweredOn(groupId, body.poweredOn);
    }

    if (body.features && typeof body.features === 'object' && !Array.isArray(body.features)) {
        const features = body.features as FeatureFlags;
        const patch: FeatureFlags = {};
        if (typeof features.notify === 'boolean') patch.notify = features.notify;
        if (Object.keys(patch).length > 0) {
            // 改功能前若尚未初始化，先标记为已初始化（以本次写入为准）
            const cur = pluginState.getGroupConfig(groupId);
            if (!cur.settingsInitialized) {
                pluginState.updateGroupConfig(groupId, {
                    settingsInitialized: true,
                    features: { ...pluginState.config.featureDefaults, ...patch },
                });
            } else {
                pluginState.updateGroupConfig(groupId, { features: patch });
            }
        }
    }

    if (typeof body.addAuthDays === 'number') {
        pluginState.addAuthDays(groupId, body.addAuthDays);
    } else if (typeof body.setAuthDays === 'number') {
        pluginState.setAuthDays(groupId, body.setAuthDays);
    } else if (typeof body.authExpireAt === 'number') {
        pluginState.updateGroupConfig(groupId, { authExpireAt: body.authExpireAt });
    }

    return pluginState.config.groupConfigs[groupId] || {};
}

/**
 * 注册 API 路由
 */
export function registerApiRoutes(ctx: NapCatPluginContext): void {
    const router = ctx.router;

    // ==================== 插件信息（无鉴权）====================

    /** 获取插件状态 */
    router.getNoAuth('/status', (_req, res) => {
        res.json({
            code: 0,
            data: {
                pluginName: ctx.pluginName,
                uptime: pluginState.getUptime(),
                uptimeFormatted: pluginState.getUptimeFormatted(),
                config: pluginState.config,
                stats: pluginState.stats,
                webhookPath: `/plugin/${ctx.pluginName}/api/webhook/notify`,
            },
        });
    });

    // ==================== 配置管理（无鉴权）====================

    /** 获取配置 */
    router.getNoAuth('/config', (_req, res) => {
        res.json({
            code: 0,
            data: {
                ...pluginState.config,
                webhookPath: `/plugin/${ctx.pluginName}/api/webhook/notify`,
            },
        });
    });

    /** 保存配置 */
    router.postNoAuth('/config', async (req, res) => {
        try {
            const body = req.body as Record<string, unknown> | undefined;
            if (!body) {
                return res.status(400).json({ code: -1, message: '请求体为空' });
            }
            // 避免前端把 webhookPath 等展示字段写回配置
            const { webhookPath: _wp, stats: _st, ...rest } = body;
            pluginState.updateConfig(rest as Partial<PluginConfig>);
            ctx.logger.info('配置已保存');
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            ctx.logger.error('保存配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // ==================== 群管理（无鉴权）====================

    /** 获取群列表（附带授权 / 开机 / 功能状态） */
    router.getNoAuth('/groups', async (_req, res) => {
        try {
            const groups = await ctx.actions.call(
                'get_group_list',
                {},
                ctx.adapterName,
                ctx.pluginManager.config
            ) as Array<{ group_id: number; group_name: string; member_count: number; max_member_count: number }>;

            const groupsWithConfig = (groups || []).map((group) => buildGroupView(group));
            res.json({ code: 0, data: groupsWithConfig });
        } catch (e) {
            ctx.logger.error('获取群列表失败:', e);
            res.status(500).json({ code: -1, message: String(e) });
        }
    });

    /** 更新单个群配置（开机 / 授权天数 / 功能开关） */
    router.postNoAuth('/groups/:id/config', async (req, res) => {
        try {
            const groupId = req.params?.id;
            if (!groupId) {
                return res.status(400).json({ code: -1, message: '缺少群 ID' });
            }

            const body = (req.body as Record<string, unknown> | undefined) || {};
            applyGroupPatch(groupId, body);
            ctx.logger.info(`群 ${groupId} 配置已更新`);
            res.json({
                code: 0,
                message: 'ok',
                data: buildGroupView({
                    group_id: Number(groupId),
                    group_name: '',
                    member_count: 0,
                    max_member_count: 0,
                }),
            });
        } catch (err) {
            ctx.logger.error('更新群配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    /** 批量更新群配置（多选开机/关机、功能开关、授权天数） */
    router.postNoAuth('/groups/bulk-config', async (req, res) => {
        try {
            const body = req.body as Record<string, unknown> | undefined;
            const groupIds = body?.groupIds;

            if (!Array.isArray(groupIds) || groupIds.length === 0) {
                return res.status(400).json({ code: -1, message: '请选择群' });
            }

            const patchBody = { ...body };
            delete patchBody.groupIds;

            for (const groupId of groupIds) {
                applyGroupPatch(String(groupId), patchBody);
            }

            ctx.logger.info(`批量更新群配置完成 | 数量: ${groupIds.length}`);
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            ctx.logger.error('批量更新群配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // ==================== 外部 Webhook：通知推群 ====================

    /**
     * 外部后台推送通知（不传群号，由插件决定目标群）
     * POST /plugin/napcat-plugin-yunfeng/api/webhook/notify
     * Header: X-Webhook-Secret: <密钥>
     * Body: { title?, content?, url? }
     *
     * 推送范围：已授权 + 开机 + 通知功能开启的群
     */
    router.postNoAuth('/webhook/notify', async (req, res) => {
        try {
            const body = (req.body || {}) as NotifyWebhookBody;
            const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers || {};
            const rawHeader = headers['x-webhook-secret'];
            const headerSecret = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
            const secret = (typeof headerSecret === 'string' ? headerSecret : '') || body.secret || '';

            if (!pluginState.verifyWebhookSecret(secret)) {
                return res.status(401).json({ code: -1, message: '密钥无效' });
            }

            const title = typeof body.title === 'string' ? body.title.trim() : '';
            const content = typeof body.content === 'string' ? body.content.trim() : '';
            const url = typeof body.url === 'string' ? body.url.trim() : '';

            if (!title && !content && !url) {
                return res.status(400).json({ code: -1, message: 'title / content / url 至少填一项' });
            }

            // 拉群列表，与本地配置交叉后选出可推送目标（插件决定，不吃调用方群号）
            let qqGroups: Array<{ group_id: number }> = [];
            try {
                qqGroups = await ctx.actions.call(
                    'get_group_list',
                    {},
                    ctx.adapterName,
                    ctx.pluginManager.config,
                ) as Array<{ group_id: number }>;
            } catch (e) {
                ctx.logger.warn('获取群列表失败，回退为仅使用已配置群:', e);
            }

            const candidateIds = new Set<string>(pluginState.listFeatureTargetGroupIds('notify'));
            for (const g of qqGroups || []) {
                const id = String(g.group_id);
                if (pluginState.isFeatureEnabled(id, 'notify')) candidateIds.add(id);
            }

            const targets = Array.from(candidateIds);
            if (targets.length === 0) {
                return res.status(200).json({
                    code: 0,
                    message: '无可推送的群（需已授权、开机且开启通知）',
                    data: { sent: [], failed: [] },
                });
            }

            // 简易文本模板（后续可按你的字段再改）
            const lines: string[] = [];
            if (title) lines.push(`【${title}】`);
            if (content) lines.push(content);
            if (url) lines.push(url);
            const message = lines.join('\n');

            const sent: string[] = [];
            const failed: Array<{ group_id: string; error: string }> = [];

            for (const groupId of targets) {
                try {
                    const params: OB11PostSendMsg = {
                        message,
                        message_type: 'group',
                        group_id: groupId,
                    };
                    await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
                    sent.push(groupId);
                    pluginState.incrementNotifySent();
                } catch (err) {
                    failed.push({ group_id: groupId, error: String(err) });
                    ctx.logger.error(`Webhook 通知发送失败 group=${groupId}:`, err);
                }
            }

            pluginState.saveConfig();
            ctx.logger.info(`Webhook 通知完成 | 成功 ${sent.length} / 失败 ${failed.length}`);
            res.json({
                code: 0,
                message: 'ok',
                data: { sent, failed },
            });
        } catch (err) {
            ctx.logger.error('Webhook 通知处理失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    ctx.logger.debug('API 路由注册完成');
}
