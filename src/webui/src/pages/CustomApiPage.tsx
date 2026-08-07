import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type {
    CustomApiBodyType,
    CustomApiHttpMethod,
    CustomApiRule,
    CustomApiTriggerType,
    FriendInfo,
    GroupInfo,
} from '../types'
import { IconTrash, IconX } from '../components/icons'

/** 新建规则时的默认请求头（常见 JSON API 客户端） */
const DEFAULT_HEADERS: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': 'napcat-plugin-yunfeng',
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
        replyTemplate: '{{data.message}}',
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

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [rulesRes, groupsRes, friendsRes] = await Promise.all([
                noAuthFetch<CustomApiRule[]>('/custom-api/rules'),
                noAuthFetch<GroupInfo[]>('/groups'),
                noAuthFetch<FriendInfo[]>('/friends'),
            ])
            if (rulesRes.code === 0 && rulesRes.data) setRules(rulesRes.data)
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
            setRules(next)
            const res = await noAuthFetch<CustomApiRule[]>('/custom-api/rules', {
                method: 'POST',
                body: JSON.stringify({ rules: next }),
            })
            if (res.code !== 0) {
                showToast(res.message || '保存失败', 'error')
                return
            }
            if (res.data) setRules(res.data)
            showToast('规则已保存', 'success')
            setConfirmDeleteId(null)
        } catch {
            showToast('保存失败', 'error')
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

    const showBodyEditor = editing
        && editing.bodyType !== 'none'
        && editing.method !== 'GET'
        && editing.method !== 'HEAD'

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
            <div className="rounded-lg border border-sky-200/60 dark:border-sky-500/20 bg-sky-50/80 dark:bg-sky-500/5 px-4 py-3 text-xs text-sky-900 dark:text-sky-100/90 leading-relaxed space-y-1.5">
                <p>消息命中后请求外部接口，按模板拼话术发送。群聊需在「群管理」开启本功能。</p>
                <p>
                    常用变量：
                    <code className="mx-1">{'{{msg}}'}</code>
                    <code className="mx-1">{'{{user_id}}'}</code>
                    <code className="mx-1">{'{{group_id}}'}</code>
                    <code className="mx-1">{'{{body}}'}</code>
                    <code className="mx-1">{'{{data.字段}}'}</code>
                </p>
                <p>
                    正则变量：整段
                    <code className="mx-1">{'{{match}}'}</code>
                    ；第 n 个括号
                    <code className="mx-1">{'{{match1}}'}</code>
                    <code className="mx-1">{'{{match2}}'}</code>…
                    ；命名分组
                    <code className="mx-1">{'(?<city>.+)'}</code>
                    →
                    <code className="mx-1">{'{{city}}'}</code>
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-primary text-xs" onClick={addRule}>新增规则</button>
                <button className="btn btn-ghost text-xs" onClick={saveAll} disabled={saving}>
                    {saving ? '保存中...' : '保存全部'}
                </button>
                <span className="text-xs text-gray-400">共 {rules.length} 条</span>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 min-h-[480px]">
                {/* 左侧列表：启用开关 + 删除确认 */}
                <div className="w-full lg:w-[300px] shrink-0 card divide-y divide-gray-50 dark:divide-gray-800/50 overflow-y-auto max-h-[60vh]">
                    {rules.map((r) => (
                        <div
                            key={r.id}
                            className={`px-3 py-2.5 cursor-pointer ${
                                editingId === r.id
                                    ? 'bg-primary/10 border-l-2 border-primary'
                                    : 'hover:bg-gray-50/80 dark:hover:bg-white/[0.03] border-l-2 border-transparent'
                            }`}
                            onClick={() => setEditingId(r.id)}
                        >
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium truncate">{r.name}</div>
                                    <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                                        {triggerLabel[r.triggerType]} · {r.trigger || '(未填触发)'}
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
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white"
                                            onClick={() => removeRule(r.id)}
                                        >
                                            确认
                                        </button>
                                        <button
                                            className="p-1 text-gray-400 hover:text-gray-600"
                                            onClick={() => setConfirmDeleteId(null)}
                                            title="取消"
                                        >
                                            <IconX size={12} />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        className="p-1 text-gray-400 hover:text-red-500 shrink-0"
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
                        <div className="py-10 text-center text-sm text-gray-400">暂无规则，点击「新增规则」</div>
                    )}
                </div>

                {/* 右侧编辑 */}
                <div className="flex-1 min-w-0">
                    {!editing ? (
                        <div className="card p-10 text-center text-sm text-gray-400">从左侧选择或新增规则</div>
                    ) : (
                        <div className="card p-5 space-y-4">
                            <h3 className="text-sm font-semibold">编辑规则</h3>

                            {/* 名称 + 触发方式同行 */}
                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                <Field label="名称" className="sm:col-span-3">
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
                            </div>

                            <Field label="触发内容">
                                <input
                                    className="input-field font-mono text-xs"
                                    value={editing.trigger}
                                    onChange={(e) => updateRule(editing.id, { trigger: e.target.value })}
                                    placeholder={editing.triggerType === 'regex' ? '例如：天气\\s*(?<city>.+)' : '关键词'}
                                />
                                {editing.triggerType === 'regex' && (
                                    <p className="text-[11px] text-gray-400 mt-1">
                                        捕获示例：
                                        <code className="mx-0.5">{'天气\\s*(?<city>.+)'}</code>
                                        命中后可用
                                        <code className="mx-0.5">{'{{city}}'}</code>
                                        /
                                        <code className="mx-0.5">{'{{match1}}'}</code>
                                    </p>
                                )}
                            </Field>

                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                                <Field label="方法" className="sm:col-span-1">
                                    <select
                                        className="input-field"
                                        value={editing.method}
                                        onChange={(e) => {
                                            const method = e.target.value as CustomApiHttpMethod
                                            const patch: Partial<CustomApiRule> = { method }
                                            if (method === 'GET' || method === 'HEAD') {
                                                patch.bodyType = 'none'
                                            } else if (editing.bodyType === 'none') {
                                                patch.bodyType = 'json'
                                            }
                                            updateRule(editing.id, patch)
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
                                <Field label="接口 URL" className="sm:col-span-4">
                                    <input
                                        className="input-field font-mono text-xs"
                                        value={editing.url}
                                        onChange={(e) => updateRule(editing.id, { url: e.target.value })}
                                    />
                                </Field>
                            </div>

                            <JsonField
                                label="请求头 (JSON)"
                                value={headersText}
                                onChange={setHeadersText}
                                onFormat={() => formatField('headers')}
                            />

                            <JsonField
                                label="Query 参数 (JSON 对象，可含占位符)"
                                value={queryText}
                                onChange={setQueryText}
                                onFormat={() => formatField('query')}
                                hint='例如 {"q":"{{msg}}"}，会拼到 URL 查询串'
                            />

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Field label="请求体类型">
                                    <select
                                        className="input-field"
                                        value={editing.bodyType}
                                        disabled={editing.method === 'GET' || editing.method === 'HEAD'}
                                        onChange={(e) => updateRule(editing.id, { bodyType: e.target.value as CustomApiBodyType })}
                                    >
                                        <option value="none">无</option>
                                        <option value="json">JSON</option>
                                        <option value="form">form-urlencoded</option>
                                        <option value="multipart">multipart/form-data</option>
                                        <option value="raw">原始文本</option>
                                    </select>
                                </Field>
                            </div>

                            {showBodyEditor && (
                                <JsonField
                                    label={
                                        editing.bodyType === 'json' || editing.bodyType === 'raw'
                                            ? '请求体模板'
                                            : '表单字段 (JSON 对象)'
                                    }
                                    value={bodyText}
                                    onChange={setBodyText}
                                    onFormat={editing.bodyType === 'raw' ? undefined : () => formatField('body')}
                                    hint={
                                        editing.bodyType === 'form' || editing.bodyType === 'multipart'
                                            ? '键值对象，值可写 {{msg}} 等占位符'
                                            : editing.bodyType === 'json'
                                                ? '整段 JSON 文本，可含占位符；可点格式化'
                                                : '原始文本，按模板渲染后作为 body'
                                    }
                                    mono
                                />
                            )}

                            <Field label="话术模板">
                                <textarea
                                    className="input-field font-mono text-xs min-h-[72px]"
                                    value={editing.replyTemplate}
                                    onChange={(e) => updateRule(editing.id, { replyTemplate: e.target.value })}
                                    placeholder="例如：{{city}} 天气：{{data.weather}}"
                                />
                            </Field>

                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm">回复当前会话</div>
                                    <div className="text-xs text-gray-400">
                                        默认关闭；开启后若下方又勾选了同一群/好友，不会重复发送
                                    </div>
                                </div>
                                <label className="toggle">
                                    <input
                                        type="checkbox"
                                        checked={editing.replyToCurrent}
                                        onChange={(e) => updateRule(editing.id, { replyToCurrent: e.target.checked })}
                                    />
                                    <div className="slider" />
                                </label>
                            </div>

                            {/* 群 / 好友左右并列 */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <Field label="发送到群（多选）">
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 p-2 space-y-1">
                                        {groups.map((g) => (
                                            <label key={g.group_id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={editing.targetGroupIds.includes(String(g.group_id))}
                                                    onChange={() => toggleTarget('group', String(g.group_id))}
                                                />
                                                <span className="truncate">{g.group_name} ({g.group_id})</span>
                                            </label>
                                        ))}
                                        {groups.length === 0 && <div className="text-xs text-gray-400">暂无群</div>}
                                    </div>
                                </Field>
                                <Field label="发送到好友（多选）">
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 p-2 space-y-1">
                                        {friends.map((f) => (
                                            <label key={f.user_id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={editing.targetUserIds.includes(String(f.user_id))}
                                                    onChange={() => toggleTarget('user', String(f.user_id))}
                                                />
                                                <span className="truncate">{f.remark || f.nickname} ({f.user_id})</span>
                                            </label>
                                        ))}
                                        {friends.length === 0 && <div className="text-xs text-gray-400">暂无好友</div>}
                                    </div>
                                </Field>
                            </div>

                            <button className="btn btn-primary text-xs" onClick={saveAll} disabled={saving}>
                                保存全部规则
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1.5">{label}</div>
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
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</div>
                {onFormat && (
                    <button type="button" className="btn btn-ghost !px-2 !py-1 text-[11px]" onClick={onFormat}>
                        格式化 JSON
                    </button>
                )}
            </div>
            <textarea
                className={`input-field text-xs min-h-[88px] ${mono ? 'font-mono' : ''}`}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
            {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
        </div>
    )
}
