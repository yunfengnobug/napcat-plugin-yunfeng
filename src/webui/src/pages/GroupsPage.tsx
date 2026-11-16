import { useState, useEffect, useCallback, useMemo, useRef, type ReactElement } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { GroupInfo } from '../types'
import { IconSearch, IconRefresh, IconCheck, IconX } from '../components/icons'
import MailVarsHint from '../components/MailVarsHint'
import Drawer from '../components/Drawer'
import FeatureToggleRow from '../components/FeatureToggleRow'
import { InheritanceBadge, InheritanceBanner, mailInheritCues, type MailInheritCues } from '../components/InheritanceCue'
import { WebhookSettingsPanel } from './ConfigPage'
import CustomApiPage from './CustomApiPage'

/** 群管理里点「配置」时打开的抽屉。邮件是本群文案；Webhook 和自定义 API 打开全局配置 */
type GroupFeatureDrawer = 'webhook' | 'customApi' | 'mailJoin' | 'mailLeave'

export default function GroupsPage() {
    const [groups, setGroups] = useState<GroupInfo[]>([])
    // 只有第一次拉取才用整页加载。之后刷新不能卸掉列表，否则勾选和抽屉草稿会一起丢掉
    const [ready, setReady] = useState(false)
    const [search, setSearch] = useState('')
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [checked, setChecked] = useState<Set<number>>(new Set())
    const [authDays, setAuthDays] = useState('30')
    const [bulkDays, setBulkDays] = useState('30')
    const [drawer, setDrawer] = useState<GroupFeatureDrawer | null>(null)
    const closeDrawer = useCallback(() => setDrawer(null), [])

    const fetchGroups = useCallback(async () => {
        try {
            const res = await noAuthFetch<GroupInfo[]>('/groups')
            if (res.code === 0 && res.data) {
                const list = res.data
                setGroups(list)
                // 群对象会被换成新的，勾选按群号保留；群已经不在列表里才去掉
                const alive = new Set(list.map((g) => g.group_id))
                setChecked((prev) => {
                    let dropped = false
                    const next = new Set<number>()
                    for (const id of prev) {
                        if (alive.has(id)) next.add(id)
                        else dropped = true
                    }
                    return dropped ? next : prev
                })
                setSelectedId((prev) => {
                    if (prev && list.some((g) => g.group_id === prev)) return prev
                    return list[0]?.group_id ?? null
                })
            }
        } catch {
            showToast('获取群列表失败', 'error')
        } finally {
            setReady(true)
        }
    }, [])

    useEffect(() => { fetchGroups() }, [fetchGroups])

    // 换群时关掉抽屉，避免还停在上一个群的文案草稿上
    useEffect(() => { setDrawer(null) }, [selectedId])

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
    const selectedMailCues = mailInheritCues({
        subject: selected?.mailTemplate?.subject,
        body: selected?.mailTemplate?.body,
        leaveSubject: selected?.mailTemplate?.leaveSubject,
        leaveBody: selected?.mailTemplate?.leaveBody,
        leaveFollowJoin: selected?.mailTemplate?.leaveFollowJoin,
        globalLeaveFollowJoin: selected?.globalLeaveFollowJoin,
    })

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
            // 开机、关机、延长和功能开关都不把群移出列表，勾选留着，方便接着做下一个批量操作
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

    // 全选只动当前看得到的群。筛选外已经勾上的继续留着
    const toggleVisible = (selectAll: boolean) => {
        const visible = filtered.map((g) => g.group_id)
        setChecked((prev) => {
            const next = new Set(prev)
            if (selectAll) {
                for (const id of visible) next.add(id)
            } else {
                for (const id of visible) next.delete(id)
            }
            return next
        })
    }

    if (!ready) {
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
        <>
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

                <div className="card flex-1 overflow-y-auto max-h-[60vh] lg:max-h-none">
                    <VisibleSelectAll
                        ids={filtered.map((g) => g.group_id)}
                        checked={checked}
                        filtered={!!search}
                        onToggle={toggleVisible}
                    />
                    <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
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
                            <FeatureToggleRow
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

                        {/* 功能区：开关管本群开停，配置进抽屉，不再铺在群详情里 */}
                        <div className="card p-5 space-y-5">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">功能</h4>
                                <p className="text-xs text-gray-400 mt-1">
                                    以下为本群独立开关。未开机前显示的是全局初始预览；开机后改「全局设置」里的开关不会再影响本群。
                                    有参数的功能，点开关后面的「配置」。
                                    蓝色「已采用全局配置」表示没有本群覆盖；粉色「与入群邮件一致」表示退群在用入群文案；橙色「这项跟随全局」表示这个勾选还跟着全局，但文案已经是本群的。
                                </p>
                            </div>
                            <FeatureToggleRow
                                label="Webhook 通知"
                                desc="开启后，外部通知会推到本群（仍需已授权且开机）。地址、密钥和话术点右侧「配置」，那是所有群共用的"
                                badges={<InheritanceBadge tone="global">已采用全局配置</InheritanceBadge>}
                                checked={selected.features.notify}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { notify: v } },
                                    `Webhook 通知已${v ? '开启' : '关闭'}`
                                )}
                                onConfigure={() => setDrawer('webhook')}
                            />
                            <FeatureToggleRow
                                label="自定义 API"
                                desc="开启后，本群消息可按规则触发外部接口并回发话术。规则点右侧「配置」，规则本身是全局的"
                                badges={<InheritanceBadge tone="global">已采用全局配置</InheritanceBadge>}
                                checked={selected.features.customApi === true}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { customApi: v } },
                                    `自定义 API 已${v ? '开启' : '关闭'}`
                                )}
                                onConfigure={() => setDrawer('customApi')}
                            />
                            <FeatureToggleRow
                                label="入群邮件"
                                desc="有人入群时，给该成员自己的 QQ 邮箱（QQ号@qq.com）发信。点右侧「配置」写本群主题和正文。SMTP 在全局设置的入群邮件配置里"
                                badges={mailRowBadges(selectedMailCues, 'join')}
                                checked={selected.features.mailJoin === true}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { mailJoin: v } },
                                    `入群邮件已${v ? '开启' : '关闭'}`
                                )}
                                onConfigure={() => setDrawer('mailJoin')}
                            />
                            <FeatureToggleRow
                                label="退群邮件"
                                desc="有人退群时，给该成员自己的 QQ 邮箱（QQ号@qq.com）发信。点右侧「配置」写本群退群文案，或设置是否与入群邮件一致。入群邮件也开着、且没单独写过退群文案时，打开会默认与入群一致"
                                badges={mailRowBadges(selectedMailCues, 'leave')}
                                checked={selected.features.mailLeave === true}
                                onChange={(v) => patchGroup(
                                    selected.group_id,
                                    { features: { mailLeave: v } },
                                    `退群邮件已${v ? '开启' : '关闭'}`
                                )}
                                onConfigure={() => setDrawer('mailLeave')}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
        {selected && (
            <>
                <Drawer
                    open={drawer === 'webhook'}
                    title="Webhook 通知"
                    description="本群开关只决定这个群收不收。下面是全局推送地址、密钥和话术。"
                    badge="失焦后保存"
                    onClose={closeDrawer}
                >
                    <div className="mb-4">
                        <InheritanceBanner
                            tone="global"
                            title="已采用全局配置"
                            detail="这个群没有单独的推送地址、密钥或话术。下面改的是全局 Webhook，所有开启了通知的群一起用。"
                        />
                    </div>
                    <div className="mb-4 rounded-lg border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
                        本群没有单独的推送地址。下面改的是全局 Webhook，会作用到每一个开启了通知的群。
                    </div>
                    <WebhookSettingsPanel />
                </Drawer>
                <Drawer
                    open={drawer === 'customApi'}
                    title="自定义 API"
                    description="本群开关只决定这个群会不会按规则响应。规则是全局的，改完请点「保存全部」。"
                    wide
                    onClose={closeDrawer}
                >
                    <div className="mb-4">
                        <InheritanceBanner
                            tone="global"
                            title="已采用全局配置"
                            detail="规则不按群各存一份。这个群只有开或关，下面改的是所有群共用的规则。"
                        />
                    </div>
                    <div className="mb-4 rounded-lg border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
                        规则不按群各存一份。可以在规则里选择发送到本群。关闭抽屉不会自动保存，请先点「保存全部」。
                    </div>
                    {drawer === 'customApi' && <CustomApiPage embedded />}
                </Drawer>
                <Drawer
                    open={drawer === 'mailJoin' || drawer === 'mailLeave'}
                    title={drawer === 'mailLeave' ? '退群邮件' : '入群邮件'}
                    description={drawer === 'mailLeave'
                        ? '只影响这个群的退群文案，以及是否与入群邮件一致。留空仍用全局退群文案。这里没有 SMTP。关闭前请先保存。'
                        : '只影响这个群的入群主题和正文。留空表示用全局入群文案，不会发空白邮件。这里没有 SMTP。关闭前请先保存。'}
                    onClose={closeDrawer}
                >
                    {(drawer === 'mailJoin' || drawer === 'mailLeave') && (
                        <GroupMailCopy
                            key={selected.group_id}
                            group={selected}
                            section={drawer === 'mailLeave' ? 'leave' : 'join'}
                            onOpenSection={(section) => setDrawer(section === 'leave' ? 'mailLeave' : 'mailJoin')}
                            onSave={(template, okMsg) => patchGroup(
                                selected.group_id,
                                { mailTemplate: template },
                                okMsg,
                            )}
                        />
                    )}
                </Drawer>
            </>
        )}
        </>
    )
}

