/**
 * 插件配置模块
 * 定义默认配置值和 WebUI 配置 Schema
 */

import type { NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { PluginConfig } from './types';

/** 默认配置 */
export const DEFAULT_CONFIG: PluginConfig = {
    enabled: true,
    debug: false,
    commandPrefix: '#yf',
    cooldownSeconds: 60,
    webhookSecret: '',
    /** 新群首次开机时写入的功能初始值（不影响已开启群） */
    featureDefaults: {
        notify: true,
    },
    groupConfigs: {},
};

/**
 * 构建 WebUI 配置 Schema
 *
 * 使用 ctx.NapCatConfig 提供的构建器方法生成配置界面：
 *   - boolean(key, label, defaultValue?, description?, reactive?)  → 开关
 *   - text(key, label, defaultValue?, description?, reactive?)     → 文本输入
 *   - number(key, label, defaultValue?, description?, reactive?)   → 数字输入
 *   - select(key, label, options, defaultValue?, description?)     → 下拉单选
 *   - multiSelect(key, label, options, defaultValue?, description?) → 下拉多选
 *   - html(content)     → 自定义 HTML 展示（不保存值）
 *   - plainText(content) → 纯文本说明
 *   - combine(...items)  → 组合多个配置项为 Schema
 */
export function buildConfigSchema(ctx: NapCatPluginContext): PluginConfigSchema {
    return ctx.NapCatConfig.combine(
        // 插件信息头部
        ctx.NapCatConfig.html(`
            <div style="padding: 16px; background: #FB7299; border-radius: 12px; margin-bottom: 20px; color: white;">
                <h3 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 600;">云枫</h3>
                <p style="margin: 0; font-size: 13px; opacity: 0.85;">群授权 / 开机门禁 · Webhook 通知 · 可扩展多功能</p>
            </div>
        `),
        // 启停由 NapCat 插件管理控制，此处不再提供「启用插件」开关
        // 调试模式
        ctx.NapCatConfig.boolean('debug', '调试模式', false, '启用后将输出详细的调试日志'),
        // 命令前缀
        ctx.NapCatConfig.text('commandPrefix', '命令前缀', '#yf', '触发命令的前缀，默认为 #yf'),
        // 冷却时间
        ctx.NapCatConfig.number('cooldownSeconds', '冷却时间（秒）', 60, '同一命令请求冷却时间，0 表示不限制'),
        // Webhook 密钥（详细配置建议在插件自带 WebUI 中管理）
        ctx.NapCatConfig.text('webhookSecret', 'Webhook 密钥', '', '外部后台调用通知接口时需携带；建议在插件仪表盘配置页设置')
    );
}
