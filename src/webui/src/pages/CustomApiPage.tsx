import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type {
    CustomApiBodyType,
    CustomApiHttpMethod,
    CustomApiRule,
    CustomApiRulesPayload,
    CustomApiStep,
    CustomApiTestResult,
    CustomApiTriggerType,
    FriendInfo,
    GroupInfo,
} from '../types'
import { IconTrash, IconX } from '../components/icons'

/** 新建规则时的默认请求头 */
const DEFAULT_HEADERS: Record<string, string> = {
    'Content-Type': 'application/json',
}

const DEFAULT_STEP_TIMEOUT_MS = 8000

/** 新建一步请求（返回为 resN） */
function newStep(index: number): CustomApiStep {
    return {
        id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
        name: `接口 ${index + 1}`,
        method: 'GET',
        url: 'https://example.com/api',
        headers: { ...DEFAULT_HEADERS },
        queryTemplate: index === 0
            ? '{\n  "q": "{{msg}}"\n}'
            : '{\n  "token": "{{res1.token}}"\n}',
        bodyType: 'none',
        bodyTemplate: '{\n  "msg": "{{msg}}"\n}',
        timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
        expectedConditions: [],
        expectedLogic: 'and',
    }
}

function newRule(): CustomApiRule {
    return {
        id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        name: '新规则',
        enabled: true,
        triggerType: 'exact',
        trigger: '',
        steps: [newStep(0)],
        strictAbort: true,
        replyTemplate: '{{res1.message}}',
        replyToCurrent: false,
        targetGroupIds: [],
        targetUserIds: [],
    }
}

/** 兼容旧数据：无 steps 时从扁平字段拼一步 */
function ensureSteps(rule: CustomApiRule): CustomApiRule {
    if (Array.isArray(rule.steps) && rule.steps.length > 0) {
        return {
            ...rule,
            strictAbort: rule.strictAbort !== false,
            steps: rule.steps.map((s, i) => ({
                ...s,
                timeoutMs: s.timeoutMs > 0 ? s.timeoutMs : DEFAULT_STEP_TIMEOUT_MS,
                expectedConditions: Array.isArray(s.expectedConditions) ? s.expectedConditions.slice(0, 2) : [],
                expectedLogic: s.expectedLogic === 'or' ? 'or' : 'and',
                headers: s.headers || { ...DEFAULT_HEADERS },
                name: s.name || `接口 ${i + 1}`,
            })),
        }
    }
    const legacy = rule as CustomApiRule & {
        method?: CustomApiHttpMethod
        url?: string
        headers?: Record<string, string>
        queryTemplate?: string
        bodyType?: CustomApiBodyType
        bodyTemplate?: string
    }
    return {
        ...rule,
        strictAbort: rule.strictAbort !== false,
        steps: [{
            id: 'step1',
            name: '接口 1',
            method: legacy.method || 'GET',
            url: legacy.url || 'https://example.com/api',
            headers: legacy.headers || { ...DEFAULT_HEADERS },
            queryTemplate: legacy.queryTemplate || '',
            bodyType: legacy.bodyType || 'none',
            bodyTemplate: legacy.bodyTemplate || '',
            timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
            expectedConditions: [],
            expectedLogic: 'and',
        }],
    }
}

const triggerLabel: Record<CustomApiTriggerType, string> = {
    exact: '精确',
    fuzzy: '模糊',
    regex: '正则',
}

type PayloadKind = 'query' | Exclude<CustomApiBodyType, 'none'>

function defaultPayloadKind(method: CustomApiHttpMethod): PayloadKind {
    return method === 'GET' || method === 'HEAD' ? 'query' : 'json'
}

function payloadKindFromStep(step: CustomApiStep): PayloadKind {
    if (step.bodyType === 'none' || step.method === 'GET' || step.method === 'HEAD') {
        return 'query'
    }
    return step.bodyType
}

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
 * 支持多接口串行：res1 → res2…；群侧需开启「自定义 API」
 */
