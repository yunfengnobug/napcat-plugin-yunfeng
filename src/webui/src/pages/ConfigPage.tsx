import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { PluginConfig } from '../types'
import { IconTerminal } from '../components/icons'

/** 插件基础配置（Webhook 密钥、开关等；功能全局初始值在「全局设置」页） */
export default function ConfigPage() {
    const [config, setConfig] = useState<PluginConfig | null>(null)
    const [saving, setSaving] = useState(false)

    const fetchConfig = useCallback(async () => {
        try {
            const res = await noAuthFetch<PluginConfig>('/config')
            if (res.code === 0 && res.data) setConfig(res.data)
        } catch { showToast('获取配置失败', 'error') }
    }, [])

    useEffect(() => { fetchConfig() }, [fetchConfig])

    const saveConfig = useCallback(async (update: Partial<PluginConfig>) => {
        if (!config) return
        setSaving(true)
        try {
            const newConfig = { ...config, ...update }
            const { webhookPath: _wp, ...payload } = newConfig
            await noAuthFetch('/config', {
                method: 'POST',
                body: JSON.stringify(payload),
            })
            setConfig(newConfig)
            showToast('配置已保存', 'success')
        } catch {
            showToast('保存失败', 'error')
        } finally {
            setSaving(false)
        }
    }, [config])

    const updateField = <K extends keyof PluginConfig>(key: K, value: PluginConfig[K]) => {
        if (!config) return
        const updated = { ...config, [key]: value }
        setConfig(updated)
        saveConfig({ [key]: value })
    }

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
            <div className="flex items-center justify-center h-64 empty-state">
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
        <div className="space-y-6 stagger-children">
            {/* Webhook */}
            <div className="card p-5 hover-lift">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-5">
                    <IconTerminal size={16} className="text-gray-400" />
                    Webhook 通知
                </h3>
                <div className="space-y-5">
                    <div>
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">推送地址</div>
                        <div className="text-xs text-gray-400 mb-2">
                            外部后台 POST 到此地址，无需传群号；插件会推送到所有「已授权 + 开机 + 开启通知」的群
                        </div>
                        <div className="flex gap-2">
                            <input className="input-field font-mono text-xs" readOnly value={webhookUrl} />
                            <button className="btn btn-ghost text-xs shrink-0" onClick={() => copyText(webhookUrl)}>复制</button>
                        </div>
                    </div>
                    <InputRow
                        label="Webhook 密钥"
                        desc="首次启动会自动生成；请妥善保管，泄露后请立即更换"
                        value={config.webhookSecret || ''}
                        onChange={(v) => updateField('webhookSecret', v)}
                    />
                    <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3 text-xs text-gray-500 font-mono whitespace-pre-wrap leading-relaxed">
{`POST ${config.webhookPath || '/plugin/napcat-plugin-yunfeng/api/webhook/notify'}
Header: X-Webhook-Secret: <密钥>
Body: { "title": "标题", "content": "详情", "url": "链接" }`}
                    </div>
                </div>
            </div>

            {/* 基础配置 */}
            <div className="card p-5 hover-lift">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-5">
                    <IconTerminal size={16} className="text-gray-400" />
                    基础配置
                </h3>
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