/** 本群「与入群邮件一致」：跟随全局，或只对本群勾选 / 取消 */
type LeaveFollowMode = 'inherit' | 'yes' | 'no'

/**
 * 本群邮件文案
 * 入群、退群分两个抽屉。某一项留空表示用全局对应文案，保存空字符串不会发空白邮件
 * 「与入群邮件一致」不指定时跟随全局；指定后只影响这个群
 * 两个抽屉共用这一份草稿，保存时入群和退群一起写入，避免只存一边把另一边清掉
 */
function GroupMailCopy({ group, section, onOpenSection, onSave }: {
    group: GroupInfo
    section: 'join' | 'leave'
    onOpenSection?: (section: 'join' | 'leave') => void
    onSave: (template: {
        subject: string
        body: string
        leaveSubject: string
        leaveBody: string
        leaveFollowJoin: boolean | null
    }, okMsg: string) => void
}) {
    const initialMode = followModeOf(group.mailTemplate?.leaveFollowJoin)
    const [subject, setSubject] = useState(group.mailTemplate?.subject || '')
    const [body, setBody] = useState(group.mailTemplate?.body || '')
    const [leaveSubject, setLeaveSubject] = useState(group.mailTemplate?.leaveSubject || '')
    const [leaveBody, setLeaveBody] = useState(group.mailTemplate?.leaveBody || '')
    const [mode, setMode] = useState<LeaveFollowMode>(initialMode)

    useEffect(() => {
        setSubject(group.mailTemplate?.subject || '')
        setBody(group.mailTemplate?.body || '')
        setLeaveSubject(group.mailTemplate?.leaveSubject || '')
        setLeaveBody(group.mailTemplate?.leaveBody || '')
        setMode(followModeOf(group.mailTemplate?.leaveFollowJoin))
    }, [
        group.group_id,
        group.mailTemplate?.subject,
        group.mailTemplate?.body,
        group.mailTemplate?.leaveSubject,
        group.mailTemplate?.leaveBody,
        group.mailTemplate?.leaveFollowJoin,
    ])

    const globalFollow = group.globalLeaveFollowJoin === true
    // 勾选，或尚未指定且全局已勾选：退群主题和正文不参与发信，先藏起来
    const followsJoin = mode === 'yes' || (mode === 'inherit' && globalFollow)
    const usingGlobal = mode === 'inherit'
        && !subject.trim() && !body.trim()
        && !leaveSubject.trim() && !leaveBody.trim()
    const draftCues = mailInheritCues({
        subject,
        body,
        leaveSubject,
        leaveBody,
        leaveFollowJoin: mode === 'yes' ? true : mode === 'no' ? false : null,
        globalLeaveFollowJoin: globalFollow,
    })

    const payload = () => ({
        subject: subject.trim(),
        body: body.trim(),
        leaveSubject: leaveSubject.trim(),
        leaveBody: leaveBody.trim(),
        leaveFollowJoin: mode === 'yes' ? true : mode === 'no' ? false : null,
    })

    const followHint = mode === 'yes'
        ? '本群退群邮件使用本群入群主题和正文（留空的入群项仍用全局入群文案）。变量按退群事件替换，不会把退群写成入群。'
        : mode === 'no'
            ? '本群单独设置退群主题和正文。某一项留空则用全局退群文案，不会发空白邮件。'
            : globalFollow
                ? '尚未为本群单独指定。当前跟随全局：已勾选，退群使用入群文案，变量仍按退群事件替换。点击勾选框可只改本群。'
                : '尚未为本群单独指定。当前跟随全局：未勾选，退群使用单独文案。下面留空的项用全局退群文案。'

    return (
        <div className="space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">
                {section === 'join'
                    ? '只影响这个群的入群主题和正文。留空就用全局设置里入群邮件的对应文案，不会发出空白邮件。'
                    : '只影响这个群的退群文案，以及本群是否与入群邮件一致。留空就用全局退群文案，不会发出空白邮件。'}
                收件人仍然是成员自己的 QQ 邮箱（QQ号@qq.com）。
            </p>
            <MailInheritNotices cues={draftCues} section={section} />
            {onOpenSection && (
                <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => onOpenSection(section === 'join' ? 'leave' : 'join')}
                >
                    {section === 'join' ? '去配置退群文案' : '去配置入群文案'}
                </button>
            )}
            {section === 'join' && (
                <>
                    <label className="block">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">入群主题</div>
                        <div className="text-xs text-gray-400 mb-2">留空则使用全局入群主题</div>
                        <input
                            className="input-field"
                            placeholder="留空则使用全局入群主题"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                        />
                    </label>
                    <label className="block">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">入群正文</div>
                        <div className="text-xs text-gray-400 mb-2">留空则使用全局入群正文</div>
                        <textarea
                            className="input-field min-h-[140px] resize-y"
                            placeholder="留空则使用全局入群正文"
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                        />
                    </label>
                </>
            )}
            {section === 'leave' && (
                <>
                    <div className="rounded-lg border border-gray-100 dark:border-white/10 p-3 space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                            <SameAsJoinCheckbox mode={mode} onMode={setMode} />
                            <span>
                                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">与入群邮件一致</span>
                                <span className="block text-xs text-gray-400 mt-0.5">{followHint}</span>
                            </span>
                        </label>
                        {mode !== 'inherit' && (
                            <button type="button" className="btn btn-ghost text-xs" onClick={() => setMode('inherit')}>
                                这项改回跟随全局
                            </button>
                        )}
                    </div>
                    {followsJoin ? (
                        <p className="text-xs text-gray-400 leading-relaxed">
                            退群主题和正文现在不使用。取消勾选或改回跟随全局（且全局未勾选）后可以再单独写，已经填过的退群文字会保留。
                        </p>
                    ) : (
                        <>
                            <label className="block">
                                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">退群主题</div>
                                <div className="text-xs text-gray-400 mb-2">留空则使用全局退群主题</div>
                                <input
                                    className="input-field"
                                    placeholder="留空则使用全局退群主题"
                                    value={leaveSubject}
                                    onChange={(e) => setLeaveSubject(e.target.value)}
                                />
                            </label>
                            <label className="block">
                                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">退群正文</div>
                                <div className="text-xs text-gray-400 mb-2">留空则使用全局退群正文</div>
                                <textarea
                                    className="input-field min-h-[140px] resize-y"
                                    placeholder="留空则使用全局退群正文"
                                    value={leaveBody}
                                    onChange={(e) => setLeaveBody(e.target.value)}
                                />
                            </label>
                        </>
                    )}
                </>
            )}
            <MailVarsHint />
            <p className="text-xs text-gray-400 leading-relaxed">
                保存会把入群和退群的本群文案一起写入。清空会同时清掉两边的覆盖，并让「与入群邮件一致」改回跟随全局。
            </p>
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    className="btn btn-primary text-xs"
                    onClick={() => onSave(payload(), usingGlobal ? '已改回全局邮件文案' : '本群邮件文案已保存')}
                >
                    保存本群文案
                </button>
                <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    onClick={() => {
                        setSubject('')
                        setBody('')
                        setLeaveSubject('')
                        setLeaveBody('')
                        setMode('inherit')
                        onSave({
                            subject: '',
                            body: '',
                            leaveSubject: '',
                            leaveBody: '',
                            leaveFollowJoin: null,
                        }, '已改回全局邮件文案')
                    }}
                >
                    清空并使用全局文案
                </button>
            </div>
        </div>
    )
}

