import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type {
    CustomApiBodyType,
    CustomApiHttpMethod,
    CustomApiRule,
    CustomApiRulesPayload,
    CustomApiTriggerType,
    FriendInfo,
    GroupInfo,
} from '../types'
import { IconTrash, IconX } from '../components/icons'

/** 新建规则时的默认请求头 */
const DEFAULT_HEADERS: Record<string, string> = {
    'Content-Type': 'application/json',
}

function newRule(): CustomApiRule {
    return {
        id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        name: '新规则',
        enabled: true,
        triggerType: 'exact',
        trigger: '',
        method: 'GET',
        url: 'https://example.com/api',
        headers: { ...DEFAULT_HEADERS },
        queryTemplate: '{\n  "q": "{{msg}}"\n}',
        bodyType: 'none',
        bodyTemplate: '{\n  "msg": "{{msg}}",\n  "user_id": "{{user_id}}"\n}',
        replyTemplate: '{{res.message}}',
        replyToCurrent: false,
        targetGroupIds: [],
        targetUserIds: [],
    }
}

const triggerLabel: Record<CustomApiTriggerType, string> = {
    exact: '精确',
    fuzzy: '模糊',
    regex: '正则',
}

/**
 * 请求参数形态（下拉「请求体类型」）
 * - query：拼 URL 查询串，bodyType=none
 * - 其余：对应 bodyType，GET/HEAD 不可选
 */
type PayloadKind = 'query' | Exclude<CustomApiBodyType, 'none'>

/** 按请求方法给出默认参数形态：GET→query，POST 等→json */
function defaultPayloadKind(method: CustomApiHttpMethod): PayloadKind {
    return method === 'GET' || method === 'HEAD' ? 'query' : 'json'
}

/** 从规则推导当前下拉值 */
function payloadKindFromRule(rule: CustomApiRule): PayloadKind {
    if (rule.bodyType === 'none' || rule.method === 'GET' || rule.method === 'HEAD') {
        return 'query'
    }
    return rule.bodyType
}

/** 尝试格式化 JSON 文本，失败则原样返回并提示 */
function tryFormatJson(text: string): { ok: boolean; text: string } {
    try {
        const obj = JSON.parse(text || '{}')
        return { ok: true, text: JSON.stringify(obj, null, 2) }
    } catch {
        return { ok: false, text }
    }
}

/**
 * 自定义 API 规则管理
 * 配置触发词、外部接口与话术模板；群侧需在群管理开启「自定义 API」
 */
