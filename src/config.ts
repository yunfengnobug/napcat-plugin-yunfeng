/**
 * 插件配置模块
 * 定义默认配置值和 WebUI 配置 Schema
 */

import type { NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { MailSettings, PluginConfig } from './types';

/** 默认发信配置：留空即视为未配置，不会发信，也不包含任何账号口令 */
export const DEFAULT_MAIL: MailSettings = {
    host: '',
    port: 465,
    encryption: 'ssl',
    username: '',
    password: '',
    from: '',
};

/** 默认配置 */
export const DEFAULT_CONFIG: PluginConfig = {
    enabled: true,
    debug: false,
    commandPrefix: '#yf',
    cooldownSeconds: 60,
    webhookSecret: '',
    /**
     * 默认话术：兼容旧调用方 title/content/url；
     * 可在 WebUI 改为任意 {{res.字段}} / {{image:res.xxx}}
     */
    notifyTemplate: '【{{res.title}}】\n{{res.content}}\n{{res.url}}',
    /** 新群首次开机时写入的功能初始值（不影响已开启群） */
    featureDefaults: {
        notify: true,
        customApi: false,
        /** 新群默认不发入群 / 退群邮件，避免升级后突然给成员发信 */
        mailJoin: false,
        mailLeave: false,
    },
    mail: { ...DEFAULT_MAIL },
    customApiRules: [],
    /** 一条消息命中多条关键词/规则时，默认只调用一次 */
    customApiOncePerMessage: true,
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
                <p style="margin: 0; font-size: 13px; opacity: 0.85;">自定义API，webhook消息的群推送等</p>
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
        ctx.NapCatConfig.text('webhookSecret', 'Webhook 密钥', '', '外部后台调用通知接口时需携带；建议在插件仪表盘配置页设置'),
        // 发信参数在插件页面里编辑；这里只提示收件人规则，避免把密码放进另一套表单
        ctx.NapCatConfig.plainText('成员入群/退群邮件请到插件页面「邮件通知」填写 SMTP。收件人是变动成员自己的 QQ 邮箱（QQ号@qq.com），不是固定管理员邮箱。')
    );
}
