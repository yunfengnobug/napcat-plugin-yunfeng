import { useState, useEffect, useCallback } from 'react'
import { noAuthFetch } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { PluginConfig } from '../types'
import { IconSettings } from '../components/icons'
import Drawer from '../components/Drawer'
import FeatureToggleRow from '../components/FeatureToggleRow'
import { InheritanceBadge } from '../components/InheritanceCue'
import { BasicSettingsPanel, WebhookSettingsPanel } from './ConfigPage'
import CustomApiPage from './CustomApiPage'
import MailSettingsPanel, { type MailConfigSection } from './MailPage'

type SettingsDrawer = 'webhook' | 'customApi' | 'mailJoin' | 'mailLeave'

/**
 * 全局设置页
 * 开关只影响「尚未开启过」的群：它们在首次开机时会写入这里的功能初始值。
 * 已开启过的群不受开关影响。具体参数在开关后面的「配置」抽屉里，不单独占侧栏。
 */
export default function GlobalSettingsPage() {
    const [config, setConfig] = useState<PluginConfig | null>(null)
    const [saving, setSaving] = useState(false)
    const [drawer, setDrawer] = useState<SettingsDrawer | null>(null)
    const [mailReloadKey, setMailReloadKey] = useState(0)
    const closeDrawer = useCallback(() => setDrawer(null), [])

    const fetchConfig = useCallback(async () => {
        try {
            const res = await noAuthFetch<PluginConfig>('/config')
            if (res.code === 0 && res.data) setConfig(res.data)
        } catch {
            showToast('获取配置失败', 'error')
        }
    }, [])

    useEffect(() => { fetchConfig() }, [fetchConfig])

    // 只提交功能初始值。抽屉里的邮件、Webhook 会各自保存，这里带上整份配置会把它们盖掉
    const saveFeatureDefaults = async (patch: Partial<PluginConfig['featureDefaults']>) => {
        if (!config) return
        setSaving(true)
        try {
            const featureDefaults = {
                notify: config.featureDefaults?.notify !== false,
                customApi: config.featureDefaults?.customApi === true,
                mailJoin: config.featureDefaults?.mailJoin === true,
                mailLeave: config.featureDefaults?.mailLeave === true,
                ...patch,
            }
            const res = await noAuthFetch('/config', {
                method: 'POST',
                body: JSON.stringify({ featureDefaults }),
            })
            if (res.code !== 0) {
                showToast(res.message || '保存失败', 'error')
                return
            }
            const again = await noAuthFetch<PluginConfig>('/config')
            if (again.code === 0 && again.data) setConfig(again.data)
            else setConfig({ ...config, featureDefaults })
            setMailReloadKey((n) => n + 1)
            showToast('全局设置已保存', 'success')
        } catch {
            showToast('保存失败', 'error')
        } finally {
            setSaving(false)
        }
    }

    const mailSection: MailConfigSection = drawer === 'mailLeave' ? 'leave' : 'join'
    const openMailSection = (section: MailConfigSection) => {
        setDrawer(section === 'leave' ? 'mailLeave' : 'mailJoin')
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
                开关只作为<strong>新群首次开机时的初始值</strong>。
                已经开启过的群不会被开关的修改影响；请到「群管理」里单独调整。
                推送地址、规则、SMTP 和文案在开关后面的「配置」里，改的是当前这套参数，不是初始值。
            </div>

            <div className="card p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-5">
                    <IconSettings size={16} className="text-gray-400" />
                    功能初始开关
                </h3>
                <div className="space-y-5">
                    <FeatureToggleRow
                        label="Webhook 通知推群"
                        desc="开关是新群首次开机的初始值。推送地址、密钥和话术点右侧「配置」，所有开启通知的群共用"
                        checked={config.featureDefaults?.notify !== false}
                        onChange={(v) => saveFeatureDefaults({ notify: v })}
                        onConfigure={() => setDrawer('webhook')}
                    />
                    <FeatureToggleRow
                        label="自定义 API"
                        desc="开关是新群首次开机的初始值。触发规则点右侧「配置」，已开启该功能的群才会响应"
                        checked={config.featureDefaults?.customApi === true}
                        onChange={(v) => saveFeatureDefaults({ customApi: v })}
                        onConfigure={() => setDrawer('customApi')}
                    />
                    <FeatureToggleRow
                        label="入群邮件"
                        desc="开关是新群首次开机的初始值。SMTP、发件人、测试邮件和入群文案点右侧「配置」"
                        checked={config.featureDefaults?.mailJoin === true}
                        onChange={(v) => saveFeatureDefaults({ mailJoin: v })}
                        onConfigure={() => setDrawer('mailJoin')}
                    />
                    <FeatureToggleRow
                        label="退群邮件"
                        desc="开关是新群首次开机的初始值。打开时，若入群邮件也开着、退群文案仍是最初那套且没有手动取消过「与入群邮件一致」，会默认勾上。文案点右侧「配置」"
                        badges={config.mail?.leaveFollowJoin === true
                            ? <InheritanceBadge tone="follow">与入群邮件一致</InheritanceBadge>
                            : undefined}
                        checked={config.featureDefaults?.mailLeave === true}
                        onChange={(v) => saveFeatureDefaults({ mailLeave: v })}
                        onConfigure={() => setDrawer('mailLeave')}
                    />
                </div>
            </div>

            <BasicSettingsPanel />

            <Drawer
                open={drawer === 'webhook'}
                title="Webhook 通知"
                description="推送地址、密钥和话术是全局的，所有开启了通知的群共用。开关本身只决定新群首次开机时开不开通知。"
                badge="失焦后保存"
                onClose={closeDrawer}
            >
                <WebhookSettingsPanel />
            </Drawer>

            <Drawer
                open={drawer === 'customApi'}
                title="自定义 API"
                description="规则是全局的。群里的开关只决定该群是否响应。改完请点规则里的「保存全部」，关闭抽屉不会自动保存规则。"
                wide
                onClose={closeDrawer}
            >
                {drawer === 'customApi' && <CustomApiPage embedded />}
            </Drawer>

            <Drawer
                open={drawer === 'mailJoin' || drawer === 'mailLeave'}
                title={drawer === 'mailLeave' ? '退群邮件' : '入群邮件'}
                description={drawer === 'mailLeave'
                    ? '退群主题、正文，以及是否与入群邮件一致。SMTP 和发件人只在入群邮件的配置里，这里不会再放一套。'
                    : 'SMTP、发件人、测试邮件和入群文案。密码留空表示不修改已保存的密码。退群文案在退群邮件的配置里。'}
                badge="失焦后保存"
                onClose={closeDrawer}
            >
                {(drawer === 'mailJoin' || drawer === 'mailLeave') && (
                    <MailSettingsPanel section={mailSection} onOpenSection={openMailSection} reloadKey={mailReloadKey} />
                )}
            </Drawer>

            {saving && (
                <div className="saving-indicator fixed bottom-4 right-4 z-[60] bg-primary text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
                    <div className="loading-spinner !w-3 !h-3 !border-[1.5px]" />
                    保存中...
                </div>
            )}
        </div>
    )
}
