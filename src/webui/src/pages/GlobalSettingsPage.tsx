import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { PluginConfig } from '../types'
import { IconSettings } from '../components/icons'

/**
 * 全局设置页
 * 仅影响「尚未开启过」的群：它们在首次开机时会写入这里的功能初始值。
 * 已开启过的群不受此处修改影响。
 */
export default function GlobalSettingsPage() {
    const [config, setConfig] = useState<PluginConfig | null>(null)
    const [saving, setSaving] = useState(false)

    const fetchConfig = useCallback(async () => {
        try {
            const res = await noAuthFetch<PluginConfig>('/config')
            if (res.code === 0 && res.data) setConfig(res.data)
        } catch {
            showToast('获取配置失败', 'error')
        }
    }, [])

    useEffect(() => { fetchConfig() }, [fetchConfig])

    const saveFeatureDefaults = async (patch: Partial<PluginConfig['featureDefaults']>) => {
        if (!config) return
        setSaving(true)
        try {
            const featureDefaults = {
                ...config.featureDefaults,
                notify: config.featureDefaults?.notify !== false,
                customApi: config.featureDefaults?.customApi === true,
                ...patch,
            }
            const { webhookPath: _wp, ...payload } = { ...config, featureDefaults }
            await noAuthFetch('/config', {
                method: 'POST',
                body: JSON.stringify(payload),
            })
            setConfig({ ...config, featureDefaults })
            showToast('全局设置已保存', 'success')
        } catch {
            showToast('保存失败', 'error')
        } finally {
            setSaving(false)
        }
    }

    if (!config) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">加载全局设置中...</div>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="rounded-lg border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/80 dark:bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
                这里的设置只作为<strong>新群首次开机时的初始值</strong>。
                已经开启过的群不会被这里的修改影响；请到「群管理」里单独调整。
            </div>

            <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-5">
                    <IconSettings size={16} className="text-gray-400" />
                    功能初始开关
                </h3>
                <div className="space-y-5">
                    <ToggleRow
                        label="Webhook 通知推群"
                        desc="新群首次开机时，通知功能默认按此开关写入该群"
                        checked={config.featureDefaults?.notify !== false}
                        onChange={(v) => saveFeatureDefaults({ notify: v })}
                    />
                    <ToggleRow
                        label="自定义 API"
                        desc="新群首次开机时，自定义 API 默认按此开关写入该群"
                        checked={config.featureDefaults?.customApi === true}
                        onChange={(v) => saveFeatureDefaults({ customApi: v })}
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
        <div className="flex items-center justify-between gap-4">
            <div>
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