/** 当前筛选结果的全选。半选表示只勾了其中一部分，再点一次会把这些群都选上 */
function VisibleSelectAll({ ids, checked, filtered, onToggle }: {
    ids: number[]
    checked: Set<number>
    filtered: boolean
    onToggle: (selectAll: boolean) => void
}) {
    const ref = useRef<HTMLInputElement>(null)
    const selectedCount = ids.filter((id) => checked.has(id)).length
    const all = ids.length > 0 && selectedCount === ids.length
    const partial = selectedCount > 0 && !all
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = partial
    }, [partial])
    return (
        <label className={`sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-white px-3 py-2 dark:border-gray-800 dark:bg-[#1e1e20] ${ids.length === 0 ? 'opacity-50' : 'cursor-pointer'}`}>
            <input
                ref={ref}
                type="checkbox"
                className="rounded border-gray-300 dark:border-gray-600"
                checked={all}
                disabled={ids.length === 0}
                aria-label={all ? '取消全选' : '全选'}
                onChange={() => onToggle(!all)}
            />
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{all ? '取消全选' : '全选'}</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {filtered ? `当前筛选 ${ids.length} 个群` : '勾选后可批量操作'}
                {checked.size > 0 ? ` · 已选 ${checked.size}` : ''}
            </span>
        </label>
    )
}

