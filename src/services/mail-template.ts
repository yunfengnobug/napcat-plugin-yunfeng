/**
 * 入群 / 退群邮件的主题和正文
 * 全局的入群、退群各有一份文案。群上某一项留空就用全局对应项，不会因此发空白邮件。
 * 「与入群邮件一致」勾选后，退群改用解析后的入群主题和正文，变量仍按退群事件替换。
 * 旧配置没有退群字段时，仍把当时的文案抄给退群并保持不跟随，避免改掉已经在用的退群文字。
 */

import type { MailTemplate } from '../types';

/** 和改模板之前的主题一致。群名在这份默认主题里仍只取前 40 个字 */
export const DEFAULT_MAIL_SUBJECT = '【{{event_title}}】{{group_name}}';

/** 和改模板之前的正文一致 */
export const DEFAULT_MAIL_BODY = [
    '事件类型：{{event_detail}}',
    '群名称：{{group_name}}',
    '群号：{{group_id}}',
    '成员名称：{{member_name}}',
    '成员QQ：{{member_id}}',
    '时间：{{time}}',
].join('\n');

/** 默认主题里群名的字数，与原先写死的截断相同 */
const DEFAULT_SUBJECT_GROUP_NAME_LIMIT = 40;

/** 主题整体上限，避免邮件头过长 */
const SUBJECT_LIMIT = 200;

const SUBJECT_STORE_LIMIT = 300;
const BODY_STORE_LIMIT = 4000;

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface MailTemplateText {
    subject: string;
    body: string;
}

/** 主题存成一行 */
export function cleanTemplateSubject(value: unknown, limit = SUBJECT_STORE_LIMIT): string {
    if (typeof value !== 'string') return '';
    return value.replace(/[\r\n]+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim().slice(0, limit);
}

/** 正文保留换行。整段空白视为没填 */
export function cleanTemplateBody(value: unknown, limit = BODY_STORE_LIMIT): string {
    if (typeof value !== 'string') return '';
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, limit);
}

/** 解析时看的全局文案。留空会回退到内置默认，不会发空白邮件 */
export interface GlobalMailCopy {
    subject?: string;
    body?: string;
    leaveSubject?: string;
    leaveBody?: string;
    /** true：退群沿用入群文案。缺省或 false：退群单独用退群文案 */
    leaveFollowJoin?: boolean;
    /**
     * 管理员是否已经明确选过这个勾选
     * 旧配置拆分退群文案时会写成 true，避免之后打开开关又把退群改成跟随入群
     */
    leaveFollowJoinChosen?: boolean;
}

/**
 * 补齐全局退群文案
 * 旧配置没有退群字段时，把当时那套共用文案抄给退群，勾选保持关闭，并记为已经选定
 * 这样之后打开「退群邮件」不会再把这份退群文字改成跟随入群
 * 已经单独存过退群文案或勾选时，不用入群文案覆盖退群；退群文字被清空则回到内置默认
 */
export function normalizeGlobalLeaveCopy<T extends GlobalMailCopy & {
    subject: string;
    body: string;
    leaveSubject: string;
    leaveBody: string;
    leaveFollowJoin: boolean;
    leaveFollowJoinChosen?: boolean;
}>(mail: T, raw: object): T {
    const record = raw as Record<string, unknown>;
    const hasLeaveSubject = 'leaveSubject' in record;
    const hasLeaveBody = 'leaveBody' in record;
    const hasLeaveFollow = 'leaveFollowJoin' in record;
    if (!hasLeaveSubject && !hasLeaveBody && !hasLeaveFollow) {
        return {
            ...mail,
            leaveFollowJoin: false,
            leaveFollowJoinChosen: true,
            leaveSubject: mail.subject,
            leaveBody: mail.body,
        };
    }
    return {
        ...mail,
        leaveFollowJoin: record.leaveFollowJoin === true,
        leaveFollowJoinChosen: record.leaveFollowJoinChosen === true,
        leaveSubject: hasLeaveSubject
            ? (cleanTemplateSubject(record.leaveSubject) || DEFAULT_MAIL_SUBJECT)
            : mail.leaveSubject,
        leaveBody: hasLeaveBody
            ? (cleanTemplateBody(record.leaveBody) || DEFAULT_MAIL_BODY)
            : mail.leaveBody,
    };
}

