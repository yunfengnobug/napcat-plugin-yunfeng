import type { ReactNode } from 'react'

/** 全局配置、跟随入群、勾选本身跟随全局，三种都要一眼能看出来 */
export type InheritTone = 'global' | 'follow' | 'choice'

const TONE_CLASS: Record<InheritTone, string> = {
    global: 'inherit-cue-global',
    follow: 'inherit-cue-follow',
    choice: 'inherit-cue-choice',
}

/** 功能行上的标记。字号和底色都比普通说明醒目 */
export function InheritanceBadge({ tone, children }: { tone: InheritTone; children: ReactNode }) {
    return <span className={`inherit-cue ${TONE_CLASS[tone]}`}>{children}</span>
}

/** 抽屉里的说明条，比功能行上的标记更大 */
export function InheritanceBanner({ tone, title, detail }: {
    tone: InheritTone
    title: string
    detail: string
}) {
    return (
        <div className={`inherit-banner ${TONE_CLASS[tone]}`}>
            <div className="inherit-banner-title">{title}</div>
            <p className="inherit-banner-detail">{detail}</p>
        </div>
    )
}

export interface MailInheritInput {
    subject?: string
    body?: string
    leaveSubject?: string
    leaveBody?: string
    /** null / 缺省：跟随全局勾选 */
    leaveFollowJoin?: boolean | null
    globalLeaveFollowJoin?: boolean
}

export interface MailInheritCues {
    joinUsesGlobal: boolean
    /** 退群这次实际用到的文字没有本群覆盖 */
    leaveUsesGlobal: boolean
    leaveFollowsJoin: boolean
    /**
     * 「与入群邮件一致」还没单独指定，但文案并不是整项都在用全局
     * 这种不能标成「已采用全局配置」，否则会把本群写过的文字说成全局
     */
    showInheritChoice: boolean
    leaveChoice: 'inherit' | 'yes' | 'no'
}

/** 根据本群覆盖判断该标「已采用全局配置」还是「与入群邮件一致」 */
export function mailInheritCues(input: MailInheritInput): MailInheritCues {
    const subject = (input.subject || '').trim()
    const body = (input.body || '').trim()
    const leaveSubject = (input.leaveSubject || '').trim()
    const leaveBody = (input.leaveBody || '').trim()
    const follow = input.leaveFollowJoin
    const leaveChoice: MailInheritCues['leaveChoice'] = follow === true ? 'yes' : follow === false ? 'no' : 'inherit'
    const leaveFollowsJoin = leaveChoice === 'yes' || (leaveChoice === 'inherit' && input.globalLeaveFollowJoin === true)
    const joinUsesGlobal = !subject && !body
    const leaveUsesGlobal = leaveFollowsJoin ? joinUsesGlobal : !leaveSubject && !leaveBody
    return {
        joinUsesGlobal,
        leaveUsesGlobal,
        leaveFollowsJoin,
        showInheritChoice: leaveChoice === 'inherit' && !leaveUsesGlobal,
        leaveChoice,
    }
}
