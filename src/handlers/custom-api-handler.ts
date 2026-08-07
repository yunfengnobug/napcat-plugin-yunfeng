/**
 * 自定义 API 功能
 * 群消息（需功能开启）或私聊命中规则后：请求外部接口 → 按模板拼话术 → 发到指定群/好友
 */

import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { pluginState } from '../core/state';
import type { CustomApiRule } from '../types';

const FETCH_TIMEOUT_MS = 15000;

/** 触发匹配结果 */
interface TriggerMatch {
    matched: boolean;
    /** 完整匹配串 → {{match}} */
    match?: string;
    /** 序号捕获组 → {{match1}} {{match2}}… */
    groups?: string[];
    /** 命名捕获组 (?<city>…) → {{city}} */
    named?: Record<string, string>;
}

/** 发送群/私聊消息 */
async function sendMsg(
    ctx: NapCatPluginContext,
    params: {
        message: string;
        message_type: 'group' | 'private';
        group_id?: string;
        user_id?: string;
    },
): Promise<void> {
    await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
}

/**
 * 判断消息是否命中规则触发条件
 */
function matchTrigger(text: string, rule: CustomApiRule): TriggerMatch {
    const pattern = rule.trigger;
    if (!pattern) return { matched: false };

    if (rule.triggerType === 'exact') {
        return text === pattern ? { matched: true, match: text } : { matched: false };
    }

    if (rule.triggerType === 'fuzzy') {
        return text.includes(pattern)
            ? { matched: true, match: pattern }
            : { matched: false };
    }

    // regex：支持序号组 match1… 与命名组 (?<name>…)
    try {
        const re = new RegExp(pattern);
        const m = text.match(re);
        if (!m) return { matched: false };
        const named: Record<string, string> = {};
        if (m.groups) {
            for (const [k, v] of Object.entries(m.groups)) {
                named[k] = v == null ? '' : String(v);
            }
        }
        return {
            matched: true,
            match: m[0],
            groups: m.slice(1).map((x) => (x == null ? '' : String(x))),
            named,
        };
    } catch (e) {
        pluginState.logger.warn(`自定义 API 正则无效 [${rule.name}]:`, e);
        return { matched: false };
    }
}

/** 按点路径取值，如 data.user.name / list.0.id */
function getByPath(root: unknown, path: string): unknown {
    if (!path) return root;
    const parts = path.split('.').filter(Boolean);
    let cur: unknown = root;
    for (const p of parts) {
        if (cur == null) return undefined;
        if (Array.isArray(cur)) {
            const idx = Number(p);
            if (!Number.isInteger(idx)) return undefined;
            cur = cur[idx];
            continue;
        }
        if (typeof cur === 'object') {
            cur = (cur as Record<string, unknown>)[p];
            continue;
        }
        return undefined;
    }
    return cur;
}

/** 值转模板文本 */
function valueToText(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

/**
 * 渲染模板占位符
 * 支持：{{msg}} {{user_id}} {{group_id}} {{nickname}} {{match}} {{match1}} {{命名组}}
 *      接口返回对象 {{res}} / {{res.字段}}（兼容旧写法 {{body}} {{json}}）
 */
function renderTemplate(
    template: string,
    vars: Record<string, string>,
    responseJson: unknown,
    responseText: string,
): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_all, key: string) => {
        // 接口返回：整段对象 / 字段路径
        if (key === 'res') {
            return responseJson !== undefined && responseJson !== null
                ? valueToText(responseJson)
                : responseText;
        }
        if (key.startsWith('res.')) {
            const fromRes = getByPath(responseJson, key.slice(4));
            return fromRes !== undefined ? valueToText(fromRes) : '';
        }
        // 兼容旧占位符
        if (key === 'body' || key === 'text') return responseText;
        if (key === 'json') {
            try {
                return JSON.stringify(responseJson ?? responseText);
            } catch {
                return responseText;
            }
        }
        if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? '';
        const fromRoot = getByPath(responseJson, key);
        if (fromRoot !== undefined) return valueToText(fromRoot);
        return '';
    });
}

/** 构建基础占位变量（含正则命名组） */
function buildBaseVars(event: OB11Message, trigger: TriggerMatch): Record<string, string> {
    const vars: Record<string, string> = {
        msg: event.raw_message || '',
        user_id: String(event.user_id ?? ''),
        group_id: event.group_id != null ? String(event.group_id) : '',
        nickname: String((event.sender as { nickname?: string })?.nickname || ''),
        match: trigger.match || '',
        ...(trigger.named || {}),
    };
    (trigger.groups || []).forEach((g, i) => {
        vars[`match${i + 1}`] = g;
    });
    return vars;
}

/** 将 JSON 对象模板渲染为 string 字典 */
function renderObjectTemplate(
    template: string,
    vars: Record<string, string>,
): Record<string, string> {
    const raw = renderTemplate(template || '{}', vars, null, '');
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch {
        throw new Error('参数模板不是合法 JSON 对象');
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('参数模板必须是 JSON 对象');
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = valueToText(v);
    }
    return out;
}

/** 把 query 对象拼到 URL */
function appendQuery(url: string, query: Record<string, string>): string {
    const keys = Object.keys(query);
    if (keys.length === 0) return url;
    const u = new URL(url);
    for (const [k, v] of Object.entries(query)) {
        u.searchParams.set(k, v);
    }
    return u.toString();
}

