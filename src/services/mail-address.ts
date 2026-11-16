/**
 * 发件人地址与显示名
 * SMTP 的 From 头可以是纯地址，也可以是「名称 <地址>」。
 * 配置里把这两部分分开存；读到旧的合并写法时再拆开。
 */

export interface Mailbox {
    name: string;
    address: string;
}

const ADDRESS_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * 解析邮箱。支持 `name@example.com` 和 `名称 <name@example.com>`。
 * 含换行的输入直接拒绝，避免把邮件头拆开。
 */
export function parseMailbox(input: string): Mailbox | null {
    const raw = input.trim();
    if (!raw || /[\r\n]/.test(raw)) return null;
    const angled = raw.match(/^(.*)<([^<>]+)>$/);
    const address = (angled ? angled[2] : raw).trim();
    const name = angled ? angled[1].trim().replace(/^"|"$/g, '') : '';
    if (!ADDRESS_RE.test(address)) return null;
    if (/[\r\n]/.test(name)) return null;
    return { name, address };
}

/** 显示名去掉换行和尖括号，避免写进 From 头时把地址弄断 */
export function cleanDisplayName(value: string): string {
    return value
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, 80);
}

/**
 * 把配置里的发件人收成「地址 + 显示名」
 * - 没有 fromName 字段、但 from 写成 `名称 <邮箱>`：名称拆出来，地址单独留下
 * - 已经带了 fromName（包括空字符串）：以它为准，不再从 from 里捡回旧名称
 * 这样清空显示名之后，不会被旧的合并写法填回去
 */
export function normalizeMailSender(
    fromInput: string,
    fromNameInput: string | undefined,
    hasFromName: boolean,
): { from: string; fromName: string } {
    const raw = fromInput.replace(/[\r\n]/g, ' ').trim().slice(0, 500);
    const parsed = parseMailbox(raw);
    const from = (parsed ? parsed.address : raw).slice(0, 320);
    let fromName = '';
    if (hasFromName) fromName = cleanDisplayName(fromNameInput || '');
    else if (parsed?.name) fromName = cleanDisplayName(parsed.name);
    return { from, fromName };
}

/** 非 ASCII 的显示名按 RFC 2047 编码，过长时拆成多段，避免一条编码词超限 */
function encodeDisplayName(value: string): string {
    if (/^[\t\x20-\x7E]*$/.test(value)) return value;
    const chars = Array.from(value);
    const words: string[] = [];
    let index = 0;
    while (index < chars.length) {
        let size = Math.min(15, chars.length - index);
        let word = '';
        while (size > 0) {
            const part = chars.slice(index, index + size).join('');
            word = `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`;
            if (word.length <= 75) break;
            size -= 1;
        }
        if (size <= 0) break;
        words.push(word);
        index += size;
    }
    return words.join('\r\n ');
}

/**
 * 组装 From 头
 * 没有显示名时只写地址，收件箱可能会改用 @ 前面的一段作为名字
 */
export function formatFromHeader(mailbox: Mailbox): string {
    const name = cleanDisplayName(mailbox.name);
    if (!name) return mailbox.address;
    if (/^[\t\x20-\x7E]*$/.test(name)) {
        return `"${name.replace(/["\\]/g, '')}" <${mailbox.address}>`;
    }
    return `${encodeDisplayName(name)} <${mailbox.address}>`;
}

/**
 * 发信时用的发件人
 * 没有 fromName 字段时，才从旧的 `名称 <邮箱>` 里取显示名
 * fromName 已经是空字符串，表示用户不要显示名，只发地址
 */
export function resolveSender(mail: { from: string; fromName?: string }): Mailbox | null {
    const hasFromName = typeof mail.fromName === 'string';
    const normalized = normalizeMailSender(mail.from, mail.fromName, hasFromName);
    const parsed = parseMailbox(normalized.from);
    if (!parsed) return null;
    return { name: normalized.fromName, address: parsed.address };
}
