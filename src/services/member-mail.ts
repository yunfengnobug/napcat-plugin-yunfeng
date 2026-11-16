/**
 * 成员入群 / 退群邮件
 *
 * 使用的 NapCat / OneBot 能力：
 * - 事件 notice.group_increase（sub_type: approve 管理员同意入群 / invite 邀请入群）
 *   字段：group_id、user_id、operator_id、time
 * - 事件 notice.group_decrease（sub_type: leave 主动退群 / kick 被移出 / kick_me 机器人被移出）
 *   字段同上
 * - get_group_info：取群名称（group_id）
 * - get_group_member_info：取群名片 / 昵称（group_id、user_id）；退群后可能已经查不到
 * - get_stranger_info：成员资料查不到时再取昵称（user_id）
 *
 * 收件人固定是该成员的 QQ 邮箱（QQ号@qq.com）。没有可用 QQ 号就不发，也不编造地址。
 * 入群用入群模板，退群默认用退群模板。勾选「与入群邮件一致」时，退群改用解析后的入群模板，变量仍按退群事件替换。
 * 群里留空的项回退到全局；留空不会发空白邮件。
 * 「发送测试邮件」只在全局邮件页：用已保存的全局入群主题和正文，变量按一份示例入群事件填写，收件人仍是这一次填写的地址。
 * 发信失败只记日志。
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { EventType } from 'napcat-types/napcat-onebot/event/index';
import { pluginState } from '../core/state';
import type { MailSettings } from '../types';
import { formatFromHeader, parseMailbox, resolveSender } from './mail-address';
import { renderMemberMailContent, resolveMemberMailTemplate } from './mail-template';
import { sendSmtpMail } from './smtp-mail';

/** 同一事件短时间重复上报时不连发两封 */
const DEDUPE_MS = 2 * 60 * 1000;
const recentSends = new Map<string, number>();
let lastIncompleteWarnAt = 0;
let lastTestAt = 0;

interface MemberNotice {
    post_type?: string;
    notice_type?: string;
    sub_type?: string;
    group_id?: string | number;
    user_id?: string | number;
    time?: number;
}

/** 热重载 / 卸载时清掉去重记录 */
export function clearMemberMailDedupe(): void {
    recentSends.clear();
}

/**
 * 把 QQ 号变成 QQ 邮箱
 * 只接受 5–12 位、不以 0 开头的数字；其他值返回 null
 */
export function qqNumberToMailbox(userId: unknown): string | null {
    let raw = '';
    if (typeof userId === 'number' && Number.isFinite(userId)) {
        raw = String(Math.trunc(userId));
    } else if (typeof userId === 'string') {
        raw = userId.trim();
    }
    if (!/^[1-9]\d{4,11}$/.test(raw)) return null;
    return `${raw}@qq.com`;
}

/** 仍导出，测试收件人和旧调用按邮箱原文解析 */
export { parseMailbox };

/**
 * 发信配置是否完整
 * 返回 null 表示可以发；否则是给日志和接口看的原因（不含密码）
 */
export function getMailConfigError(mail: MailSettings | undefined): string | null {
    if (!mail) return '未配置发信参数';
    const host = mail.host.trim();
    if (!host) return '未填写 SMTP 主机';
    if (/[\s:@/\\]/.test(host)) return 'SMTP 主机无效';
    if (!Number.isInteger(mail.port) || mail.port < 1 || mail.port > 65535) return 'SMTP 端口无效';
    if (mail.encryption !== 'ssl' && mail.encryption !== 'starttls' && mail.encryption !== 'none') {
        return '加密方式无效';
    }
    if (!resolveSender(mail)) return '发件人地址无效';
    const username = mail.username.trim();
    const password = mail.password;
    if (/[\r\n]/.test(username)) return '认证用户名无效';
    if ((username && !password) || (!username && password)) {
        return '认证用户名和密码需要同时填写，或者都留空';
    }
    return null;
}

/**
 * 入群 / 退群邮件正文。收件人是成员本人
 * 不传模板时用内置默认文案，和以前写死的主题、正文相同
 */