/**
 * 请求外部接口并返回文本 / JSON
 */
async function callExternalApi(
    rule: CustomApiRule,
    vars: Record<string, string>,
): Promise<{ text: string; json: unknown }> {
    let url = renderTemplate(rule.url, vars, null, '');
    if (rule.queryTemplate?.trim()) {
        const query = renderObjectTemplate(rule.queryTemplate, vars);
        url = appendQuery(url, query);
    }

    const headers: Record<string, string> = { ...(rule.headers || {}) };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const init: RequestInit = {
            method: rule.method,
            headers,
            signal: controller.signal,
        };

        const bodyType = rule.bodyType || 'none';
        const canHaveBody = rule.method !== 'GET' && rule.method !== 'HEAD';

        if (canHaveBody && bodyType !== 'none') {
            if (bodyType === 'json') {
                const body = renderTemplate(rule.bodyTemplate || '{}', vars, null, '');
                if (!headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'application/json';
                }
                init.body = body;
            } else if (bodyType === 'raw') {
                init.body = renderTemplate(rule.bodyTemplate || '', vars, null, '');
            } else if (bodyType === 'form') {
                const obj = renderObjectTemplate(rule.bodyTemplate || '{}', vars);
                const sp = new URLSearchParams();
                for (const [k, v] of Object.entries(obj)) sp.set(k, v);
                if (!headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'application/x-www-form-urlencoded';
                }
                init.body = sp.toString();
            } else if (bodyType === 'multipart') {
                const obj = renderObjectTemplate(rule.bodyTemplate || '{}', vars);
                const fd = new FormData();
                for (const [k, v] of Object.entries(obj)) fd.append(k, v);
                // 让 fetch 自动带 multipart boundary，勿手动设 Content-Type
                delete headers['Content-Type'];
                delete headers['content-type'];
                init.body = fd;
            }
            init.headers = headers;
        }

        const res = await fetch(url, init);
        const text = await res.text();
        let json: unknown = null;
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }
        if (!res.ok) {
            pluginState.logger.warn(
                `自定义 API HTTP ${res.status} [${rule.name}] ${url}`
            );
        }
        return { text, json };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 按规则发送拼好的话术到目标
 * 若开启「回复当前会话」，下方勾选的同一群/好友会跳过，避免重复推送
 */
async function dispatchReply(
    ctx: NapCatPluginContext,
    event: OB11Message,
    rule: CustomApiRule,
    message: string,
): Promise<void> {
    const text = message.trim();
    if (!text) return;

    /** 已发送过的目标：group:xxx / private:xxx */
    const sent = new Set<string>();

    if (rule.replyToCurrent) {
        if (event.message_type === 'group' && event.group_id) {
            const key = `group:${event.group_id}`;
            await sendMsg(ctx, {
                message: text,
                message_type: 'group',
                group_id: String(event.group_id),
            });
            sent.add(key);
        } else if (event.message_type === 'private' && event.user_id) {
            const key = `private:${event.user_id}`;
            await sendMsg(ctx, {
                message: text,
                message_type: 'private',
                user_id: String(event.user_id),
            });
            sent.add(key);
        }
    }

    for (const gid of rule.targetGroupIds || []) {
        const key = `group:${gid}`;
        if (sent.has(key)) continue;
        await sendMsg(ctx, {
            message: text,
            message_type: 'group',
            group_id: String(gid),
        });
        sent.add(key);
    }

    for (const uid of rule.targetUserIds || []) {
        const key = `private:${uid}`;
        if (sent.has(key)) continue;
        await sendMsg(ctx, {
            message: text,
            message_type: 'private',
            user_id: String(uid),
        });
        sent.add(key);
    }
}

/**
 * 处理自定义 API：按规则顺序匹配并请求外部接口
 * oncePerMessage 为 true（默认）时，一条消息只调用命中的第一条规则
 * @returns 是否已处理
 */
export async function handleCustomApi(
    ctx: NapCatPluginContext,
    event: OB11Message,
): Promise<boolean> {
    const rawMessage = event.raw_message || '';
    if (!rawMessage) return false;

    // 群聊：必须授权+开机+功能开；私聊：允许触发（目标仍按规则发送）
    if (event.message_type === 'group' && event.group_id) {
        if (!pluginState.isFeatureEnabled(String(event.group_id), 'customApi')) {
            return false;
        }
    } else if (event.message_type !== 'private') {
        return false;
    }

    const oncePerMessage = pluginState.config.customApiOncePerMessage !== false;
    const rules = pluginState.config.customApiRules || [];
    let handled = false;

    for (const rule of rules) {
        if (!rule.enabled) continue;

        const trigger = matchTrigger(rawMessage, rule);
        if (!trigger.matched) continue;

        const vars = buildBaseVars(event, trigger);
        try {
            pluginState.logger.info(`自定义 API 命中规则「${rule.name}」`);
            const { text, json } = await callExternalApi(rule, vars);
            const reply = renderTemplate(
                rule.replyTemplate || '{{res}}',
                vars,
                json,
                text,
            );
            await dispatchReply(ctx, event, rule, reply);
            pluginState.incrementProcessed();
            handled = true;
            if (oncePerMessage) return true;
        } catch (e) {
            pluginState.logger.error(`自定义 API 执行失败「${rule.name}」:`, e);
            handled = true;
            if (oncePerMessage) return true;
        }
    }

    return handled;
}