/**
 * 某个群刚打开退群邮件时，要不要把「与入群邮件一致」写成 true
 * 入群邮件没开、已经明确选过跟随或不跟随、或已经写过退群主题/正文时，都不要改
 * 旧数据把共用文案拆开时会写成 leaveFollowJoin false，这里会直接跳过，不覆盖那份退群文字
 */
export function groupLeaveFollowShouldDefault(
    template: GroupMailCopyOverride | null | undefined,
    joinEnabled: boolean,
    leaveEnabled: boolean,
): boolean {
    if (!leaveEnabled || !joinEnabled) return false;
    if (!template) return true;
    if (template.leaveFollowJoin === true || template.leaveFollowJoin === false) return false;
    if (cleanTemplateSubject(template.leaveSubject) || cleanTemplateBody(template.leaveBody)) return false;
    return true;
}

/**
 * 全局刚打开退群邮件时，要不要把勾选改成 true
 * 管理员手动改过勾选、退群文字和入群不同、或已经不是内置默认文案时，保持原勾选
 * 出厂配置的勾选是关闭，但还没人改过文字，也没钉住这个选择，这时才改成跟随入群
 */
export function globalLeaveFollowShouldDefault(mail: GlobalMailCopy): boolean {
    if (mail.leaveFollowJoinChosen === true) return false;
    if (mail.leaveFollowJoin === true) return false;
    const subject = cleanTemplateSubject(mail.subject);
    const body = cleanTemplateBody(mail.body);
    const leaveSubject = cleanTemplateSubject(mail.leaveSubject);
    const leaveBody = cleanTemplateBody(mail.leaveBody);
    if (subject !== leaveSubject || body !== leaveBody) return false;
    if (subject !== DEFAULT_MAIL_SUBJECT || body !== DEFAULT_MAIL_BODY) return false;
    if (leaveSubject !== DEFAULT_MAIL_SUBJECT || leaveBody !== DEFAULT_MAIL_BODY) return false;
    return true;
}

/**
 * 群还在跟随全局勾选，并且自己写过退群主题或正文
 * 这时如果把全局勾选改成跟随入群，这份退群文字就不会再被发出去
 */
export function inheritedGroupOwnsLeaveCopy(template: GroupMailCopyOverride | null | undefined): boolean {
    if (!template) return false;
    if (template.leaveFollowJoin === true || template.leaveFollowJoin === false) return false;
    return !!(cleanTemplateSubject(template.leaveSubject) || cleanTemplateBody(template.leaveBody));
}

/**
 * 群覆盖
 * 文本留空表示这一项沿用全局
 * leaveFollowJoin 为 null 或缺省表示跟随全局勾选
 */
export interface GroupMailCopyOverride {
    subject?: string;
    body?: string;
    leaveSubject?: string;
    leaveBody?: string;
    leaveFollowJoin?: boolean | null;
}

/**
 * 群覆盖
 * 入群、退群的主题和正文都空，且没有单独指定「与入群邮件一致」时，当作没有覆盖
 * 只填了其中一项时，空着的那一项留给全局
 * 旧配置只有 subject/body、没有退群字段时：把当时那套文案同时留给退群，并明确不跟随入群，
 * 这样已保存的退群文字不会被改成另一套，之后勾上全局也不会把这份群覆盖盖掉
 */
