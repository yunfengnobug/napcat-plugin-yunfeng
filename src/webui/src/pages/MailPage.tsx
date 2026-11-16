import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { MailEncryption, MailSettings, PluginConfig } from '../types'
import { IconMail } from '../components/icons'
import MailVarsHint from '../components/MailVarsHint'

/** 与 src/services/mail-template.ts 的默认文案保持一致。服务器没带回主题时用它补上 */
const DEFAULT_MAIL_SUBJECT = '【{{event_title}}】{{group_name}}'
const DEFAULT_MAIL_BODY = [
    '事件类型：{{event_detail}}',
    '群名称：{{group_name}}',
    '群号：{{group_id}}',
    '成员名称：{{member_name}}',
    '成员QQ：{{member_id}}',
    '时间：{{time}}',
].join('\n')

/** 三种加密方式对应的常用端口。只有端口还停在上一种默认值时才跟着改 */
const DEFAULT_PORT: Record<MailEncryption, number> = {
    ssl: 465,
    starttls: 587,
    none: 25,
}

const EMPTY_MAIL: MailSettings = {
    host: '',
    port: 465,
    encryption: 'ssl',
    username: '',
    password: '',
    from: '',
    fromName: '',
    subject: DEFAULT_MAIL_SUBJECT,
    body: DEFAULT_MAIL_BODY,
}

/**
 * 发信配置页
 * 这里只保存 SMTP 和发件人。入群 / 退群的收件人是成员自己的 QQ 邮箱，不在这里填写。
 */
