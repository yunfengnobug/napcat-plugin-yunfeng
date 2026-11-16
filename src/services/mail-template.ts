/**
 * 入群 / 退群邮件的主题和正文
 * 全局有一份默认文案；群上的对应字段留空就用全局，不会因此发空白邮件。
 */

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

/**
 * 群覆盖：两项都空则当作没有覆盖
 * 只填了主题或只填了正文时，另一项留给全局
 */
export function normalizeGroupMailTemplate(raw: unknown): MailTemplateText | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const subject = cleanTemplateSubject(record.subject);
    const body = cleanTemplateBody(record.body);
    if (!subject && !body) return undefined;
    return { subject, body };
}

/**
 * 群上留空的那一项回退到全局，全局也空则用内置默认文案
 */
export function resolveMemberMailTemplate(
    globalSubject: string,
    globalBody: string,
    override?: { subject?: string; body?: string } | null,
): MailTemplateText {
    return {
        subject: cleanTemplateSubject(override?.subject) || cleanTemplateSubject(globalSubject) || DEFAULT_MAIL_SUBJECT,
        body: cleanTemplateBody(override?.body) || cleanTemplateBody(globalBody) || DEFAULT_MAIL_BODY,
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
