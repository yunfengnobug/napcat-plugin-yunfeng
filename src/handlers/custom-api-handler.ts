/**
 * 自定义 API 功能
 * 群消息（需功能开启）或私聊命中规则后：按 steps 串行请求外部接口 → 拼话术 → 发到指定群/好友
 * 第 n 步返回为 resN；须等上一步结束才发下一步；支持每步超时与严格中止
 */

import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { pluginState } from '../core/state';
import type { CustomApiExpectedCondition, CustomApiRule, CustomApiStep } from '../types';

/** 单步默认超时（毫秒），与配置清洗一致 */
const DEFAULT_STEP_TIMEOUT_MS = 8000;

/** 触发匹配结果 */
interface TriggerMatch {
    matched: boolean;
    match?: string;
    groups?: string[];
    named?: Record<string, string>;
}

/** 单步响应缓存：res / res1 / res2… */
interface StepResponse {
    json: unknown;
    text: string;
    /** HTTP 状态码（测试接口展示用） */
    status?: number;
    /** 渲染后的最终请求 URL */
    finalUrl?: string;
}

/** WebUI 试跑：单步结果 */
export interface CustomApiTestStepResult {
    index: number;
    name: string;
    method: string;
    url: string;
    status: number | null;
    httpOk: boolean;
    durationMs: number;
    text: string;
    json: unknown;
    expectOk: boolean;
    expectMessage: string | null;
    error: string | null;
}

/** WebUI 试跑：触发匹配详情 */
export interface CustomApiTestMatchInfo {
    /** 用于试跑的模拟消息 */
    mockMsg: string;
    triggerType: CustomApiRule['triggerType'];
    trigger: string;
    /** 模拟消息是否命中触发条件 */
    matched: boolean;
    /** {{match}} 整段匹配内容 */
    match: string | null;
    /** {{match1}}… 捕获组 */
    groups: string[];
    /** 命名捕获组 → {{name}} */
    named: Record<string, string>;
}

/** WebUI 试跑：整体结果（不发送消息） */
export interface CustomApiTestResult {
    steps: CustomApiTestStepResult[];
    /** 触发匹配结果（模拟消息对规则的命中情况） */
    match: CustomApiTestMatchInfo;
    replyPreview: string | null;
    replyError: string | null;
    aborted: boolean;
    abortReason: string | null;
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

/** 判断消息是否命中规则触发条件 */
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

/** 按点路径取值 */
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

/** 判断路径是否存在（含 null 值也算存在） */
function hasPath(root: unknown, path: string): boolean {
    if (!path) return root !== undefined;
    const parts = path.split('.').filter(Boolean);
    let cur: unknown = root;
    for (const p of parts) {
        if (cur == null || (typeof cur !== 'object' && !Array.isArray(cur))) return false;
        if (Array.isArray(cur)) {
            const idx = Number(p);
            if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return false;
            cur = cur[idx];
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(cur, p)) return false;
        cur = (cur as Record<string, unknown>)[p];
    }
    return true;
}

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

/** 解析占位符对应的响应：res / res1 / res2… */
function resolveResponseKey(
    key: string,
    responses: Record<string, StepResponse>,
): { resp: StepResponse | undefined; path: string } | null {
    if (key === 'res' || key === 'body' || key === 'text' || key === 'json') {
        return { resp: responses.res, path: '' };
    }
    if (key.startsWith('res.')) {
        return { resp: responses.res, path: key.slice(4) };
    }
    const m = key.match(/^res(\d+)(?:\.(.*))?$/);
    if (m) {
        const name = `res${m[1]}`;
        return { resp: responses[name], path: m[2] || '' };
    }
    return null;
}

/**
 * 渲染模板占位符
 * 支持 msg/user_id/group_id/nickname/match… 与 res / res1.字段 / res2…
 */
function renderTemplate(
    template: string,
    vars: Record<string, string>,
    responses: Record<string, StepResponse>,
): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_all, key: string) => {
        const resolved = resolveResponseKey(key, responses);
        if (resolved) {
            const { resp, path } = resolved;
            if (!resp) return '';
            if (key === 'body' || key === 'text') return resp.text;
            if (key === 'json') {
                try {
                    return JSON.stringify(resp.json ?? resp.text);
                } catch {
                    return resp.text;
                }
            }
            if (!path) {
                return resp.json !== undefined && resp.json !== null
                    ? valueToText(resp.json)
                    : resp.text;
            }
            const fromRes = getByPath(resp.json, path);
            return fromRes !== undefined ? valueToText(fromRes) : '';
        }
        if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? '';
        // 兼容：裸字段从最后一步 JSON 取
        const last = responses.res;
        if (last?.json != null) {
            const fromRoot = getByPath(last.json, key);
            if (fromRoot !== undefined) return valueToText(fromRoot);
        }
        return '';
    });
}