export default function CustomApiPage() {
    const [rules, setRules] = useState<CustomApiRule[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const [groups, setGroups] = useState<GroupInfo[]>([])
    const [friends, setFriends] = useState<FriendInfo[]>([])
    const [headersText, setHeadersText] = useState('{}')
    const [queryText, setQueryText] = useState('{}')
    const [bodyText, setBodyText] = useState('{}')
    /** 一条消息命中多条规则时只调用一次（默认开） */
    const [oncePerMessage, setOncePerMessage] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [rulesRes, groupsRes, friendsRes] = await Promise.all([
                noAuthFetch<CustomApiRulesPayload>('/custom-api/rules'),
                noAuthFetch<GroupInfo[]>('/groups'),
                noAuthFetch<FriendInfo[]>('/friends'),
            ])
            if (rulesRes.code === 0 && rulesRes.data) {
                setRules(rulesRes.data.rules || [])
                setOncePerMessage(rulesRes.data.oncePerMessage !== false)
            }
            if (groupsRes.code === 0 && groupsRes.data) setGroups(groupsRes.data)
            if (friendsRes.code === 0 && friendsRes.data) setFriends(friendsRes.data)
        } catch {
            showToast('加载失败', 'error')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const editing = rules.find((r) => r.id === editingId) || null

    useEffect(() => {
        if (!editing) return
        setHeadersText(JSON.stringify(editing.headers || {}, null, 2))
        setQueryText(editing.queryTemplate || '{}')
        setBodyText(editing.bodyTemplate || '{}')
        setConfirmDeleteId(null)
    }, [editingId]) // eslint-disable-line react-hooks/exhaustive-deps

    const updateRule = (id: string, patch: Partial<CustomApiRule>) => {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    }

    /** 把编辑区 JSON 文本写回当前规则 */
    const syncEditorJson = (): CustomApiRule[] | null => {
        if (!editingId) return rules
        try {
            const headers = JSON.parse(headersText || '{}') as Record<string, string>
            if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
                showToast('请求头必须是 JSON 对象', 'error')
                return null
            }
            return rules.map((r) => (
                r.id === editingId
                    ? {
                        ...r,
                        headers,
                        queryTemplate: queryText,
                        bodyTemplate: bodyText,
                    }
                    : r
            ))
        } catch {
            showToast('请求头 JSON 格式错误', 'error')
            return null
        }
    }

    const saveAll = async () => {
        setSaving(true)
        try {
            const next = syncEditorJson()
            if (!next) {
                setSaving(false)
                return
            }
            // 前端先校验：触发内容、URL 不能为空（后端也会再校验，避免静默清空列表）
            for (let i = 0; i < next.length; i++) {
                const r = next[i]
                if (!r.trigger?.trim()) {
                    showToast(`第 ${i + 1} 条「${r.name || '未命名'}」触发内容不能为空`, 'error')
                    setSaving(false)
                    return
                }
                if (!r.url?.trim()) {
                    showToast(`第 ${i + 1} 条「${r.name || '未命名'}」接口 URL 不能为空`, 'error')
                    setSaving(false)
                    return
                }
            }
            setRules(next)
            const res = await noAuthFetch<CustomApiRulesPayload>('/custom-api/rules', {
                method: 'POST',
                body: JSON.stringify({ rules: next, oncePerMessage }),
            })
            if (res.code !== 0) {
                showToast(res.message || '保存失败', 'error')
                return
            }
            if (res.data) {
                setRules(res.data.rules || [])
                setOncePerMessage(res.data.oncePerMessage !== false)
                // 若当前编辑项仍在，保持选中
                if (editingId && !(res.data.rules || []).some((r) => r.id === editingId)) {
                    setEditingId(res.data.rules?.[0]?.id ?? null)
                }
            }
            showToast('规则已保存', 'success')
            setConfirmDeleteId(null)
        } catch (e) {
            let msg = '保存失败'
            if (e instanceof Error && e.message) {
                try {
                    const parsed = JSON.parse(e.message) as { message?: string }
                    if (parsed.message) msg = parsed.message
                } catch {
                    if (e.message.length < 200) msg = e.message
                }
            }
            showToast(msg, 'error')
        } finally {
            setSaving(false)
        }
    }

    const addRule = () => {
        const r = newRule()
        setRules((prev) => [...prev, r])
        setEditingId(r.id)
    }

    const removeRule = (id: string) => {
        setRules((prev) => prev.filter((r) => r.id !== id))
        if (editingId === id) setEditingId(null)
        setConfirmDeleteId(null)
    }

    const toggleTarget = (kind: 'group' | 'user', id: string) => {
        if (!editing) return
        if (kind === 'group') {
            const set = new Set(editing.targetGroupIds)
            if (set.has(id)) set.delete(id)
            else set.add(id)
            updateRule(editing.id, { targetGroupIds: Array.from(set) })
        } else {
            const set = new Set(editing.targetUserIds)
            if (set.has(id)) set.delete(id)
            else set.add(id)
            updateRule(editing.id, { targetUserIds: Array.from(set) })
        }
    }

    const formatField = (kind: 'headers' | 'query' | 'body') => {
        const src = kind === 'headers' ? headersText : kind === 'query' ? queryText : bodyText
        const result = tryFormatJson(src)
        if (!result.ok) {
            showToast('无法格式化：不是合法 JSON', 'warning')
            return
        }
        if (kind === 'headers') setHeadersText(result.text)
        else if (kind === 'query') setQueryText(result.text)
        else setBodyText(result.text)
        showToast('已格式化', 'success')
    }

    const payloadKind = editing ? payloadKindFromRule(editing) : 'query'
    const bodyAllowed = editing
        ? editing.method !== 'GET' && editing.method !== 'HEAD'
        : false

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">加载规则中...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* 变量说明：默认收起，主色条更醒目 */}
            <details className="group rounded-xl border-2 border-primary/35 dark:border-primary/40 bg-primary/[0.06] dark:bg-primary/10 overflow-hidden shadow-sm">
                <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 list-none [&::-webkit-details-marker]:hidden hover:bg-primary/[0.08] transition-colors">
                    <div className="min-w-0 flex items-start gap-3">
                        <span className="shrink-0 mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white text-sm font-bold shadow-sm">
                            {'{}'}
                        </span>
                        <div className="min-w-0">
                            <div className="text-base font-semibold text-gray-900 dark:text-white">
                                变量说明
                                <span className="ml-2 text-xs font-normal text-primary">推荐先看</span>
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 truncate">
                                占位符可用于 URL / Query / Body / 话术（如 {'{{msg}}'}、{'{{id}}'}、{'{{res.字段}}'}）
                            </div>
                        </div>
                    </div>
                    <span
                        className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold
                            bg-primary text-white shadow-md shadow-primary/25
                            hover:brightness-105 active:scale-[0.98] transition
                            group-open:bg-white group-open:text-primary group-open:border-2 group-open:border-primary"
                    >
                        <span className="group-open:hidden">展开查看</span>
                        <span className="hidden group-open:inline">收起</span>
                        <span className="text-xs leading-none group-open:rotate-180 transition-transform">▾</span>
                    </span>
                </summary>
                <div className="px-4 pb-3.5 pt-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed border-t border-gray-100 dark:border-gray-800/80 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <VarGroup title="消息相关">
                        <VarItem name="{{msg}}" desc="触发时的整条原始消息" />
                        <VarItem name="{{user_id}}" desc="发送者 QQ 号" />
                        <VarItem name="{{group_id}}" desc="群号（私聊为空）" />
                        <VarItem name="{{nickname}}" desc="发送者昵称" />
                    </VarGroup>
                    <VarGroup title="接口返回">
                        <VarItem name="{{res}}" desc="返回的整个对象（JSON 字符串）" />
                        <VarItem name="{{res.字段}}" desc="取字段，支持嵌套路径" />
                        <VarItem name="{{res.data.x}}" desc="嵌套示例" />
                    </VarGroup>
                    <VarGroup title="正则触发">
                        <VarItem name="{{match}}" desc="匹配到的整段文本" />
                        <VarItem name="{{match1}}" desc="第 1 个捕获组，以此类推" />
                        <VarItem name="(?<city>…) → {{city}}" desc="命名分组" />
                    </VarGroup>
                </div>
            </details>

            <div className="flex flex-wrap items-center gap-3">
                <button className="btn btn-primary text-xs" onClick={addRule}>新增规则</button>
                <button className="btn btn-ghost text-xs" onClick={saveAll} disabled={saving}>
                    {saving ? '保存中...' : '保存全部'}
                </button>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={oncePerMessage}
                        onChange={(e) => setOncePerMessage(e.target.checked)}
                    />
                    一条消息只调用一次
                </label>
                <span className="text-xs text-gray-400">共 {rules.length} 条</span>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 min-h-[480px]">
                {/* 左侧列表：启用开关 + 删除确认 */}
                <div className="w-full lg:w-[300px] shrink-0 card !shadow-none hover:!transform-none hover:!shadow-none overflow-hidden flex flex-col max-h-[60vh]">
                    <div className="px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-white/[0.02] shrink-0">
                        规则列表
                    </div>
                    <div className="overflow-y-auto flex-1 divide-y divide-gray-100/80 dark:divide-gray-800/60">
                        {rules.map((r) => (
                            <div
                                key={r.id}
                                className={`px-3 py-2.5 cursor-pointer transition-colors border-l-2 ${
                                    editingId === r.id
                                        ? 'bg-primary/[0.08] border-primary'
                                        : 'border-transparent hover:bg-gray-50/90 dark:hover:bg-white/[0.03]'
                                } ${r.enabled ? '' : 'opacity-55'}`}
                                onClick={() => setEditingId(r.id)}
                            >
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">{r.name}</div>
                                        <div className="text-[11px] text-gray-400 mt-0.5 truncate flex items-center gap-1.5">
                                            <span className="inline-flex px-1 py-px rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400 shrink-0">
                                                {triggerLabel[r.triggerType]}
                                            </span>
                                            <span className="truncate">{r.trigger || '(未填触发)'}</span>
                                        </div>
                                    </div>
                                    <label
                                        className="toggle !scale-90 shrink-0"
                                        title={r.enabled ? '已启用' : '已停用'}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={r.enabled}
                                            onChange={(e) => updateRule(r.id, { enabled: e.target.checked })}
                                        />
                                        <div className="slider" />
                                    </label>
                                    {confirmDeleteId === r.id ? (
                                        <div
                                            className="flex items-center gap-1 shrink-0"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button
                                                className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500 text-white hover:bg-red-600"
                                                onClick={() => removeRule(r.id)}
                                            >
                                                确认
                                            </button>
                                            <button
                                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
                                                onClick={() => setConfirmDeleteId(null)}
                                                title="取消"
                                            >
                                                <IconX size={12} />
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            className="p-1 text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 shrink-0 rounded"
                                            title="删除"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setConfirmDeleteId(r.id)
                                            }}
                                        >
                                            <IconTrash size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {rules.length === 0 && (
                            <div className="py-12 text-center text-sm text-gray-400">暂无规则，点击「新增规则」</div>
                        )}
                    </div>
                </div>

                {/* 右侧编辑 */}
                <div className="flex-1 min-w-0">
                    {!editing ? (
                        <div className="card !shadow-none hover:!transform-none hover:!shadow-none p-12 text-center text-sm text-gray-400">
                            从左侧选择或新增规则
                        </div>
                    ) : (
                        <div className="card !shadow-none hover:!transform-none hover:!shadow-none bg-gray-50/90 dark:bg-[#18191C] p-4 space-y-3">
                            <div className="flex items-center justify-between gap-2 px-1">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">编辑规则</h3>
                                <span className="text-xs text-gray-400 font-mono truncate max-w-[40%]">{editing.id}</span>
                            </div>

                            {/* 触发 */}
                            <SectionBlock title="触发条件">
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                    <Field label="规则名称" className="sm:col-span-3">
                                        <input
                                            className="input-field"
                                            value={editing.name}
                                            onChange={(e) => updateRule(editing.id, { name: e.target.value })}
                                        />
                                    </Field>
                                    <Field label="触发方式" className="sm:col-span-2">
                                        <select
                                            className="input-field"
                                            value={editing.triggerType}
                                            onChange={(e) => updateRule(editing.id, { triggerType: e.target.value as CustomApiTriggerType })}
                                        >
                                            <option value="exact">精确词</option>
                                            <option value="fuzzy">模糊词</option>
                                            <option value="regex">正则</option>
                                        </select>
                                    </Field>
                                    <Field label="触发内容（必填）" className="sm:col-span-7">
                                        <input
                                            className="input-field font-mono text-sm"
                                            value={editing.trigger}
                                            onChange={(e) => updateRule(editing.id, { trigger: e.target.value })}
                                            placeholder={editing.triggerType === 'regex' ? '例如：天气\\s*(?<city>.+)' : '关键词'}
                                            required
                                        />
                                    </Field>
                                </div>
                                {editing.triggerType === 'regex' && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                        捕获示例：
                                        <CodeChip>{'天气\\s*(?<city>.+)'}</CodeChip>
                                        命中后可用
                                        <CodeChip>{'{{city}}'}</CodeChip>
                                        /
                                        <CodeChip>{'{{match1}}'}</CodeChip>
                                    </p>
                                )}
                            </SectionBlock>

                            {/* 请求 */}
                            <SectionBlock title="请求配置">
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                    <Field label="方法" className="sm:col-span-2">
                                        <select
                                            className="input-field"
                                            value={editing.method}
                                            onChange={(e) => {
                                                const method = e.target.value as CustomApiHttpMethod
                                                const kind = defaultPayloadKind(method)
                                                updateRule(editing.id, {
                                                    method,
                                                    bodyType: kind === 'query' ? 'none' : kind,
                                                })
                                            }}
                                        >
                                            <option value="GET">GET</option>
                                            <option value="POST">POST</option>
                                            <option value="PUT">PUT</option>
                                            <option value="PATCH">PATCH</option>
                                            <option value="DELETE">DELETE</option>
                                            <option value="HEAD">HEAD</option>
                                        </select>
                                    </Field>
                                    <Field label="请求体类型" className="sm:col-span-2">
                                        <select
                                            className="input-field"
                                            value={payloadKind}
                                            onChange={(e) => {
                                                const kind = e.target.value as PayloadKind
                                                if (kind !== 'query' && !bodyAllowed) {
                                                    showToast('GET/HEAD 仅支持 Query', 'warning')
                                                    return
                                                }
                                                updateRule(editing.id, {
                                                    bodyType: kind === 'query' ? 'none' : kind,
                                                })
                                            }}
                                        >
                                            <option value="query">Query</option>
                                            <option value="json" disabled={!bodyAllowed}>JSON Body</option>
                                            <option value="form" disabled={!bodyAllowed}>form-urlencoded</option>
                                            <option value="multipart" disabled={!bodyAllowed}>multipart</option>
                                            <option value="raw" disabled={!bodyAllowed}>原始文本</option>
                                        </select>
                                    </Field>
                                    <Field label="接口 URL" className="sm:col-span-8">
                                        <input
                                            className="input-field font-mono text-sm"
                                            value={editing.url}
                                            onChange={(e) => updateRule(editing.id, { url: e.target.value })}
                                        />
                                    </Field>
                                </div>

                                <div className="mt-3 space-y-3">
                                    {payloadKind === 'query' ? (
                                        <JsonField
                                            label="Query 参数 (JSON 对象，可含占位符)"
                                            value={queryText}
                                            onChange={setQueryText}
                                            onFormat={() => formatField('query')}
                                            hint='例如 {"q":"{{msg}}"}，会拼到 URL 查询串'
                                        />
                                    ) : (
                                        <JsonField
                                            label={
                                                payloadKind === 'form' || payloadKind === 'multipart'
                                                    ? '表单字段 (JSON 对象)'
                                                    : '请求体模板'
                                            }
                                            value={bodyText}
                                            onChange={setBodyText}
                                            onFormat={payloadKind === 'raw' ? undefined : () => formatField('body')}
                                            hint={
                                                payloadKind === 'form' || payloadKind === 'multipart'
                                                    ? '键值对象，值可写 {{msg}} 等占位符'
                                                    : payloadKind === 'raw'
                                                        ? '原始文本，按模板渲染后作为 body'
                                                        : '整段 JSON 文本，可含占位符；可点格式化'
                                            }
                                            mono
                                        />
                                    )}

                                    <JsonField
                                        label="请求头 (JSON)"
                                        value={headersText}
                                        onChange={setHeadersText}
                                        onFormat={() => formatField('headers')}
                                    />
                                </div>
                            </SectionBlock>

                            {/* 回复与发送 */}
                            <SectionBlock title="回复与发送">
                                <Field label="话术模板">
                                    <textarea
                                        className="input-field font-mono text-sm min-h-[80px] leading-relaxed"
                                        value={editing.replyTemplate}
                                        onChange={(e) => updateRule(editing.id, { replyTemplate: e.target.value })}
                                        placeholder="例如：{{city}} 天气：{{res.weather}}"
                                    />
                                </Field>

                                <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white/[0.04] px-3 py-2.5 mt-3">
                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-100">回复当前会话（群/好友）</div>
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            checked={editing.replyToCurrent}
                                            onChange={(e) => updateRule(editing.id, { replyToCurrent: e.target.checked })}
                                        />
                                        <div className="slider" />
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                                    <Field label="发送到群（多选）">
                                        <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-black/20 p-1.5 space-y-0.5">
                                            {groups.map((g) => (
                                                <label
                                                    key={g.group_id}
                                                    className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md cursor-pointer hover:bg-white dark:hover:bg-white/[0.06]"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={editing.targetGroupIds.includes(String(g.group_id))}
                                                        onChange={() => toggleTarget('group', String(g.group_id))}
                                                    />
                                                    <span className="truncate">{g.group_name} ({g.group_id})</span>
                                                </label>
                                            ))}
                                            {groups.length === 0 && <div className="text-sm text-gray-400 px-2 py-3">暂无群</div>}
                                        </div>
                                    </Field>
                                    <Field label="发送到好友（多选）">
                                        <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-black/20 p-1.5 space-y-0.5">
                                            {friends.map((f) => (
                                                <label
                                                    key={f.user_id}
                                                    className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md cursor-pointer hover:bg-white dark:hover:bg-white/[0.06]"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={editing.targetUserIds.includes(String(f.user_id))}
                                                        onChange={() => toggleTarget('user', String(f.user_id))}
                                                    />
                                                    <span className="truncate">{f.remark || f.nickname} ({f.user_id})</span>
                                                </label>
                                            ))}
                                            {friends.length === 0 && <div className="text-sm text-gray-400 px-2 py-3">暂无好友</div>}
                                        </div>
                                    </Field>
                                </div>
                            </SectionBlock>

                            <div className="pt-1 px-1">
                                <button className="btn btn-primary text-sm" onClick={saveAll} disabled={saving}>
                                    保存全部规则
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

/** 编辑区分区块：白底描边，和灰色外层区分开 */
function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e20] p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3 pb-2 border-b border-gray-100 dark:border-gray-800">
                {title}
            </div>
            {children}
        </section>
    )
}

function CodeChip({ children }: { children: React.ReactNode }) {
    return (
        <code className="mx-0.5 px-1 py-px rounded bg-gray-100 dark:bg-white/10 text-xs font-mono text-primary/90 dark:text-primary">
            {children}
        </code>
    )
}

function VarGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{title}</div>
            <ul className="space-y-1 list-none pl-0">{children}</ul>
        </div>
    )
}

function VarItem({ name, desc }: { name: string; desc: string }) {
    return (
        <li className="flex items-start gap-1.5">
            <CodeChip>{name}</CodeChip>
            <span className="text-gray-500 dark:text-gray-400 leading-snug">{desc}</span>
        </li>
    )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">{label}</div>
            {children}
        </div>
    )
}

function JsonField({
    label,
    value,
    onChange,
    onFormat,
    hint,
    mono = true,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    onFormat?: () => void
    hint?: string
    mono?: boolean
}) {
    return (
        <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</div>
                {onFormat && (
                    <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs text-gray-500" onClick={onFormat}>
                        格式化
                    </button>
                )}
            </div>
            <textarea
                className={`input-field text-sm min-h-[96px] leading-relaxed ${mono ? 'font-mono' : ''}`}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
            {hint && <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{hint}</p>}
        </div>
    )
}