export function normalizeGroupMailTemplate(raw: unknown): MailTemplate | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const subject = cleanTemplateSubject(record.subject);
    const body = cleanTemplateBody(record.body);
    const hasLeaveSubject = 'leaveSubject' in record;
    const hasLeaveBody = 'leaveBody' in record;
    const hasFollow = 'leaveFollowJoin' in record;

    let leaveSubject = '';
    let leaveBody = '';
    let leaveFollowJoin: boolean | undefined;
    if (!hasLeaveSubject && !hasLeaveBody && !hasFollow) {
        if (subject || body) {
            leaveSubject = subject;
            leaveBody = body;
            leaveFollowJoin = false;
        }
    } else {
        if (hasLeaveSubject) leaveSubject = cleanTemplateSubject(record.leaveSubject);
        if (hasLeaveBody) leaveBody = cleanTemplateBody(record.leaveBody);
        if (record.leaveFollowJoin === true) leaveFollowJoin = true;
        else if (record.leaveFollowJoin === false) leaveFollowJoin = false;
    }

    if (!subject && !body && !leaveSubject && !leaveBody && leaveFollowJoin === undefined) {
        return undefined;
    }

    const template: MailTemplate = { subject, body, leaveSubject, leaveBody };
    if (leaveFollowJoin !== undefined) template.leaveFollowJoin = leaveFollowJoin;
    return template;
}

/**
 * 选出这次发信要用的主题和正文
 * 群上留空的那一项回退到全局，全局也空则用内置默认文案
 * 退群在勾选「与入群邮件一致」时，用的是解析后的入群文案（含本群入群覆盖），不是把变量写成入群
 */
export function resolveMemberMailTemplate(
    globalMail: GlobalMailCopy,
    override?: GroupMailCopyOverride | null,
    kind: 'join' | 'leave' = 'join',
): MailTemplateText {
    const joinSubject = cleanTemplateSubject(override?.subject)
        || cleanTemplateSubject(globalMail.subject)
        || DEFAULT_MAIL_SUBJECT;
    const joinBody = cleanTemplateBody(override?.body)
        || cleanTemplateBody(globalMail.body)
        || DEFAULT_MAIL_BODY;
    if (kind !== 'leave') return { subject: joinSubject, body: joinBody };

    const follow = typeof override?.leaveFollowJoin === 'boolean'
        ? override.leaveFollowJoin
        : globalMail.leaveFollowJoin === true;
    if (follow) return { subject: joinSubject, body: joinBody };

    return {
        subject: cleanTemplateSubject(override?.leaveSubject)
            || cleanTemplateSubject(globalMail.leaveSubject)
            || DEFAULT_MAIL_SUBJECT,
        body: cleanTemplateBody(override?.leaveBody)
            || cleanTemplateBody(globalMail.leaveBody)
            || DEFAULT_MAIL_BODY,
    };
}

function truncateChars(value: string, limit: number): string {
    return Array.from(value).slice(0, limit).join('');
}

function applyVars(template: string, vars: Record<string, string>): string {
    return template.replace(VAR_RE, (_match, key: string) => {
        const value = vars[key];
        return typeof value === 'string' ? value : '';
    });
}

function singleLine(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * 渲染一封入群 / 退群邮件
 * 默认主题未改时，群名仍截到 40 个字；自定义主题里的 {{group_name}} 用完整群名
 * 渲染结果如果是空的，回退到内置文案，避免发出空白邮件
 */
export function renderMemberMailContent(
    templates: MailTemplateText,
    vars: Record<string, string>,
): { subject: string; text: string } {
    const subjectTpl = templates.subject.trim() || DEFAULT_MAIL_SUBJECT;
    const bodyTpl = templates.body.trim() ? templates.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : DEFAULT_MAIL_BODY;
    const subjectVars = subjectTpl === DEFAULT_MAIL_SUBJECT
        ? { ...vars, group_name: truncateChars(vars.group_name || '', DEFAULT_SUBJECT_GROUP_NAME_LIMIT) }
        : vars;

    let subject = singleLine(applyVars(subjectTpl, subjectVars));
    if (!subject) {
        subject = singleLine(applyVars(DEFAULT_MAIL_SUBJECT, {
            ...vars,
            group_name: truncateChars(vars.group_name || '', DEFAULT_SUBJECT_GROUP_NAME_LIMIT),
        }));
    }
    subject = truncateChars(subject, SUBJECT_LIMIT);

    let text = applyVars(bodyTpl, vars).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!text.trim()) text = applyVars(DEFAULT_MAIL_BODY, vars);
    return { subject, text };
}