/**
 * 检查模板中引用的变量是否都存在
 * 消息类变量以 vars 为准；resN / resN.path 以 responses 为准
 */
function findMissingPlaceholders(
    template: string,
    vars: Record<string, string>,
    responses: Record<string, StepResponse>,
): string[] {
    const missing: string[] = [];
    const re = /\{\{\s*([\w.]+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template || '')) !== null) {
        const key = m[1];
        if (key === 'body' || key === 'text' || key === 'json') {
            if (!responses.res) missing.push(key);
            continue;
        }
        const resolved = resolveResponseKey(key, responses);
        if (resolved) {
            const { resp, path } = resolved;
            if (!resp) {
                missing.push(key);
                continue;
            }
            if (path && !hasPath(resp.json, path)) {
                missing.push(key);
            }
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(vars, key)) {
            // 裸字段：仅当最后一步存在该路径时算有
            const last = responses.res;
            if (!last?.json || !hasPath(last.json, key)) {
                missing.push(key);
            }
        }
    }
    return [...new Set(missing)];
}

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

function renderObjectTemplate(
    template: string,
    vars: Record<string, string>,
    responses: Record<string, StepResponse>,
): Record<string, string> {
    const raw = renderTemplate(template || '{}', vars, responses);
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

function appendQuery(url: string, query: Record<string, string>): string {
    const keys = Object.keys(query);
    if (keys.length === 0) return url;
    const u = new URL(url);
    for (const [k, v] of Object.entries(query)) {
        u.searchParams.set(k, v);
    }
    return u.toString();
}

/** 本步是否会发送 Body（GET/HEAD 或 bodyType=none 时不会） */
function stepSendsBody(step: CustomApiStep): boolean {
    if (step.method === 'GET' || step.method === 'HEAD') return false;
    return (step.bodyType || 'none') !== 'none';
}

/**
 * 调用单步外部接口（串行链中的一步）
 * @throws 超时或网络错误
 */
async function callStepApi(
    ruleName: string,
    step: CustomApiStep,
    stepIndex: number,
    vars: Record<string, string>,
    responses: Record<string, StepResponse>,
): Promise<StepResponse> {
    let url = renderTemplate(step.url, vars, responses);
    if (step.queryTemplate?.trim()) {
        const query = renderObjectTemplate(step.queryTemplate, vars, responses);
        url = appendQuery(url, query);
    }

    // 请求头值也支持 {{变量}}
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(step.headers || {})) {
        headers[k] = renderTemplate(String(v ?? ''), vars, responses);
    }
    const timeoutMs = step.timeoutMs > 0 ? step.timeoutMs : DEFAULT_STEP_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const init: RequestInit = {
            method: step.method,
            headers,
            signal: controller.signal,
        };

        const bodyType = step.bodyType || 'none';
        const canHaveBody = stepSendsBody(step);

        if (canHaveBody && bodyType !== 'none') {
            if (bodyType === 'json') {
                const body = renderTemplate(step.bodyTemplate || '{}', vars, responses);
                if (!headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'application/json';
                }
                init.body = body;
            } else if (bodyType === 'raw') {
                init.body = renderTemplate(step.bodyTemplate || '', vars, responses);
            } else if (bodyType === 'form') {
                const obj = renderObjectTemplate(step.bodyTemplate || '{}', vars, responses);
                const sp = new URLSearchParams();
                for (const [k, v] of Object.entries(obj)) sp.set(k, v);
                if (!headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'application/x-www-form-urlencoded';
                }
                init.body = sp.toString();
            } else if (bodyType === 'multipart') {
                const obj = renderObjectTemplate(step.bodyTemplate || '{}', vars, responses);
                const fd = new FormData();
                for (const [k, v] of Object.entries(obj)) fd.append(k, v);
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
                `自定义 API HTTP ${res.status} [${ruleName}] 步骤${stepIndex + 1} ${url}`,
            );
        }
        return { text, json, status: res.status, finalUrl: url };
    } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError';
        const err = new Error(
            aborted
                ? `步骤${stepIndex + 1}「${step.name}」超时（${timeoutMs}ms）`
                : `步骤${stepIndex + 1}「${step.name}」请求失败: ${e instanceof Error ? e.message : String(e)}`,
        ) as Error & { finalUrl?: string };
        err.finalUrl = url;
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/** 把配置里的期望值解析成可比较类型 */
function parseExpectedValue(raw: string): unknown {
    const s = raw.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    try {
        return JSON.parse(s);
    } catch {
        return s;
    }
}