export function buildMemberNoticeMail(input: {
    noticeType: string;
    subType: string;
    groupName: string;
    groupId: string;
    memberName: string;
    memberId: string;
    timestamp: string;
    /** 已经按「群覆盖 → 全局」选好的主题。空则用内置默认 */
    subjectTemplate?: string;
    /** 已经按「群覆盖 → 全局」选好的正文。空则用内置默认 */
    bodyTemplate?: string;
}): { subject: string; text: string } | null {
    const labels = describeNotice(input.noticeType, input.subType);
    if (!labels) return null;
    const groupName = oneLine(input.groupName, '未知群');
    const memberName = oneLine(input.memberName, '未知');
    return renderMemberMailContent(
        {
            subject: input.subjectTemplate || '',
            body: input.bodyTemplate || '',
        },
        {
            group_name: groupName,
            group_id: oneLine(input.groupId, ''),
            member_name: memberName,
            member_id: oneLine(input.memberId, ''),
            event_type: labels.eventType,
            event_title: labels.title,
            sub_type: oneLine(labels.subTypeName, ''),
            event_detail: labels.typeLine,
            time: oneLine(input.timestamp, ''),
        },
    );
}

/**
 * 处理群成员增加 / 减少通知
 * 群开关关闭、未授权或未开机、发信配置不完整、没有可用 QQ 号时直接返回
 */
export async function handleMemberMailNotice(ctx: NapCatPluginContext, rawEvent: unknown): Promise<void> {
    const event = (rawEvent && typeof rawEvent === 'object' ? rawEvent : {}) as MemberNotice;
    try {
        if (event.post_type !== EventType.NOTICE && event.post_type !== 'notice') return;
        const noticeType = typeof event.notice_type === 'string' ? event.notice_type : '';
        if (noticeType !== 'group_increase' && noticeType !== 'group_decrease') return;

        const groupId = idText(event.group_id);
        const userId = idText(event.user_id);
        if (!/^[1-9]\d{4,19}$/.test(groupId)) return;

        const feature = noticeType === 'group_increase' ? 'mailJoin' : 'mailLeave';
        // 授权、开机、全局启用都在这一层里；开关关着或群不可处理则不发
        if (!pluginState.isFeatureEnabled(groupId, feature)) return;

        const mail = { ...pluginState.config.mail };
        const configError = getMailConfigError(mail);
        if (configError) {
            logIncomplete(ctx, configError);
            return;
        }

        const to = qqNumberToMailbox(userId);
        if (!to) {
            ctx.logger.warn(`成员变动邮件已跳过：没有可用的 QQ 号，无法生成 QQ 邮箱 | group=${groupId} user=${userId || '空'}`);
            return;
        }

        const subType = typeof event.sub_type === 'string' ? event.sub_type : '';
        const stamp = typeof event.time === 'number' ? event.time : Math.floor(Date.now() / 5000);
        const dedupeKey = `${noticeType}:${groupId}:${to}:${stamp}:${subType}`;
        if (isDuplicate(dedupeKey)) return;

        const names = await lookupNames(ctx, groupId, userId);
        // 退群若勾选「与入群邮件一致」，这里是入群模板；变量仍按本次通知（入群或退群）填写
        const template = resolveMemberMailTemplate(
            mail,
            pluginState.config.groupConfigs[groupId]?.mailTemplate,
            noticeType === 'group_increase' ? 'join' : 'leave',
        );
        const content = buildMemberNoticeMail({
            noticeType,
            subType,
            groupName: names.groupName,
            groupId,
            memberName: names.memberName,
            memberId: to.slice(0, to.indexOf('@')),
            timestamp: formatTimestamp(event.time),
            subjectTemplate: template.subject,
            bodyTemplate: template.body,
        });
        if (!content) return;

        await deliver(mail, to, content.subject, content.text);
        pluginState.incrementMailSent();
        pluginState.saveConfig();
        ctx.logger.info(`已发送${noticeType === 'group_increase' ? '入群' : '退群'}邮件 | group=${groupId} to=${to}`);
    } catch (error) {
        ctx.logger.error(`成员变动邮件发送失败 | group=${idText(event.group_id)} user=${idText(event.user_id)}:`, safeError(error, pluginState.config.mail?.password || ''));
    }
}