export default function MailPage() {
    const [mail, setMail] = useState<MailSettings | null>(null)
    const [passwordSet, setPasswordSet] = useState(false)
    const [saving, setSaving] = useState(false)
    const [testTo, setTestTo] = useState('')
    const [testing, setTesting] = useState(false)

    const fetchConfig = useCallback(async () => {
        try {
            const res = await noAuthFetch<PluginConfig>('/config')
            if (res.code === 0 && res.data) {
                setMail({ ...EMPTY_MAIL, ...res.data.mail, password: '' })
                setPasswordSet(res.data.mailPasswordSet === true)
            }
        } catch {
            showToast('获取发信配置失败', 'error')
        }
    }, [])

    useEffect(() => { fetchConfig() }, [fetchConfig])

    const saveMail = useCallback(async (next: MailSettings, options?: { clearPassword?: boolean }) => {
        // 主题或正文被清空时恢复初始文案，避免保存成空白邮件
        const payload: MailSettings = {
            ...next,
            from: next.from.trim(),
            fromName: next.fromName.trim(),
            subject: next.subject.trim() || DEFAULT_MAIL_SUBJECT,
            body: next.body.trim() || DEFAULT_MAIL_BODY,
        }
        setSaving(true)
        try {
            const res = await noAuthFetch('/config', {
                method: 'POST',
                body: JSON.stringify({
                    mail: payload,
                    clearMailPassword: options?.clearPassword === true,
                }),
            })
            if (res.code !== 0) {
                showToast(res.message || '保存失败', 'error')
                return
            }
            if (options?.clearPassword) {
                setPasswordSet(false)
                setMail({ ...payload, password: '' })
            } else if (payload.password) {
                setPasswordSet(true)
                setMail({ ...payload, password: '' })
            } else {
                setMail({ ...payload, password: '' })
            }
            showToast(options?.clearPassword ? '密码已清除' : '发信配置已保存', 'success')
        } catch {
            showToast('保存失败', 'error')
        } finally {
            setSaving(false)
        }
    }, [])

    const updateMail = (patch: Partial<MailSettings>) => {
        if (!mail) return
        const next = { ...mail, ...patch, password: patch.password ?? '' }
        setMail(next)
        void saveMail(next)
    }

    const changeEncryption = (encryption: MailEncryption) => {
        if (!mail) return
        const port = mail.port === DEFAULT_PORT[mail.encryption] ? DEFAULT_PORT[encryption] : mail.port
        updateMail({ encryption, port })
    }

    const sendTest = async () => {
        const to = testTo.trim()
        if (!to) {
            showToast('请填写测试收件人', 'warning')
            return
        }
        setTesting(true)
        try {
            const res = await noAuthFetch<{ to: string }>('/mail/test', {
                method: 'POST',
                body: JSON.stringify({ to }),
            })
            if (res.code !== 0) {
                showToast(res.message || '测试邮件发送失败', 'error')
                return
            }
            showToast(`测试邮件已发送到 ${res.data?.to || to}`, 'success')
        } catch {
            showToast('测试邮件发送失败', 'error')
        } finally {
            setTesting(false)
        }
    }

    if (!mail) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">加载发信配置中...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-2xl stagger-children">
            <div className="rounded-lg border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
                入群和退群邮件<strong>发给发生变动的成员本人</strong>，地址是该成员的 QQ 邮箱（QQ号@qq.com）。
                这里没有固定收件人。成员没有可用 QQ 号时会跳过并写入日志。
                群里还要分别打开「入群邮件」「退群邮件」，并且该群已授权、已开机。发信失败只记日志，不会让插件停掉。
                发件人名称是对方看到的名字，发件人地址才是这只邮箱；两者都不是入群或退群的收件人。
            </div>

            <div className="card p-5 hover-lift">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-5">
                    <IconMail size={16} className="text-gray-400" />
                    SMTP 发信
                </h3>
                <div className="space-y-5">
                    <InputRow
                        label="SMTP 主机"
                        desc="例如 smtp.qq.com。不要把端口写在主机里"
                        value={mail.host}
                        onChange={(v) => updateMail({ host: v })}
                    />
                    <div>
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">加密方式</div>
                        <div className="text-xs text-gray-400 mb-2">
                            SSL / TLS 常用 465，STARTTLS 常用 587，不加密常用 25。切换时如果端口还是默认值，会一起改掉
                        </div>
                        <select
                            className="input-field"
                            value={mail.encryption}
                            onChange={(e) => changeEncryption(e.target.value as MailEncryption)}
                        >
                            <option value="ssl">SSL / TLS</option>
                            <option value="starttls">STARTTLS</option>
                            <option value="none">不加密</option>
                        </select>
                    </div>
                    <InputRow
                        label="端口"
                        desc="1 到 65535"
                        value={String(mail.port)}
                        type="number"
                        onChange={(v) => updateMail({ port: normalizePort(v, mail.port) })}
                    />
                    <InputRow
                        label="认证用户名"
                        desc="需要登录的服务器再填。QQ 邮箱一般就是发件邮箱。和密码都留空则不认证"
                        value={mail.username}
                        onChange={(v) => updateMail({ username: v })}
                    />
                    <InputRow
                        label="密码 / 授权码"
                        desc={passwordSet
                            ? '已经保存过密码。留空表示不修改；QQ 邮箱请填授权码，不要填 QQ 登录密码'
                            : '密码只保存在插件配置文件里，不会写进仓库。QQ 邮箱请填授权码'}
                        value={mail.password}
                        type="password"
                        placeholder={passwordSet ? '已保存，留空则不修改' : ''}
                        onChange={(v) => updateMail({ password: v })}
                    />
                    {passwordSet && (
                        <div>
                            <button
                                className="btn btn-ghost text-xs"
                                onClick={() => saveMail({ ...mail, password: '' }, { clearPassword: true })}
                            >
                                清除已保存的密码
                            </button>
                        </div>
                    )}
                    <InputRow
                        label="发件人名称"
                        desc="收件人在邮箱里看到的名字，例如「云枫」。留空则只发送下面的邮箱地址，有些邮箱会改成显示 @ 前面的一段。这不是入群或退群邮件的收件人"
                        value={mail.fromName}
                        placeholder="例如 云枫"
                        onChange={(v) => updateMail({ fromName: v })}
                    />
                    <InputRow
                        label="发件人地址"
                        desc="实际发信的邮箱，例如 1245654743@qq.com。只填地址，不要写成「名称 <邮箱>」。这不是入群或退群邮件的收件人，那些信仍然发给成员自己的 QQ 邮箱（QQ号@qq.com）"
                        value={mail.from}
                        placeholder="1245654743@qq.com"
                        onChange={(v) => updateMail({ from: v })}
                    />
                </div>
            </div>

            <div className="card p-5 hover-lift">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">邮件文案</h3>
                <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                    这是所有群的默认主题和正文。某个群在「群管理」里另写了主题或正文时，用该群的；留空的那一项仍用这里的全局文案。
                    把主题或正文清空后再保存，会恢复成最初那套文案，不会发出空白邮件。
                    未改过的默认主题里，群名最多显示 40 个字；主题一旦改成自己的文字，{'{{group_name}}'} 就是完整群名。
                </p>
                <div className="space-y-5">
                    <InputRow
                        label="主题"
                        desc="入群和退群共用这一条。入群、退群的差别用变量区分"
                        value={mail.subject}
                        onChange={(v) => updateMail({ subject: v })}
                    />
                    <TextAreaRow
                        label="正文"
                        desc="纯文本。换行会保留"
                        value={mail.body}
                        onChange={(v) => updateMail({ body: v })}
                    />
                    <MailVarsHint />
                </div>
            </div>

            <div className="card p-5 hover-lift">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">发送测试邮件</h3>
                <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                    测试收件人只用于这一次试发，不会被保存，也不会变成入群或退群通知的收件人。
                    那些通知仍然发给成员自己的 QQ 邮箱（QQ号@qq.com）。
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        className="input-field"
                        placeholder="you@example.com"
                        value={testTo}
                        onChange={(e) => setTestTo(e.target.value)}
                    />
                    <button className="btn btn-primary text-xs shrink-0" disabled={testing} onClick={sendTest}>
                        {testing ? '发送中...' : '发送测试邮件'}
                    </button>
                </div>
            </div>

            {saving && (
                <div className="saving-indicator fixed bottom-4 right-4 bg-primary text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
                    <div className="loading-spinner !w-3 !h-3 !border-[1.5px]" />
                    保存中...
                </div>
            )}
        </div>
    )
}

function normalizePort(value: string, current: number): number {
    const port = Number(value)
    if (!Number.isFinite(port)) return current
    const rounded = Math.floor(port)
    if (rounded < 1 || rounded > 65535) return current
    return rounded
}

function TextAreaRow({ label, desc, value, onChange }: {
    label: string
    desc: string
    value: string
    onChange: (v: string) => void
}) {
    const [local, setLocal] = useState(value)
    useEffect(() => { setLocal(value) }, [value])

    const handleBlur = () => {
        if (local !== value) onChange(local)
    }

    return (
        <div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">{label}</div>
            <div className="text-xs text-gray-400 mb-2">{desc}</div>
            <textarea
                className="input-field min-h-[160px] resize-y"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={handleBlur}
            />
        </div>
    )
}

function InputRow({ label, desc, value, type = 'text', placeholder, onChange }: {
    label: string
    desc: string
    value: string
    type?: string
    placeholder?: string
    onChange: (v: string) => void
}) {
    const [local, setLocal] = useState(value)
    useEffect(() => { setLocal(value) }, [value])

    const handleBlur = () => {
        if (local !== value) onChange(local)
    }

    return (
        <div>
            <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">{label}</div>
            <div className="text-xs text-gray-400 mb-2">{desc}</div>
            <input
                className="input-field"
                type={type}
                placeholder={placeholder}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
            />
        </div>
    )
}
