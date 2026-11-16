import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './icons'

interface DrawerProps {
    open: boolean
    title: string
    /** 标题下的一行说明 */
    description?: string
    onClose: () => void
    /** 自定义 API 这类大表单用宽抽屉 */
    wide?: boolean
    /** 标题栏右侧的短标记，例如「失焦后保存」 */
    badge?: string
    children: React.ReactNode
}

/**
 * 从右侧滑出的配置抽屉
 * 挂到 document.body，避免被页面滚动容器或入场动画的 transform 裁切
 * 关闭前先让当前输入框失焦，这样「失焦即保存」的字段能在卸载前把值发出去
 */
export default function Drawer({ open, title, description, onClose, wide, badge, children }: DrawerProps) {
    const requestClose = useCallback(() => {
        const el = document.activeElement
        if (el instanceof HTMLElement) el.blur()
        onClose()
    }, [onClose])

    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') requestClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [open, requestClose])

    if (!open) return null

    return createPortal(
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="drawer-backdrop absolute inset-0 bg-black/40" onClick={requestClose} />
            <aside
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`drawer-panel relative flex h-full w-full flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-[#1a1b1d] ${wide ? 'max-w-[1400px]' : 'max-w-2xl'}`}
            >
                <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
                        {description && (
                            <p className="mt-1 text-xs leading-relaxed text-gray-400">{description}</p>
                        )}
                    </div>
                    {badge && (
                        <span className="shrink-0 rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            {badge}
                        </span>
                    )}
                    <button
                        type="button"
                        className="btn btn-ghost !p-1.5 shrink-0"
                        aria-label="关闭抽屉"
                        onClick={requestClose}
                    >
                        <IconX size={16} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                    {children}
                </div>
            </aside>
        </div>,
        document.body,
    )
}