/**
 * 「发送测试邮件」填进入群变量的示例
 * 不查真实群和成员。子类型走管理员同意入群，这样 {{event_title}}、{{event_type}}、{{sub_type}}、{{event_detail}} 与真实入群信相同
 */
const TEST_JOIN_SAMPLE = {
    noticeType: 'group_increase',
    subType: 'approve',
    groupName: '示例群',
    groupId: '100000',
    memberName: '示例成员',
    memberId: '10001',
} as const;

/**
 * 发送测试邮件
 * 主题和正文是已保存的全局入群文案（空则用内置默认），变量按示例入群事件替换
 * to 只用于这一次试发，不会被保存，也不会变成入群 / 退群的收件人
 * 不读取某个群的入群覆盖；这个按钮只在全局邮件页
 */
export async function sendTestMail(
    ctx: NapCatPluginContext,
    toRaw: string,
): Promise<{ ok: true; to: string } | { ok: false; message: string }> {
    const mail = pluginState.config.mail;
    const configError = getMailConfigError(mail);
    if (configError) return { ok: false, message: `发信配置不完整：${configError}` };

    const mailbox = parseMailbox(toRaw);
    if (!mailbox) {
        return { ok: false, message: '请填写测试收件人邮箱。这只用于本次试发，入群和退群仍会发给成员自己的 QQ 邮箱（QQ号@qq.com）' };
    }

    // 与真实入群相同：全局入群模板，不带群覆盖；渲染、默认主题截断都走 buildMemberNoticeMail
    const template = resolveMemberMailTemplate(mail, undefined, 'join');
    const content = buildMemberNoticeMail({
        noticeType: TEST_JOIN_SAMPLE.noticeType,
        subType: TEST_JOIN_SAMPLE.subType,
        groupName: TEST_JOIN_SAMPLE.groupName,
        groupId: TEST_JOIN_SAMPLE.groupId,
        memberName: TEST_JOIN_SAMPLE.memberName,
        memberId: TEST_JOIN_SAMPLE.memberId,
        timestamp: formatTimestamp(Date.now()),
        subjectTemplate: template.subject,
        bodyTemplate: template.body,
    });
    if (!content || !content.subject.trim() || !content.text.trim()) {
        return { ok: false, message: '入群邮件文案为空，无法发送测试邮件' };
    }

    const now = Date.now();
    if (now - lastTestAt < 10000) {
        return { ok: false, message: '测试邮件发送过于频繁，请稍后再试' };
    }
    lastTestAt = now;

    try {
        await deliver(mail, mailbox.address, content.subject, content.text);
        ctx.logger.info(`测试邮件已按全局入群文案发送 | to=${mailbox.address}`);
        return { ok: true, to: mailbox.address };
    } catch (error) {
        const message = safeError(error, mail.password);
        ctx.logger.error(`测试邮件发送失败 | to=${mailbox.address}:`, message);
        return { ok: false, message: `测试邮件发送失败：${message}` };
    }
}

async function deliver(mail: MailSettings, to: string, subject: string, text: string): Promise<void> {
    const from = resolveSender(mail);
    if (!from) throw new Error('发件人地址无效');
    await sendSmtpMail({
        host: mail.host.trim(),
        port: mail.port,
        encryption: mail.encryption,
        username: mail.username.trim(),
        password: mail.password,
        fromAddress: from.address,
        fromHeader: formatFromHeader(from),
        to,
        subject,
        text,
    });
}

