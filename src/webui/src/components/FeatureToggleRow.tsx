interface FeatureToggleRowProps {
    label: string
    desc: string
    checked: boolean
    onChange: (v: boolean) => void
    /** 有配置项时提供。按钮紧挨在开关右侧，只打开抽屉，不改变开关 */
    onConfigure?: () => void
}

/**
 * 功能行：左侧说明，右侧是开关，开关后面是「配置」
 * 开机、授权这类没有独立配置的行不传 onConfigure
 */
export default function FeatureToggleRow({ label, desc, checked, onChange, onConfigure }: FeatureToggleRowProps) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <label className="toggle">
                    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
                    <div className="slider" />
                </label>
                {onConfigure && (
                    <button
                        type="button"
                        className="btn btn-ghost text-xs !px-2.5 !py-1.5"
                        aria-label={`配置${label}`}
                        onClick={onConfigure}
                    >
                        配置
                    </button>
                )}
            </div>
        </div>
    )
}
