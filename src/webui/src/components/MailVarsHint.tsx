/**
 * 入群 / 退群邮件文案可用变量
 * 邮件通知页和群管理里的覆盖框共用这一段说明
 */
const VARS: { token: string; desc: string }[] = [
    { token: '{{group_name}}', desc: '群名称' },
    { token: '{{group_id}}', desc: '群号' },
    { token: '{{member_name}}', desc: '成员名称（群名片，没有则用昵称）' },
    { token: '{{member_id}}', desc: '成员 QQ 号' },
    { token: '{{event_type}}', desc: '入群 或 退群' },
    { token: '{{event_title}}', desc: '入群通知 或 退群通知' },
    { token: '{{sub_type}}', desc: '子类型：邀请入群、管理员同意入群、主动退群、被移出群、机器人被移出群。没有对应子类型时为空' },
    { token: '{{event_detail}}', desc: '事件类型整句，例如「入群（邀请入群）」或「退群」' },
    { token: '{{time}}', desc: '事件时间（北京时间）' },
]

export default function MailVarsHint() {
    return (
        <div className="text-xs text-gray-400 leading-relaxed">
            <div className="mb-1">主题和正文里可以写这些变量。勾选「与入群邮件一致」时，退群仍替换这些变量，取值按退群事件来：</div>
            <ul className="space-y-0.5">
                {VARS.map((item) => (
                    <li key={item.token}>
                        <code className="text-[11px] text-gray-500 dark:text-gray-300">{item.token}</code>
                        <span> {item.desc}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