async function lookupNames(
    ctx: NapCatPluginContext,
    groupId: string,
    userId: string,
): Promise<{ groupName: string; memberName: string }> {
    let groupName = '';
    let memberName = '';

    try {
        const info = await ctx.actions.call(
            'get_group_info',
            { group_id: groupId },
            ctx.adapterName,
            ctx.pluginManager.config,
        ) as { group_name?: string } | null;
        if (typeof info?.group_name === 'string') groupName = info.group_name.trim();
    } catch (error) {
        ctx.logger.warn(`获取群名称失败，邮件里将使用「未知群」 | group=${groupId}:`, error);
    }

    // 刚入群用 no_cache，避免拿到旧缓存；退群后成员往往已经不在群里，失败再查陌生人资料
    try {
        const member = await ctx.actions.call(
            'get_group_member_info',
            { group_id: groupId, user_id: userId, no_cache: true },
            ctx.adapterName,
            ctx.pluginManager.config,
        ) as { card?: string; nickname?: string } | null;
        memberName = memberDisplayName(member);
    } catch {
        ctx.logger.debug(`群成员资料暂不可用，改为查询陌生人资料 | group=${groupId} user=${userId}`);
    }

    if (!memberName) {
        try {
            const stranger = await ctx.actions.call(
                'get_stranger_info',
                { user_id: userId },
                ctx.adapterName,
                ctx.pluginManager.config,
            ) as { nickname?: string } | null;
            if (typeof stranger?.nickname === 'string') memberName = stranger.nickname.trim();
        } catch (error) {
            ctx.logger.warn(`获取成员昵称失败，邮件里将使用「未知」 | user=${userId}:`, error);
        }
    }

    return {
        groupName: groupName || '未知群',
        memberName: memberName || '未知',
    };
}

function memberDisplayName(member: { card?: string; nickname?: string } | null): string {
    if (!member) return '';
    if (typeof member.card === 'string' && member.card.trim()) return member.card.trim();
    if (typeof member.nickname === 'string') return member.nickname.trim();
    return '';
}

function describeNotice(noticeType: string, subType: string): {
    title: string;
    typeLine: string;
    eventType: string;
    subTypeName: string;
} | null {
    if (noticeType === 'group_increase') {
        const known = subType === 'invite' ? '邀请入群' : subType === 'approve' ? '管理员同意入群' : '';
        return {
            title: '入群通知',
            eventType: '入群',
            // 默认文案仍只用认识的子类型；{{sub_type}} 在不认识时保留原始值
            subTypeName: known || safeSubType(subType),
            typeLine: known ? `入群（${known}）` : '入群',
        };
    }
    if (noticeType === 'group_decrease') {
        const subMap: Record<string, string> = {
            leave: '主动退群',
            kick: '被移出群',
            kick_me: '机器人被移出群',
        };
        const known = subMap[subType] || '';
        return {
            title: '退群通知',
            eventType: '退群',
            subTypeName: known || safeSubType(subType),
            typeLine: known ? `退群（${known}）` : '退群',
        };
    }
    return null;
}

function safeSubType(subType: string): string {
    return subType.replace(/[\r\n]/g, '').trim().slice(0, 40);
}

function formatTimestamp(time: unknown): string {
    let ms = Date.now();
    if (typeof time === 'number' && Number.isFinite(time) && time > 0) {
        ms = time < 1e12 ? time * 1000 : time;
    }
    const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(new Date(ms));
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
    const hour = pick('hour') === '24' ? '00' : pick('hour');
    return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}:${pick('second')}`;
}

function oneLine(value: string, fallback: string): string {
    const cleaned = value.replace(/[\r\n]/g, ' ').trim();
    return cleaned || fallback;
}

function idText(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === 'string') return value.trim();
    return '';
}

function isDuplicate(key: string): boolean {
    const now = Date.now();
    for (const [savedKey, savedAt] of recentSends) {
        if (now - savedAt > DEDUPE_MS) recentSends.delete(savedKey);
    }
    if (recentSends.has(key)) return true;
    recentSends.set(key, now);
    if (recentSends.size > 500) {
        const oldest = recentSends.keys().next().value;
        if (oldest) recentSends.delete(oldest);
    }
    return false;
}

function logIncomplete(ctx: NapCatPluginContext, reason: string): void {
    const now = Date.now();
    if (now - lastIncompleteWarnAt < 60 * 1000) return;
    lastIncompleteWarnAt = now;
    ctx.logger.warn(`成员变动邮件未发送：发信配置不完整（${reason}）`);
}

function safeError(error: unknown, secret: string): string {
    const message = error instanceof Error ? error.message : String(error);
    const redacted = secret ? message.split(secret).join('***') : message;
    return redacted.slice(0, 500);
}