function mailRowBadges(cues: MailInheritCues, kind: 'join' | 'leave') {
    const nodes: ReactElement[] = []
    if (kind === 'join' && cues.joinUsesGlobal) {
        nodes.push(<InheritanceBadge key="global" tone="global">已采用全局配置</InheritanceBadge>)
    }
    if (kind === 'leave' && cues.leaveUsesGlobal) {
        nodes.push(<InheritanceBadge key="global" tone="global">已采用全局配置</InheritanceBadge>)
    }
    if (kind === 'leave' && cues.leaveFollowsJoin) {
        nodes.push(<InheritanceBadge key="follow" tone="follow">与入群邮件一致</InheritanceBadge>)
    }
    if (kind === 'leave' && cues.showInheritChoice) {
        nodes.push(<InheritanceBadge key="choice" tone="choice">这项跟随全局</InheritanceBadge>)
    }
    if (nodes.length === 0) return null
    return <>{nodes}</>
}

/** 抽屉里的继承说明，和功能行上的标记用同一套判断 */
function MailInheritNotices({ cues, section }: { cues: MailInheritCues; section: 'join' | 'leave' }) {
    const items: { key: string; tone: 'global' | 'follow' | 'choice'; title: string; detail: string }[] = []
    if (section === 'join' && cues.joinUsesGlobal) {
        items.push({
            key: 'join-global',
            tone: 'global',
            title: '已采用全局配置',
            detail: '这个群没有写自己的入群主题和正文，发出去的是全局入群文案，不会是一封空白邮件。',
        })
    }
    if (section === 'leave' && cues.leaveFollowsJoin) {
        items.push({
            key: 'leave-follow',
            tone: 'follow',
            title: '与入群邮件一致',
            detail: '退群邮件使用解析后的入群主题和正文。变量仍按退群事件替换，不会把退群写成入群。',
        })
    }
    if (section === 'leave' && cues.leaveUsesGlobal) {
        items.push({
            key: 'leave-global',
            tone: 'global',
            title: '已采用全局配置',
            detail: cues.leaveFollowsJoin
                ? '入群主题和正文也没有本群覆盖，所以退群实际用的是全局入群文案。'
                : cues.leaveChoice === 'no'
                    ? '退群主题和正文没有本群覆盖，发信使用全局退群文案。本群已单独选择不与入群邮件一致。'
                    : '这个群没有单独写退群文案，也没有单独指定是否与入群一致，目前按全局配置发信。',
        })
    }
    if (section === 'leave' && cues.showInheritChoice) {
        items.push({
            key: 'leave-choice',
            tone: 'choice',
            title: '这项跟随全局',
            detail: cues.leaveFollowsJoin
                ? '「与入群邮件一致」没有单独指定，当前跟着全局勾选，所以退群使用入群文案。本群写过的入群文字仍然有效。'
                : '「与入群邮件一致」没有单独指定，当前跟着全局（未勾选）。下面的退群文字是这个群自己的。',
        })
    }
    if (items.length === 0) return null
    return (
        <div className="space-y-2">
            {items.map((item) => (
                <InheritanceBanner key={item.key} tone={item.tone} title={item.title} detail={item.detail} />
            ))}
        </div>
    )
}

function followModeOf(value: boolean | null | undefined): LeaveFollowMode {
    if (value === true) return 'yes'
    if (value === false) return 'no'
    return 'inherit'
}

/** 三态勾选：未指定时为半选，点击后变成只对本群生效 */
function SameAsJoinCheckbox({ mode, onMode }: {
    mode: LeaveFollowMode
    onMode: (mode: LeaveFollowMode) => void
}) {
    const ref = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = mode === 'inherit'
    }, [mode])
    return (
        <input
            ref={ref}
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#FB7299]"
            checked={mode === 'yes'}
            onChange={(e) => onMode(e.target.checked ? 'yes' : 'no')}
        />
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
