import { useState, useEffect, useCallback, useMemo } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { GroupInfo } from '../types'
import { IconSearch, IconRefresh, IconCheck, IconX } from '../components/icons'
import MailVarsHint from '../components/MailVarsHint'

export default function GroupsPage() {
    const [groups, setGroups] = useState<GroupInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [checked, setChecked] = useState<Set<number>>(new Set())
    const [authDays, setAuthDays] = useState('30')
    const [bulkDays, setBulkDays] = useState('30')

    const fetchGroups = useCallback(async () => {
        setLoading(true)
        try {
            const res = await noAuthFetch<GroupInfo[]>('/groups')
            if (res.code === 0 && res.data) {
                setGroups(res.data)
                setSelectedId((prev) => {
                    if (prev && res.data!.some((g) => g.group_id === prev)) return prev
                    return res.data![0]?.group_id ?? null
                })
            }
        } catch {
            showToast('获取群列表失败', 'error')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchGroups() }, [fetchGroups])

    const filtered = useMemo(() => {
        if (!search) return groups
        const q = search.toLowerCase()
        return groups.filter((g) =>
            g.group_name?.toLowerCase().includes(q) || String(g.group_id).includes(q)
        )
    }, [groups, search])

    const selected = useMemo(
        () => groups.find((g) => g.group_id === selectedId) || null,
        [groups, selectedId]
    )

    const patchGroup = async (groupId: number, body: Record<string, unknown>, okMsg: string) => {
        try {
            const res = await noAuthFetch<GroupInfo>(`/groups/${groupId}/config`, {
                method: 'POST',
                body: JSON.stringify(body),
            })
            if (res.code !== 0) {
                showToast(res.message || '操作失败', 'error')
                return
            }
            await fetchGroups()
            showToast(okMsg, 'success')
        } catch {
            showToast('操作失败', 'error')
        }
    }

    const bulkPatch = async (body: Record<string, unknown>, okMsg: string) => {
        if (checked.size === 0) {
            showToast('请先勾选群', 'warning')
            return
        }
        try {
            const res = await noAuthFetch('/groups/bulk-config', {
                method: 'POST',
                body: JSON.stringify({ ...body, groupIds: Array.from(checked) }),
            })
            if (res.code !== 0) {
                showToast(res.message || '批量操作失败', 'error')
                return
            }
            await fetchGroups()
            showToast(okMsg, 'success')
            setChecked(new Set())
        } catch {
            showToast('批量操作失败', 'error')
        }
    }

    const toggleChecked = (groupId: number) => {
        setChecked((prev) => {
            const next = new Set(prev)
            if (next.has(groupId)) next.delete(groupId)
            else next.add(groupId)
            return next
        })
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">加载群列表中...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col lg:flex-row gap-4 min-h-[520px]">
            {/* 左侧：群列表 */}
            <div className="w-full lg:w-[320px] shrink-0 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            className="input-field pl-9"
                            placeholder="搜索群..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <button className="btn btn-ghost text-xs shrink-0" onClick={fetchGroups}>
                        <IconRefresh size={13} />
                    </button>
                </div>

                {checked.size > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        <button className="btn btn-primary text-[11px] !px-2 !py-1" onClick={() => bulkPatch({ poweredOn: true }, `已批量开机 ${checked.size} 个群`)}>
                            <IconCheck size={12} /> 开机
                        </button>
                        <button className="btn btn-danger text-[11px] !px-2 !py-1" onClick={() => bulkPatch({ poweredOn: false }, `已批量关机 ${checked.size} 个群`)}>
                            <IconX size={12} /> 关机
                        </button>
                        <input
                            className="input-field !w-14 !py-1 text-[11px]"
                            type="number"
                            min={0}
                            value={bulkDays}
                            onChange={(e) => setBulkDays(e.target.value)}
                        />
                        <button
                            className="btn btn-ghost text-[11px] !px-2 !py-1"
                            onClick={() => {
                                const days = Number(bulkDays)
                                if (!Number.isFinite(days) || days <= 0) {
                                    showToast('请输入有效天数', 'warning')
                                    return
                                }
                                bulkPatch({ addAuthDays: days }, `已批量延长 ${days} 天`)
                            }}
                        >
                            延长
                        </button>
                        <button className="btn btn-ghost text-[11px] !px-2 !py-1" onClick={() => bulkPatch({ features: { mailJoin: true } }, `已为 ${checked.size} 个群开启入群邮件`)}>
                            入群邮件开
                        </button>
                        <button className="btn btn-ghost text-[11px] !px-2 !py-1" onClick={() => bulkPatch({ features: { mailJoin: false } }, `已为 ${checked.size} 个群关闭入群邮件`)}>
                            入群邮件关
                        </button>
                        <button className="btn btn-ghost text-[11px] !px-2 !py-1" onClick={() => bulkPatch({ features: { mailLeave: true } }, `已为 ${checked.size} 个群开启退群邮件`)}>
                            退群邮件开
                        </button>
                        <button className="btn btn-ghost text-[11px] !px-2 !py-1" onClick={() => bulkPatch({ features: { mailLeave: false } }, `已为 ${checked.size} 个群关闭退群邮件`)}>
                            退群邮件关
                        </button>
                    </div>
                )}

                <p className="text-[11px] text-gray-400">
                    共 {groups.length} 群 · 可处理 {groups.filter((g) => g.canProcess).length}
                </p>

                <div className="card flex-1 overflow-y-auto max-h-[60vh] lg:max-h-none divide-y divide-gray-50 dark:divide-gray-800/50">
                    {filtered.map((g) => {
                        const active = selectedId === g.group_id
                        return (
                            <div
                                key={g.group_id}
                                className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                                    active
                                        ? 'bg-primary/10 border-l-2 border-primary'
                                        : 'hover:bg-gray-50/80 dark:hover:bg-white/[0.03] border-l-2 border-transparent'
                                }`}
                                onClick={() => setSelectedId(g.group_id)}
                            >
                                <input
                                    type="checkbox"
                                    className="mt-1 rounded border-gray-300 dark:border-gray-600"
                                    checked={checked.has(g.group_id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => toggleChecked(g.group_id)}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                        {g.group_name || '未知群'}
                                    </div>
                                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">{g.group_id}</div>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        <Badge ok={g.poweredOn} yes="开机" no="关机" />
                                        <Badge ok={g.authorized} yes="已授权" no="未授权" />
                                        <Badge ok={g.canProcess} yes="可处理" no="不可处理" />
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                    {filtered.length === 0 && (
                        <div className="py-10 text-center text-sm text-gray-400">
                            {search ? '没有匹配的群' : '暂无群数据'}
                        </div>
                    )}
                </div>
            </div>

            {/* 右侧：功能区 */}
            <div className="flex-1 min-w-0">
                {!selected ? (
                    <div className="card p-10 text-center text-sm text-gray-400">
                        请从左侧选择一个群
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="card p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                        {selected.group_name || '未知群'}
                                    </h3>
                                    <p className="text-xs text-gray-400 font-mono mt-1">{selected.group_id}</p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        成员 {selected.member_count}/{selected.max_member_count}
                                        {selected.settingsInitialized ? ' · 已应用初始设置' : ' · 首次开机将写入全局设置'}
                                    </p>
                                </div>
                                <span className={`text-xs font-medium px-2 py-1 rounded ${
                                    selected.canProcess
                                        ? 'bg-emerald-500/10 text-emerald-500'
                                        : 'bg-gray-100 dark:bg-white/5 text-gray-400'
                                }`}>
                                    {selected.canProcess ? '可处理' : '不可处理'}
                                </span>
                            </div>
                        </div>

                        {/* 基础：开机 / 授权 */}
                        <div className="card p-5 space-y-5">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">基础</h4>
                            <ToggleRow
                                label="开机状态"
                                desc="关机时不处理该群任何后续功能；首次开机会写入「全局设置」中的功能初始值"
                                checked={selected.poweredOn}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { poweredOn: v },
                                    `群已${v ? '开机' : '关机'}`
                                )}
                            />
                            <div>
                                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">授权</div>
                                <div className={`text-xs mt-0.5 ${selected.authorized ? 'text-emerald-500' : 'text-red-400'}`}>
                                    {selected.authExpireText}
                                </div>
                                <div className="flex items-center gap-2 mt-3">
                                    <input
                                        className="input-field !w-24"
                                        type="number"
                                        min={0}
                                        value={authDays}
                                        onChange={(e) => setAuthDays(e.target.value)}
                                    />
                                    <span className="text-xs text-gray-400">天</span>
                                    <button
                                        className="btn btn-primary text-xs"
                                        onClick={() => {
                                            const days = Number(authDays)
                                            if (!Number.isFinite(days) || days <= 0) {
                                                showToast('请输入有效天数', 'warning')
                                                return
                                            }
                                            patchGroup(selected.group_id, { addAuthDays: days }, `已延长 ${days} 天`)
                                        }}
                                    >
                                        延长
                                    </button>
                                    <button
                                        className="btn btn-ghost text-xs"
                                        onClick={() => {
                                            const days = Number(authDays)
                                            if (!Number.isFinite(days) || days < 0) {
                                                showToast('请输入有效天数', 'warning')
                                                return
                                            }
                                            patchGroup(
                                                selected.group_id,
                                                { setAuthDays: days },
                                                days === 0 ? '授权已清除' : `授权已设为 ${days} 天`
                                            )
                                        }}
                                    >
                                        设为
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 功能区：每个功能一块，而不是表格一列 */}
                        <div className="card p-5 space-y-5">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">功能</h4>
                                <p className="text-xs text-gray-400 mt-1">
                                    以下为本群独立设置。未开机前显示的是全局初始预览；开机后改「全局设置」不会再影响本群。
                                </p>
                            </div>
                            <ToggleRow
                                label="Webhook 通知"
                                desc="开启后，外部 Webhook 通知会推送到本群（仍需已授权且开机）"
                                checked={selected.features.notify}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { notify: v } },
                                    `Webhook 通知已${v ? '开启' : '关闭'}`
                                )}
                            />
                            <ToggleRow
                                label="自定义 API"
                                desc="开启后，本群消息可按规则触发外部接口并回发话术"
                                checked={selected.features.customApi === true}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { customApi: v } },
                                    `自定义 API 已${v ? '开启' : '关闭'}`
                                )}
                            />
                            <ToggleRow
                                label="入群邮件"
                                desc="有人入群时，给该成员自己的 QQ 邮箱（QQ号@qq.com）发信。不会发给固定管理员。仍需本群已授权且开机，并在「邮件通知」里配好 SMTP"
                                checked={selected.features.mailJoin === true}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { mailJoin: v } },
                                    `入群邮件已${v ? '开启' : '关闭'}`
                                )}
                            />
                            <ToggleRow
                                label="退群邮件"
                                desc="有人退群时，给该成员自己的 QQ 邮箱（QQ号@qq.com）发信。不会发给固定管理员。仍需本群已授权且开机，并在「邮件通知」里配好 SMTP"
                                checked={selected.features.mailLeave === true}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { mailLeave: v } },
                                    `退群邮件已${v ? '开启' : '关闭'}`
                                )}
                            />
                        </div>

                        <GroupMailCopy
                            key={selected.group_id}
                            group={selected}
                            onSave={(template, okMsg) => patchGroup(
                                selected.group_id,
                                { mailTemplate: template },
                                okMsg,
                            )}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

/**
 * 本群邮件文案
 * 主题或正文留空表示用全局模板，保存空字符串不会发空白邮件
 */
function GroupMailCopy({ group, onSave }: {
    group: GroupInfo
    onSave: (template: { subject: string; body: string }, okMsg: string) => void
}) {
    const [subject, setSubject] = useState(group.mailTemplate?.subject || '')
    const [body, setBody] = useState(group.mailTemplate?.body || '')

    useEffect(() => {
        setSubject(group.mailTemplate?.subject || '')
        setBody(group.mailTemplate?.body || '')
    }, [group.group_id, group.mailTemplate?.subject, group.mailTemplate?.body])

    const usingGlobal = !subject.trim() && !body.trim()

    return (
        <div className="card p-5 space-y-4">
            <div>
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">本群邮件文案</h4>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                    只影响这个群的入群和退群邮件。主题或正文留空，就用「邮件通知」页的全局文案，不会发出空白邮件。
                    收件人仍然是成员自己的 QQ 邮箱（QQ号@qq.com）。
                    {usingGlobal ? ' 当前两项都是空的，这个群使用全局文案。' : ''}
                </p>
            </div>
            <label className="block">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">主题</div>
                <div className="text-xs text-gray-400 mb-2">留空则使用全局主题</div>
                <input
                    className="input-field"
                    placeholder="留空则使用全局主题"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                />
            </label>
            <label className="block">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">正文</div>
                <div className="text-xs text-gray-400 mb-2">留空则使用全局正文</div>
                <textarea
                    className="input-field min-h-[140px] resize-y"
                    placeholder="留空则使用全局正文"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                />
            </label>
            <MailVarsHint />
            <div className="flex flex-wrap gap-2">
                <button
                    className="btn btn-primary text-xs"
                    onClick={() => onSave(
                        { subject: subject.trim(), body: body.trim() },
                        subject.trim() || body.trim() ? '本群邮件文案已保存' : '已改回全局邮件文案',
                    )}
                >
                    保存本群文案
                </button>
                <button
                    className="btn btn-ghost text-xs"
                    onClick={() => {
                        setSubject('')
                        setBody('')
                        onSave({ subject: '', body: '' }, '已改回全局邮件文案')
                    }}
                >
                    清空并使用全局文案
                </button>
            </div>
        </div>
    )
}

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-gray-100 dark:bg-white/5 text-gray-400'
        }`}>
            {ok ? yes : no}
        </span>
    )
}

function ToggleRow({ label, desc, checked, onChange }: {
    label: string; desc: string; checked: boolean; onChange: (v: boolean) => void
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
            </div>
            <label className="toggle shrink-0">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
                <div className="slider" />
            </label>
        </div>
    )
}