export default function CustomApiPage() {
    const [rules, setRules] = useState<CustomApiRule[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [stepIndex, setStepIndex] = useState(0)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const [groups, setGroups] = useState<GroupInfo[]>([])
    const [friends, setFriends] = useState<FriendInfo[]>([])
    const [headersText, setHeadersText] = useState('{}')
    const [queryText, setQueryText] = useState('{}')
    const [bodyText, setBodyText] = useState('{}')
    /** 预期条件编辑（最多 2 条） */
    const [expectPath1, setExpectPath1] = useState('')
    const [expectValue1, setExpectValue1] = useState('')
    const [expectPath2, setExpectPath2] = useState('')
    const [expectValue2, setExpectValue2] = useState('')
    const [expectLogic, setExpectLogic] = useState<'and' | 'or'>('and')
    /** 超时毫秒草稿：输入过程不钳制，失焦再校验 */
    const [timeoutDraft, setTimeoutDraft] = useState(String(DEFAULT_STEP_TIMEOUT_MS))
    const [oncePerMessage, setOncePerMessage] = useState(true)
    /** 试跑用的模拟消息（填充 {{msg}} / 正则捕获） */
    const [mockMsg, setMockMsg] = useState('')
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<CustomApiTestResult | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [rulesRes, groupsRes, friendsRes] = await Promise.all([
                noAuthFetch<CustomApiRulesPayload>('/custom-api/rules'),
                noAuthFetch<GroupInfo[]>('/groups'),
                noAuthFetch<FriendInfo[]>('/friends'),
            ])
            if (rulesRes.code === 0 && rulesRes.data) {
                setRules((rulesRes.data.rules || []).map(ensureSteps))
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
    const editingStep = editing?.steps?.[stepIndex] || null

    /** 把当前步骤的编辑区同步进 state */
    const flushStepEditor = useCallback((
        list: CustomApiRule[],
        ruleId: string | null,
        idx: number,
    ): CustomApiRule[] | null => {
        if (!ruleId) return list
        try {
            const headers = JSON.parse(headersText || '{}') as Record<string, string>
            if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
                showToast('请求头必须是 JSON 对象', 'error')
                return null
            }
            const stepResKey = `res${idx + 1}`
            const normalizeExpectPath = (p: string) => {
                let path = p.trim()
                if (!path || path === 'res' || /^res\d+$/.test(path)) return ''
                // 去掉旧版 res. / 任意 resN.，再挂到本步 resN
                path = path.replace(/^res\d*\./, '')
                if (!path) return ''
                return `${stepResKey}.${path}`
            }
            // value 可空：仅校验 key 存在；非空可写 {{变量}}
            const expectedConditions = [
                { path: normalizeExpectPath(expectPath1), value: expectValue1.trim() },
                { path: normalizeExpectPath(expectPath2), value: expectValue2.trim() },
            ].filter((c) => c.path)
            const n = Number(timeoutDraft)
            const timeoutMs = Math.min(
                120000,
                Math.max(1000, Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_STEP_TIMEOUT_MS),
            )
            return list.map((r) => {
                if (r.id !== ruleId) return r
                const steps = [...(r.steps || [])]
                if (!steps[idx]) return r
                steps[idx] = {
                    ...steps[idx],
                    headers,
                    queryTemplate: queryText,
                    bodyTemplate: bodyText,
                    expectedConditions: expectedConditions.slice(0, 2),
                    expectedLogic: expectLogic,
                    timeoutMs,
                }
                return { ...r, steps }
            })
        } catch {
            showToast('请求头 JSON 格式错误', 'error')
            return null
        }
    }, [headersText, queryText, bodyText, expectPath1, expectValue1, expectPath2, expectValue2, expectLogic, timeoutDraft])

    useEffect(() => {
        if (!editing || !editingStep) return
        setHeadersText(JSON.stringify(editingStep.headers || {}, null, 2))
        setQueryText(editingStep.queryTemplate || '{}')
        setBodyText(editingStep.bodyTemplate || '{}')
        const stepResKey = `res${stepIndex + 1}`
        const toStepResPath = (p?: string) => {
            if (!p?.trim()) return ''
            let path = p.trim()
            if (path === 'res' || /^res\d+$/.test(path)) return ''
            path = path.replace(/^res\d*\./, '')
            if (!path) return ''
            return `${stepResKey}.${path}`
        }
        const conds = editingStep.expectedConditions || []
        setExpectPath1(toStepResPath(conds[0]?.path))
        setExpectValue1(conds[0]?.value || '')
        setExpectPath2(toStepResPath(conds[1]?.path))
        setExpectValue2(conds[1]?.value || '')
        setExpectLogic(editingStep.expectedLogic === 'or' ? 'or' : 'and')
        setTimeoutDraft(String(editingStep.timeoutMs > 0 ? editingStep.timeoutMs : DEFAULT_STEP_TIMEOUT_MS))
        setConfirmDeleteId(null)
    }, [editingId, stepIndex]) // eslint-disable-line react-hooks/exhaustive-deps

    // 切换规则时清空试跑结果
    useEffect(() => {
        setTestResult(null)
        setMockMsg('')
    }, [editingId])

    const updateRule = (id: string, patch: Partial<CustomApiRule>) => {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    }

    const updateStep = (ruleId: string, idx: number, patch: Partial<CustomApiStep>) => {
        setRules((prev) => prev.map((r) => {
            if (r.id !== ruleId) return r
            const steps = [...(r.steps || [])]
            if (!steps[idx]) return r
            steps[idx] = { ...steps[idx], ...patch }
            return { ...r, steps }
        }))
    }

    const switchStep = (nextIdx: number) => {
        if (!editingId || nextIdx === stepIndex) return
        const flushed = flushStepEditor(rules, editingId, stepIndex)
        if (!flushed) return
        setRules(flushed)
        setStepIndex(nextIdx)
    }

    /** 试跑当前规则：到指定步（含前置）或全部步骤；不发送消息 */
    const runTest = async (untilStepIndex?: number) => {
        if (!editingId) return
        const next = flushStepEditor(rules, editingId, stepIndex)
        if (!next) return
        const rule = next.find((r) => r.id === editingId)
        if (!rule) return
        if (!rule.trigger?.trim()) {
            showToast('请先填写触发内容', 'error')
            return
        }
        const end = untilStepIndex ?? (rule.steps?.length || 1) - 1
        for (let j = 0; j <= end; j++) {
            if (!rule.steps?.[j]?.url?.trim()) {
                showToast(`接口 ${j + 1} URL 不能为空`, 'error')
                return
            }
        }
        setRules(next)
        setTesting(true)
        setTestResult(null)
        try {
            const res = await noAuthFetch<CustomApiTestResult>('/custom-api/test', {
                method: 'POST',
                body: JSON.stringify({
                    rule,
                    untilStepIndex,
                    mockMsg: mockMsg.trim() || rule.trigger,
                }),
            })
            if (res.code !== 0 || !res.data) {
                showToast(res.message || '试跑失败', 'error')
                return
            }
            setTestResult(res.data)
            if (res.data.aborted) {
                showToast(res.data.abortReason || '已中止', 'warning')
            } else {
                showToast('试跑完成', 'success')
            }
        } catch (e) {
            let msg = '试跑失败'
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
            setTesting(false)
        }
    }

    const saveAll = async () => {
        setSaving(true)
        try {
            const next = flushStepEditor(rules, editingId, stepIndex)
            if (!next) {
                setSaving(false)
                return
            }
            for (let i = 0; i < next.length; i++) {
                const r = next[i]
                if (!r.trigger?.trim()) {
                    showToast(`第 ${i + 1} 条「${r.name || '未命名'}」触发内容不能为空`, 'error')
                    setSaving(false)
                    return
                }
                if (!r.steps?.length) {
                    showToast(`第 ${i + 1} 条「${r.name || '未命名'}」至少需要一个接口`, 'error')
                    setSaving(false)
                    return
                }
                for (let j = 0; j < r.steps.length; j++) {
                    if (!r.steps[j].url?.trim()) {
                        showToast(`第 ${i + 1} 条「${r.name}」接口 ${j + 1} URL 不能为空`, 'error')
                        setSaving(false)
                        return
                    }
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
                const normalized = (res.data.rules || []).map(ensureSteps)
                setRules(normalized)
                setOncePerMessage(res.data.oncePerMessage !== false)
                if (editingId && !normalized.some((r) => r.id === editingId)) {
                    setEditingId(normalized[0]?.id ?? null)
                    setStepIndex(0)
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
        setStepIndex(0)
    }

    const removeRule = (id: string) => {
        setRules((prev) => prev.filter((r) => r.id !== id))
        if (editingId === id) {
            setEditingId(null)
            setStepIndex(0)
        }
        setConfirmDeleteId(null)
    }

    const addStep = () => {
        if (!editing) return
        const flushed = flushStepEditor(rules, editing.id, stepIndex)
        if (!flushed) return
        const rule = flushed.find((r) => r.id === editing.id)
        if (!rule) return
        const steps = [...rule.steps, newStep(rule.steps.length)]
        setRules(flushed.map((r) => (r.id === editing.id ? { ...r, steps } : r)))
        setStepIndex(steps.length - 1)
    }

    const removeStep = (idx: number) => {
        if (!editing || (editing.steps?.length || 0) <= 1) {
            showToast('至少保留一个接口', 'warning')
            return
        }
        const flushed = flushStepEditor(rules, editing.id, stepIndex)
        if (!flushed) return
        const rule = flushed.find((r) => r.id === editing.id)
        if (!rule) return
        const steps = rule.steps.filter((_, i) => i !== idx).map((s, i) => ({
            ...s,
            name: s.name?.startsWith('接口 ') ? `接口 ${i + 1}` : s.name,
        }))
        setRules(flushed.map((r) => (r.id === editing.id ? { ...r, steps } : r)))
        setStepIndex(Math.min(stepIndex, steps.length - 1))
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

    const payloadKind = editingStep ? payloadKindFromStep(editingStep) : 'query'
    const bodyAllowed = editingStep
        ? editingStep.method !== 'GET' && editingStep.method !== 'HEAD'
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
                                多接口串行：{'{{res1}}'} → {'{{res2}}'}…；须等上一步结束才请求下一步
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
                <div className="px-4 pb-3.5 pt-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed border-t border-primary/15 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                    <VarGroup title="消息相关">
                        <VarItem name="{{msg}}" desc="触发时的整条原始消息" />
                        <VarItem name="{{user_id}}" desc="发送者 QQ 号" />
                        <VarItem name="{{group_id}}" desc="群号（私聊为空）" />
                        <VarItem name="{{nickname}}" desc="发送者昵称" />
                    </VarGroup>
                    <VarGroup title="多接口返回">
                        <VarItem name="{{res1}}" desc="第 1 个接口的返回对象" />
                        <VarItem name="{{res2.字段}}" desc="第 2 个接口的字段" />
                        <VarItem name="{{res}}" desc="最近一步的返回（兼容）" />
                    </VarGroup>
                    <VarGroup title="JSON 变换">
                        <VarItem name="{{stringify:res1.data}}" desc="JSON.stringify，对象可直接嵌进 Body" />
                        <VarItem name="{{parse:res1.payload}}" desc="只对 payload 做 JSON.parse" />
                        <VarItem name="{{parse:res1.payload|token}}" desc="| 前=parse 谁，| 后=再取字段" />
                    </VarGroup>
                    <VarGroup title="正则触发">
                        <VarItem name="{{match}}" desc="匹配到的整段文本" />
                        <VarItem name="{{match1}}" desc="第 1 个捕获组" />
                        <VarItem name="(?<id>…) → {{id}}" desc="命名分组" />
                    </VarGroup>
                    <VarGroup title="串行与严格">
                        <VarItem name="超时" desc="每步默认 8 秒，超时不继续" />
                        <VarItem name="预期值" desc="字段值须匹配（且/或，最多 2 条）" />
                        <VarItem name="变量缺失" desc="话术/预期值里引用不存在则不发送；请求模板缺变量按空串照发" />
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
                    每条消息多次触发关键词只调用一次
                </label>
                <span className="text-xs text-gray-400">共 {rules.length} 条</span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-start gap-4 min-h-[480px]">
                {/* 左侧列表：sticky 时避开顶部「自定义 API」标题栏（约 5.5rem），避免被挡住 */}
                <div className="w-full lg:w-[220px] shrink-0 card !shadow-none hover:!transform-none hover:!shadow-none overflow-hidden flex flex-col max-h-[40vh] lg:max-h-[calc(100vh-7.5rem)] lg:sticky lg:top-[5.5rem] lg:z-10">
                    <div className="px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-white/[0.02] shrink-0">
                        规则列表
                    </div>
                    <div className="overflow-y-auto flex-1 min-h-0 divide-y divide-gray-100/80 dark:divide-gray-800/60">
                        {rules.map((r) => (
                            <div
                                key={r.id}
                                className={`px-3 py-2.5 cursor-pointer transition-colors border-l-2 ${
                                    editingId === r.id
                                        ? 'bg-primary/[0.08] border-primary'
                                        : 'border-transparent hover:bg-gray-50/90 dark:hover:bg-white/[0.03]'
                                } ${r.enabled ? '' : 'opacity-55'}`}
                                onClick={() => {
                                    setEditingId(r.id)
                                    setStepIndex(0)
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">{r.name}</div>
                                        <div className="text-[11px] text-gray-400 mt-0.5 truncate flex items-center gap-1.5">
                                            <span className="inline-flex px-1 py-px rounded bg-gray-100 dark:bg-white/10 shrink-0">
                                                {triggerLabel[r.triggerType]}
                                            </span>
                                            <span className="truncate">{r.trigger || '(未填触发)'}</span>
                                            <span className="shrink-0 text-primary/80">{(r.steps || []).length} 步</span>
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
                                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                            <button className="text-[10px] px-1.5 py-0.5 rounded-md bg-red-500 text-white" onClick={() => removeRule(r.id)}>确认</button>
                                            <button className="p-1 text-gray-400" onClick={() => setConfirmDeleteId(null)}><IconX size={12} /></button>
                                        </div>
                                    ) : (
                                        <button
                                            className="p-1 text-gray-300 hover:text-red-500 shrink-0"
                                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(r.id) }}
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

                <div className="flex-1 min-w-0">
                    {!editing || !editingStep ? (
                        <div className="card !shadow-none hover:!transform-none hover:!shadow-none p-12 text-center text-sm text-gray-400">
                            从左侧选择或新增规则
                        </div>
                    ) : (
                        <div className="card !shadow-none hover:!transform-none hover:!shadow-none bg-gray-50/90 dark:bg-[#18191C] p-4 space-y-3">
                            <div className="flex items-center justify-between gap-2 px-1">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">编辑规则</h3>
                                <span className="text-xs text-gray-400 font-mono truncate max-w-[40%]">{editing.id}</span>
                            </div>

                            <SectionBlock title="触发条件">
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                    <Field label="规则名称" className="sm:col-span-3">
                                        <input className="input-field" value={editing.name} onChange={(e) => updateRule(editing.id, { name: e.target.value })} />
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
                                            placeholder={editing.triggerType === 'regex' ? '例如：id=(?<id>[a-zA-Z0-9]+)' : '关键词'}
                                        />
                                    </Field>
                                </div>
                            </SectionBlock>

                            <SectionBlock title="请求链路（串行，须等上一步结束）">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                    每个接口独立一块；点击展开编辑。执行顺序从上到下，结果依次为 res1、res2…
                                </p>
                                <div className="space-y-0">
                                    {(editing.steps || []).map((s, i) => {
                                        const active = stepIndex === i
                                        return (
                                            <div key={s.id}>
                                                {i > 0 && (
                                                    <div className="flex flex-col items-center py-1.5 text-primary/70">
                                                        <div className="w-px h-3 bg-primary/40" />
                                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25">
                                                            串行等待
                                                        </span>
                                                        <div className="w-px h-3 bg-primary/40" />
                                                    </div>
                                                )}
                                                <div
                                                    className={`rounded-xl border-2 overflow-hidden transition-colors ${
                                                        active
                                                            ? 'border-primary bg-primary/[0.04] dark:bg-primary/10 shadow-sm'
                                                            : 'border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-black/20'
                                                    }`}
                                                >
                                                    {/* 接口卡片头：始终可见，区域分明 */}
                                                    <button
                                                        type="button"
                                                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 ${
                                                            active ? 'bg-primary/10' : 'hover:bg-white/80 dark:hover:bg-white/[0.04]'
                                                        }`}
                                                        onClick={() => switchStep(i)}
                                                    >
                                                        <span className={`shrink-0 inline-flex h-8 min-w-[2rem] px-1.5 items-center justify-center rounded-lg text-xs font-bold ${
                                                            active ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                                                        }`}>
                                                            {i + 1}
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                                    {s.name || `接口 ${i + 1}`}
                                                                </span>
                                                                <span className="text-[11px] px-1.5 py-px rounded bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 font-mono">
                                                                    → res{i + 1}
                                                                </span>
                                                                <span className="text-[11px] px-1.5 py-px rounded bg-gray-200/80 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                                                                    {s.method}
                                                                </span>
                                                                <span className="text-[11px] text-gray-400">{s.timeoutMs || DEFAULT_STEP_TIMEOUT_MS}ms</span>
                                                            </div>
                                                            <div className="text-[11px] text-gray-400 font-mono truncate mt-0.5">{s.url || '(未填 URL)'}</div>
                                                        </div>
                                                        <span className={`text-xs shrink-0 ${active ? 'text-primary font-medium' : 'text-gray-400'}`}>
                                                            {active ? '编辑中' : '点击展开'}
                                                        </span>
                                                    </button>

                                                    {active && (
                                                        <div className="px-3 pb-3 pt-1 border-t border-primary/20 space-y-3 bg-white/70 dark:bg-[#1e1e20]/80">
                                                            {/* 方法/体类型/超时收窄，URL 吃掉剩余宽度 */}
                                                            <div className="flex flex-wrap items-end gap-2">
                                                                <Field label="步骤名" className="w-[7.5rem] shrink-0">
                                                                    <input
                                                                        className="input-field"
                                                                        value={editingStep.name}
                                                                        onChange={(e) => updateStep(editing.id, stepIndex, { name: e.target.value })}
                                                                    />
                                                                </Field>
                                                                <Field label="方法" className="w-[5.25rem] shrink-0">
                                                                    <select
                                                                        className="input-field"
                                                                        value={editingStep.method}
                                                                        onChange={(e) => {
                                                                            const method = e.target.value as CustomApiHttpMethod
                                                                            const kind = defaultPayloadKind(method)
                                                                            updateStep(editing.id, stepIndex, {
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
                                                                <Field label="请求体类型" className="w-[7.5rem] shrink-0">
                                                                    <select
                                                                        className="input-field"
                                                                        value={payloadKind}
                                                                        onChange={(e) => {
                                                                            const kind = e.target.value as PayloadKind
                                                                            if (kind !== 'query' && !bodyAllowed) {
                                                                                showToast('GET/HEAD 仅支持 Query', 'warning')
                                                                                return
                                                                            }
                                                                            updateStep(editing.id, stepIndex, {
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
                                                                <Field label="超时(毫秒)" className="w-[5.5rem] shrink-0">
                                                                    <input
                                                                        type="number"
                                                                        min={1000}
                                                                        max={120000}
                                                                        className="input-field"
                                                                        value={timeoutDraft}
                                                                        onChange={(e) => setTimeoutDraft(e.target.value)}
                                                                        onBlur={() => {
                                                                            const n = Number(timeoutDraft)
                                                                            const clamped = Math.min(
                                                                                120000,
                                                                                Math.max(
                                                                                    1000,
                                                                                    Number.isFinite(n) && n > 0
                                                                                        ? Math.floor(n)
                                                                                        : DEFAULT_STEP_TIMEOUT_MS,
                                                                                ),
                                                                            )
                                                                            setTimeoutDraft(String(clamped))
                                                                            updateStep(editing.id, stepIndex, { timeoutMs: clamped })
                                                                        }}
                                                                    />
                                                                </Field>
                                                                <Field label="接口 URL" className="flex-1 min-w-[14rem]">
                                                                    <input
                                                                        className="input-field font-mono text-sm"
                                                                        value={editingStep.url}
                                                                        onChange={(e) => updateStep(editing.id, stepIndex, { url: e.target.value })}
                                                                        placeholder={stepIndex > 0 ? '可用 {{res1.xxx}}' : 'https://...'}
                                                                    />
                                                                </Field>
                                                            </div>

                                                            <JsonField
                                                                label="请求头 (JSON)"
                                                                value={headersText}
                                                                onChange={setHeadersText}
                                                                onFormat={() => formatField('headers')}
                                                            />
                                                            {payloadKind === 'query' ? (
                                                                <JsonField
                                                                    label={`Query 参数（本步结果 → res${stepIndex + 1}）`}
                                                                    value={queryText}
                                                                    onChange={setQueryText}
                                                                    onFormat={() => formatField('query')}
                                                                    hint={stepIndex > 0 ? '可引用上一步，如 {"id":"{{res1.data.id}}"}' : '例如 {"q":"{{msg}}"}'}
                                                                />
                                                            ) : (
                                                                <JsonField
                                                                    label={payloadKind === 'form' || payloadKind === 'multipart' ? '表单字段' : '请求体模板'}
                                                                    value={bodyText}
                                                                    onChange={setBodyText}
                                                                    onFormat={payloadKind === 'raw' ? undefined : () => formatField('body')}
                                                                    hint={stepIndex > 0 ? '可写 {{res1.字段}} 引用上一步返回' : '可含 {{msg}} 等占位符'}
                                                                    mono
                                                                />
                                                            )}
                                                            <div>
                                                                <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5">
                                                                    预期返回值（可选，最多 2 条）
                                                                </div>
                                                                <p className="text-xs text-gray-400 mb-2">
                                                                    本步 <code className="text-primary">res{stepIndex + 1}</code>
                                                                    ；value 可写 <code className="text-primary">{'{{id}}'}</code> 等变量；
                                                                    <strong className="font-medium text-gray-500 dark:text-gray-300">留空</strong>则只要该 key 存在即通过
                                                                </p>
                                                                {/* key/value 均有最短宽度，空间够时在组内平分 */}
                                                                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 bg-gray-50/50 dark:bg-black/10">
                                                                    <div className="flex items-center gap-1.5 grow basis-[14rem] min-w-[14rem]">
                                                                        <input
                                                                            className="input-field font-mono text-sm !w-0 flex-1 min-w-[6rem]"
                                                                            value={expectPath1}
                                                                            onChange={(e) => setExpectPath1(e.target.value)}
                                                                            placeholder={`res${stepIndex + 1}.success`}
                                                                        />
                                                                        <span className="text-xs text-gray-400 shrink-0">=</span>
                                                                        <input
                                                                            className="input-field font-mono text-sm !w-0 flex-1 min-w-[6rem]"
                                                                            value={expectValue1}
                                                                            onChange={(e) => setExpectValue1(e.target.value)}
                                                                            placeholder="空=存在 / true / {{id}}"
                                                                        />
                                                                    </div>
                                                                    <select
                                                                        className="input-field !w-auto text-sm shrink-0"
                                                                        value={expectLogic}
                                                                        onChange={(e) => setExpectLogic(e.target.value as 'and' | 'or')}
                                                                    >
                                                                        <option value="and">且</option>
                                                                        <option value="or">或</option>
                                                                    </select>
                                                                    <div className="flex items-center gap-1.5 grow basis-[14rem] min-w-[14rem]">
                                                                        <input
                                                                            className="input-field font-mono text-sm !w-0 flex-1 min-w-[6rem]"
                                                                            value={expectPath2}
                                                                            onChange={(e) => setExpectPath2(e.target.value)}
                                                                            placeholder={`res${stepIndex + 1}.status`}
                                                                        />
                                                                        <span className="text-xs text-gray-400 shrink-0">=</span>
                                                                        <input
                                                                            className="input-field font-mono text-sm !w-0 flex-1 min-w-[6rem]"
                                                                            value={expectValue2}
                                                                            onChange={(e) => setExpectValue2(e.target.value)}
                                                                            placeholder="空=存在 / {{msg}}"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-ghost text-xs"
                                                                    disabled={testing}
                                                                    onClick={() => runTest(stepIndex)}
                                                                >
                                                                    {testing ? '试跑中…' : `测试到此步（含前置 → res${stepIndex + 1}）`}
                                                                </button>
                                                                {(editing.steps?.length || 0) > 1 && (
                                                                    <button
                                                                        type="button"
                                                                        className="text-xs text-red-500 hover:underline"
                                                                        onClick={() => removeStep(stepIndex)}
                                                                    >
                                                                        删除此接口
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                <button type="button" className="btn btn-ghost text-xs mt-3" onClick={addStep}>
                                    + 添加下一个接口
                                </button>
                            </SectionBlock>

                            {/* 试跑：模拟消息 + 全部步骤 + 返回值展示 */}
                            <SectionBlock title="测试接口">
                                <p className="text-xs text-gray-400 mb-3">
                                    由插件服务端发起真实请求（不发群/私聊）。多步时会串行执行；开启严格中止时，失败会停在该步。
                                </p>
                                <Field label="模拟消息（填充 {{msg}} / 正则捕获，默认同触发内容）">
                                    <input
                                        className="input-field font-mono text-sm"
                                        value={mockMsg}
                                        onChange={(e) => setMockMsg(e.target.value)}
                                        placeholder={editing.trigger || '例如：查天气 北京'}
                                    />
                                </Field>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <button
                                        type="button"
                                        className="btn btn-primary text-xs"
                                        disabled={testing}
                                        onClick={() => runTest()}
                                    >
                                        {testing ? '试跑中…' : '测试全部接口'}
                                    </button>
                                    {testResult && (
                                        <button
                                            type="button"
                                            className="btn btn-ghost text-xs"
                                            onClick={() => setTestResult(null)}
                                        >
                                            清空结果
                                        </button>
                                    )}
                                </div>
                                {testResult && (
                                    <div className="mt-3 space-y-3">
                                        {/* 触发匹配：模拟消息命中了什么 */}
                                        <div className={`rounded-lg border p-3 text-sm ${
                                            testResult.match.matched
                                                ? 'border-sky-200 dark:border-sky-500/30 bg-sky-50/70 dark:bg-sky-500/10'
                                                : 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-500/10'
                                        }`}>
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className="font-semibold text-gray-800 dark:text-gray-100">触发匹配</span>
                                                <span className={`text-[11px] px-1.5 py-px rounded ${
                                                    testResult.match.matched
                                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                                        : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                                }`}>
                                                    {testResult.match.matched ? '已命中' : '未命中（试跑仍会请求接口）'}
                                                </span>
                                                <span className="text-[11px] text-gray-400">
                                                    {testResult.match.triggerType === 'exact' ? '精确'
                                                        : testResult.match.triggerType === 'fuzzy' ? '模糊' : '正则'}
                                                </span>
                                            </div>
                                            <div className="space-y-1.5 text-xs">
                                                <div className="flex gap-2 min-w-0">
                                                    <span className="shrink-0 text-gray-400 w-16">模拟消息</span>
                                                    <code className="font-mono break-all text-gray-800 dark:text-gray-200">{testResult.match.mockMsg || '(空)'}</code>
                                                </div>
                                                <div className="flex gap-2 min-w-0">
                                                    <span className="shrink-0 text-gray-400 w-16">触发内容</span>
                                                    <code className="font-mono break-all text-gray-800 dark:text-gray-200">{testResult.match.trigger || '(空)'}</code>
                                                </div>
                                                <div className="flex gap-2 min-w-0">
                                                    <span className="shrink-0 text-gray-400 w-16">{'{{match}}'}</span>
                                                    <code className="font-mono break-all text-gray-800 dark:text-gray-200">
                                                        {testResult.match.matched
                                                            ? (testResult.match.match ?? '(空)')
                                                            : '—'}
                                                    </code>
                                                </div>
                                                {testResult.match.groups.map((g, gi) => (
                                                    <div key={`g${gi}`} className="flex gap-2 min-w-0">
                                                        <span className="shrink-0 text-gray-400 w-16">{`{{match${gi + 1}}}`}</span>
                                                        <code className="font-mono break-all text-gray-800 dark:text-gray-200">{g || '(空)'}</code>
                                                    </div>
                                                ))}
                                                {Object.entries(testResult.match.named || {}).map(([k, v]) => (
                                                    <div key={k} className="flex gap-2 min-w-0">
                                                        <span className="shrink-0 text-gray-400 w-16">{`{{${k}}}`}</span>
                                                        <code className="font-mono break-all text-gray-800 dark:text-gray-200">{v || '(空)'}</code>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        {testResult.steps.map((st) => (
                                            <div
                                                key={st.index}
                                                className={`rounded-lg border p-3 text-sm ${
                                                    st.error || !st.expectOk
                                                        ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-500/10'
                                                        : 'border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-black/20'
                                                }`}
                                            >
                                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                                    <span className="font-semibold text-gray-800 dark:text-gray-100">
                                                        步骤 {st.index + 1} · {st.name}
                                                    </span>
                                                    <span className="text-[11px] px-1.5 py-px rounded bg-gray-200/80 dark:bg-white/10 font-mono">
                                                        {st.method}
                                                    </span>
                                                    <span className={`text-[11px] px-1.5 py-px rounded font-mono ${
                                                        st.httpOk
                                                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                                            : 'bg-gray-200 dark:bg-white/10 text-gray-500'
                                                    }`}>
                                                        {st.status != null ? `HTTP ${st.status}` : '无状态'}
                                                    </span>
                                                    <span className="text-[11px] text-gray-400">{st.durationMs}ms</span>
                                                    <span className="text-[11px] px-1.5 py-px rounded bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 font-mono">
                                                        res{st.index + 1}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-gray-400 font-mono break-all mb-2">{st.url}</div>
                                                {st.error && (
                                                    <div className="text-xs text-red-500 mb-2">{st.error}</div>
                                                )}
                                                {!st.expectOk && st.expectMessage && (
                                                    <div className="text-xs text-amber-600 dark:text-amber-400 mb-2">{st.expectMessage}</div>
                                                )}
                                                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">返回值</div>
                                                <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto rounded-md bg-white dark:bg-black/40 border border-gray-100 dark:border-gray-800 p-2.5 text-gray-800 dark:text-gray-200">
                                                    {st.json != null
                                                        ? JSON.stringify(st.json, null, 2)
                                                        : (st.text || '(空)')}
                                                </pre>
                                            </div>
                                        ))}
                                        {testResult.replyPreview != null && (
                                            <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 p-3">
                                                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1">话术预览（未发送）</div>
                                                <pre className="text-sm whitespace-pre-wrap break-all text-gray-800 dark:text-gray-100">{testResult.replyPreview}</pre>
                                            </div>
                                        )}
                                        {testResult.replyError && !testResult.replyPreview && (
                                            <div className="text-xs text-amber-600 dark:text-amber-400">
                                                {testResult.replyError}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </SectionBlock>

                            <SectionBlock title="回复与发送">
                                <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white/[0.04] px-3 py-2.5 mb-3">
                                    <div>
                                        <div className="text-sm font-medium text-gray-800 dark:text-gray-100">严格中止（推荐）</div>
                                        <div className="text-xs text-gray-400 mt-0.5">超时 / 预期返回值不符 / 话术变量缺失时不发送（请求模板缺变量按空串照发）</div>
                                    </div>
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            checked={editing.strictAbort !== false}
                                            onChange={(e) => updateRule(editing.id, { strictAbort: e.target.checked })}
                                        />
                                        <div className="slider" />
                                    </label>
                                </div>

                                <Field label="话术模板">
                                    <textarea
                                        className="input-field font-mono text-sm min-h-[80px] leading-relaxed"
                                        value={editing.replyTemplate}
                                        onChange={(e) => updateRule(editing.id, { replyTemplate: e.target.value })}
                                        placeholder="例如：房间码 {{res2.code}}（来自第二步）"
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
                                                <label key={g.group_id} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md cursor-pointer hover:bg-white dark:hover:bg-white/[0.06]">
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
                                                <label key={f.user_id} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md cursor-pointer hover:bg-white dark:hover:bg-white/[0.06]">
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