/** 值是否相等（数字/布尔按常见接口习惯宽松比较） */
function valuesEqual(actual: unknown, expected: unknown): boolean {
    if (Object.is(actual, expected)) return true;
    if (actual == null || expected == null) return actual === expected;
    if (typeof expected === 'boolean') {
        if (typeof actual === 'boolean') return actual === expected;
        if (expected === true) return actual === 1 || actual === '1' || actual === 'true';
        return actual === 0 || actual === '0' || actual === 'false';
    }
    if (typeof expected === 'number' && (typeof actual === 'number' || typeof actual === 'string')) {
        return Number(actual) === expected;
    }
    if (typeof actual === 'number' && typeof expected === 'string' && /^-?\d+(\.\d+)?$/.test(expected)) {
        return actual === Number(expected);
    }
    return String(actual) === String(expected);
}

/**
 * 校验预期返回条件（最多 2 条，且/或）
 * - value 为空：仅要求路径存在
 * - value 非空：渲染 {{变量}} 后再与实际值比较
 * @returns 失败原因；通过则 null
 */
function checkExpectedConditions(
    json: unknown,
    conditions: CustomApiExpectedCondition[],
    logic: 'and' | 'or',
    stepIndex: number,
    vars: Record<string, string>,
    responses: Record<string, StepResponse>,
): string | null {
    if (!conditions.length) return null;
    const stepKey = `res${stepIndex + 1}`;
    const results = conditions.map((c) => {
        const rawPath = c.path.trim();
        // 去掉 res1. / res2. / 旧版 res. 前缀，在本步 JSON 上取值
        const fieldPath = rawPath.replace(/^res\d*\./, '');
        const displayPath = fieldPath ? `${stepKey}.${fieldPath}` : stepKey;
        if (!fieldPath) {
            return { ok: false, detail: `${displayPath} 路径无效` };
        }
        // 若写了 res2.xxx 却在第 1 步校验，视为不匹配
        const prefixMatch = rawPath.match(/^(res\d+)\./);
        if (prefixMatch && prefixMatch[1] !== stepKey) {
            return { ok: false, detail: `${rawPath} 不属于本步 ${stepKey}` };
        }
        if (!hasPath(json, fieldPath)) {
            return { ok: false, detail: `${displayPath} 不存在` };
        }
        const expectRaw = (c.value ?? '').trim();
        // 空 value：只要 key 存在即通过
        if (!expectRaw) {
            return { ok: true, detail: '' };
        }
        const miss = findMissingPlaceholders(expectRaw, vars, responses);
        if (miss.length) {
            return { ok: false, detail: `${displayPath} 期望值变量不存在：${miss.join(', ')}` };
        }
        const rendered = renderTemplate(expectRaw, vars, responses);
        const expected = parseExpectedValue(rendered);
        const actual = getByPath(json, fieldPath);
        const ok = valuesEqual(actual, expected);
        return {
            ok,
            detail: ok
                ? ''
                : `${displayPath} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
        };
    });

    if (logic === 'or') {
        if (results.some((r) => r.ok)) return null;
        return `预期条件（或）均未满足：${results.map((r) => r.detail).join('；')}`;
    }
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) return null;
    return `预期条件（且）未满足：${failed.map((r) => r.detail).join('；')}`;
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
 * 串行执行规则全部步骤，成功则拼话术并发送
 * @returns 'sent' | 'aborted' | 'error'
 */
async function runRuleChain(
    ctx: NapCatPluginContext,
    event: OB11Message,
    rule: CustomApiRule,
    vars: Record<string, string>,
): Promise<'sent' | 'aborted' | 'error'> {
    const steps = rule.steps || [];
    if (steps.length === 0) return 'aborted';

    const strict = rule.strictAbort !== false;
    const responses: Record<string, StepResponse> = {};

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        // 请求模板不做预检：缺变量按空串渲染后照常请求；严格中止只看超时/预期返回值等实际结果
        let result: StepResponse;
        try {
            // 必须等上一步结束（await）才进入下一步
            result = await callStepApi(rule.name, step, i, vars, responses);
        } catch (e) {
            pluginState.logger.warn(
                `自定义 API「${rule.name}」: ${e instanceof Error ? e.message : String(e)}`,
            );
            return strict ? 'aborted' : 'error';
        }

        const key = `res${i + 1}`;
        responses[key] = result;
        // res 始终指向最近一步，兼容旧话术 {{res.x}}
        responses.res = result;

        if (strict && step.expectedConditions?.length) {
            const fail = checkExpectedConditions(
                result.json,
                step.expectedConditions,
                step.expectedLogic === 'or' ? 'or' : 'and',
                i,
                vars,
                responses,
            );
            if (fail) {
                pluginState.logger.warn(
                    `自定义 API 严格中止「${rule.name}」步骤${i + 1}：${fail}`,
                );
                return 'aborted';
            }
        }
    }

    if (strict) {
        const missReply = findMissingPlaceholders(rule.replyTemplate || '', vars, responses);
        if (missReply.length) {
            pluginState.logger.warn(
                `自定义 API 严格中止「${rule.name}」：话术变量不存在 ${missReply.join(', ')}`,
            );
            return 'aborted';
        }
    }

    const reply = renderTemplate(rule.replyTemplate || '{{res}}', vars, responses);
    if (!reply.trim()) {
        if (strict) {
            pluginState.logger.warn(`自定义 API 严格中止「${rule.name}」：话术为空`);
            return 'aborted';
        }
        return 'aborted';
    }

    await dispatchReply(ctx, event, rule, reply);
    return 'sent';
}

/**
 * WebUI 试跑：按规则串行请求外部接口，返回各步结果与话术预览（不调用 send_msg）
 * @param untilStepIndex 含该下标为止；省略则跑完全部步骤并拼话术
 */
export async function testCustomApiRule(
    rule: CustomApiRule,
    options?: {
        untilStepIndex?: number;
        mockMsg?: string;
        mockUserId?: string;
        mockGroupId?: string;
        mockNickname?: string;
    },
): Promise<CustomApiTestResult> {
    const steps = rule.steps || [];
    const end = Math.min(
        steps.length - 1,
        typeof options?.untilStepIndex === 'number' && Number.isFinite(options.untilStepIndex)
            ? Math.max(0, Math.floor(options.untilStepIndex))
            : steps.length - 1,
    );

    const mockMsg = options?.mockMsg?.trim() || rule.trigger || '测试消息';
    const trigger = matchTrigger(mockMsg, rule);
    /** 试跑时附带的触发匹配信息（供 WebUI 展示） */
    const matchInfo: CustomApiTestMatchInfo = {
        mockMsg,
        triggerType: rule.triggerType,
        trigger: rule.trigger,
        matched: trigger.matched,
        match: trigger.match ?? null,
        groups: trigger.groups || [],
        named: trigger.named || {},
    };
    const pack = (
        partial: Omit<CustomApiTestResult, 'match'>,
    ): CustomApiTestResult => ({ ...partial, match: matchInfo });

    const vars: Record<string, string> = {
        msg: mockMsg,
        user_id: options?.mockUserId?.trim() || '10000',
        group_id: options?.mockGroupId?.trim() || '100000',
        nickname: options?.mockNickname?.trim() || '测试用户',
        match: trigger.match || mockMsg,
        ...(trigger.named || {}),
    };
    (trigger.groups || []).forEach((g, i) => {
        vars[`match${i + 1}`] = g;
    });

    const strict = rule.strictAbort !== false;
    const responses: Record<string, StepResponse> = {};
    const outSteps: CustomApiTestStepResult[] = [];
    let aborted = false;
    let abortReason: string | null = null;

    for (let i = 0; i <= end; i++) {
        const step = steps[i];
        // 不预检请求模板变量，直接按渲染结果发起真实请求

        const started = Date.now();
        let result: StepResponse;
        try {
            result = await callStepApi(rule.name, step, i, vars, responses);
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            const finalUrl = e instanceof Error && 'finalUrl' in e
                ? String((e as Error & { finalUrl?: string }).finalUrl || step.url)
                : step.url;
            aborted = true;
            abortReason = errMsg;
            outSteps.push({
                index: i,
                name: step.name,
                method: step.method,
                url: finalUrl,
                status: null,
                httpOk: false,
                durationMs: Date.now() - started,
                text: '',
                json: null,
                expectOk: false,
                expectMessage: null,
                error: errMsg,
            });
            return pack({
                steps: outSteps,
                replyPreview: null,
                replyError: errMsg,
                aborted: true,
                abortReason,
            });
        }

        const key = `res${i + 1}`;
        responses[key] = result;
        responses.res = result;

        let expectMessage: string | null = null;
        let expectOk = true;
        if (step.expectedConditions?.length) {
            expectMessage = checkExpectedConditions(
                result.json,
                step.expectedConditions,
                step.expectedLogic === 'or' ? 'or' : 'and',
                i,
                vars,
                responses,
            );
            expectOk = expectMessage == null;
        }

        outSteps.push({
            index: i,
            name: step.name,
            method: step.method,
            url: result.finalUrl || step.url,
            status: result.status ?? null,
            httpOk: result.status != null ? result.status >= 200 && result.status < 300 : false,
            durationMs: Date.now() - started,
            text: result.text,
            json: result.json,
            expectOk,
            expectMessage,
            error: null,
        });

        if (strict && !expectOk) {
            aborted = true;
            abortReason = expectMessage;
            return pack({
                steps: outSteps,
                replyPreview: null,
                replyError: expectMessage,
                aborted: true,
                abortReason,
            });
        }
    }

    // 仅测到中间某步时，不拼最终话术
    const ranAll = end >= steps.length - 1;
    if (!ranAll) {
        return pack({
            steps: outSteps,
            replyPreview: null,
            replyError: null,
            aborted: false,
            abortReason: null,
        });
    }

    if (strict) {
        const missReply = findMissingPlaceholders(rule.replyTemplate || '', vars, responses);
        if (missReply.length) {
            const reason = `话术变量不存在：${missReply.join(', ')}`;
            return pack({
                steps: outSteps,
                replyPreview: null,
                replyError: reason,
                aborted: true,
                abortReason: reason,
            });
        }
    }

    const reply = renderTemplate(rule.replyTemplate || '{{res}}', vars, responses);
    if (!reply.trim()) {
        const reason = '话术预览为空';
        return pack({
            steps: outSteps,
            replyPreview: null,
            replyError: reason,
            aborted: strict,
            abortReason: strict ? reason : null,
        });
    }

    return pack({
        steps: outSteps,
        replyPreview: reply,
        replyError: null,
        aborted: false,
        abortReason: null,
    });
}

/**
 * 处理自定义 API：按规则顺序匹配并串行请求
 * oncePerMessage 为 true（默认）时，一条消息只处理命中的第一条规则
 */
export async function handleCustomApi(
    ctx: NapCatPluginContext,
    event: OB11Message,
): Promise<boolean> {
    const rawMessage = event.raw_message || '';
    if (!rawMessage) return false;

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
            pluginState.logger.info(`自定义 API 命中规则「${rule.name}」| 步骤数: ${(rule.steps || []).length}`);
            const outcome = await runRuleChain(ctx, event, rule, vars);
            if (outcome === 'sent') {
                pluginState.incrementProcessed();
            }
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
