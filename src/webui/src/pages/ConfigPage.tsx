import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { PluginConfig } from '../types'
import { IconTerminal } from '../components/icons'

/**
 * Webhook 与基础参数的编辑状态
 * 只提交被改的那一个字段。抽屉和全局设置页会同时存在，整份配置写回去会盖掉另一边刚保存的内容
 */
function useEditableConfig() {
    const [config, setConfig] = useState<PluginConfig | null>(null)
    const [saving, setSaving] = useState(false)

    const fetchConfig = useCallback(async () => {
        try {
            const res = await noAuthFetch<PluginConfig>('/config')
            if (res.code === 0 && res.data) setConfig(res.data)
        } catch { showToast('获取配置失败', 'error') }
    }, [])

    useEffect(() => { fetchConfig() }, [fetchConfig])

    // 不用带泛型的箭头函数：tsx 会把 <K 当成标签
    function updateField<K extends keyof PluginConfig>(key: K, value: PluginConfig[K]) {
        setConfig((prev) => {
            if (!prev) return prev
            return { ...prev, [key]: value }
        })
        setSaving(true)
        void noAuthFetch('/config', {
            method: 'POST',
            body: JSON.stringify({ [key]: value }),
        }).then((res) => {
            if (res.code !== 0) {
                showToast(res.message || '保存失败', 'error')
                return
            }
            showToast('配置已保存', 'success')
        }).catch(() => {
            showToast('保存失败', 'error')
        }).finally(() => {
            setSaving(false)
        })
    }

    return { config, saving, updateField }
}

/**
 * Webhook 推送地址、密钥和话术
 * 全局设置、群管理里「Webhook 通知」开关后面的「配置」都打开这一份。地址不按群分开
 */
export function WebhookSettingsPanel() {
    const { config, saving, updateField } = useEditableConfig()

    const copyText = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            showToast('已复制', 'success')
        } catch {
            showToast('复制失败，请手动选择', 'warning')
        }
    }

    if (!config) {
        return (
            <div className="flex items-center justify-center h-40 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">加载配置中...</div>
                </div>
            </div>
        )
    }

    const webhookUrl = config.webhookPath
        ? `${window.location.origin}${config.webhookPath}`
        : ''

    return (
        <div className="space-y-5">
            <div>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">推送地址</div>
                <div className="text-xs text-gray-400 mb-2">
                    外部后台 POST 到此地址，无需传群号；插件会推送到所有「已授权 + 开机 + 开启通知」的群
                </div>
                <div className="flex gap-2">
                    <input className="input-field font-mono text-xs" readOnly value={webhookUrl} />
                    <button type="button" className="btn btn-ghost text-xs shrink-0" onClick={() => copyText(webhookUrl)}>复制</button>
                </div>
            </div>
            <InputRow
                label="Webhook 密钥"
                desc="首次启动会自动生成；请妥善保管，泄露后请立即更换"
                value={config.webhookSecret || ''}
                onChange={(v) => updateField('webhookSecret', v)}
            />
            <TextAreaRow
                label="通知话术模板"
                desc="body（除 secret）绑定为 res。文本用 {{res.字段}}；图片/视频/文件用 {{image:res.cover}} / {{video:res.demo}} / {{file:res.path}}（值为空则跳过该段）"
                value={config.notifyTemplate || ''}
                onChange={(v) => updateField('notifyTemplate', v)}
                rows={6}
            />
            <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3 text-xs text-gray-500 font-mono whitespace-pre-wrap leading-relaxed">
{`POST ${config.webhookPath || '/plugin/napcat-plugin-yunfeng/api/webhook/notify'}
Header: X-Webhook-Secret: <密钥>
Body: { "aaa": "标题", "bbb": "详情", "cover": "https://example.com/a.png" }

模板示例：
【{{res.aaa}}】
{{res.bbb}}
{{image:res.cover}}`}
            </div>
            {saving && <SavingIndicator />}
        </div>
    )
}

/**
 * 调试模式、命令前缀、冷却时间
 * 这三项不是某个群功能，留在全局设置页上，不放进功能抽屉
 */
export function BasicSettingsPanel() {
    const { config, saving, updateField } = useEditableConfig()

    if (!config) {
        return (
            <div className="flex items-center justify-center h-40 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">加载基础配置中...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-1">
                <IconTerminal size={16} className="text-gray-400" />
                基础配置
            </h3>
            <p className="text-xs text-gray-400 mb-5">调试模式、命令前缀和冷却时间对整个插件生效，不按群分开。</p>
            <div className="space-y-5">
                <ToggleRow
                    label="调试模式"
                    desc="启用后输出详细日志到控制台"
                    checked={config.debug}
                    onChange={(v) => updateField('debug', v)}
                />
                <InputRow
                    label="命令前缀"
                    desc="触发命令的前缀"
                    value={config.commandPrefix}
                    onChange={(v) => updateField('commandPrefix', v)}
                />
                <InputRow
                    label="冷却时间 (秒)"
                    desc="同一命令请求冷却时间，0 表示不限制"
                    value={String(config.cooldownSeconds)}
                    type="number"
                    onChange={(v) => updateField('cooldownSeconds', Number(v) || 0)}
                />
            </div>
            {saving && <SavingIndicator />}
        </div>
    )
}

function SavingIndicator() {
    return (
        <div className="saving-indicator fixed bottom-4 right-4 z-[60] bg-primary text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <div className="loading-spinner !w-3 !h-3 !border-[1.5px]" />
            保存中...
        </div>
    )
}

function ToggleRow({ label, desc, checked, onChange }: {
    label: string; desc: string; checked: boolean; onChange: (v: boolean) => void
}) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
            </div>
            <label className="toggle">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
                <div className="slider" />
            </label>
        </div>
    )
}

function InputRow({ label, desc, value, type = 'text', onChange }: {
    label: string; desc: string; value: string; type?: string; onChange: (v: string) => void
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
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
            />
        </div>
    )
}

/** 多行文本配置（失焦保存） */
function TextAreaRow({ label, desc, value, onChange, rows = 4 }: {
    label: string; desc: string; value: string; onChange: (v: string) => void; rows?: number
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
                className="input-field font-mono text-xs leading-relaxed min-h-[7rem]"
                rows={rows}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={handleBlur}
            />
        </div>
    )
}
