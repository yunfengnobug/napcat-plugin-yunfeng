/**
 * Webhook 通知模板渲染
 * - 普通变量：{{res.xxx}} / {{res.aa.b}}
 * - 媒体标记：{{image:res.cover}} / {{video:res.demo}} / {{file:res.path}}
 * 渲染结果为 OneBot 消息段数组，供 send_msg 使用
 */

/** 文本 / 图片 / 视频 / 文件消息段 */
export type NotifyMessageSegment =
    | { type: 'text'; data: { text: string } }
    | { type: 'image'; data: { file: string } }
    | { type: 'video'; data: { file: string } }
    | { type: 'file'; data: { file: string } };

/** 占位符：可选 image|video|file 前缀 + 变量路径 */
const PLACEHOLDER_RE = /\{\{\s*(?:(image|video|file):)?([\w.]+)\s*\}\}/g;

/** 按点路径从对象取值 */
function getByPath(root: unknown, path: string): unknown {
    if (!path) return root;
    const parts = path.split('.').filter(Boolean);
    let cur: unknown = root;
    for (const p of parts) {
        if (cur == null) return undefined;
        if (Array.isArray(cur)) {
            const idx = Number(p);
            if (!Number.isInteger(idx)) return undefined;
            cur = cur[idx];
            continue;
        }
        if (typeof cur === 'object') {
            cur = (cur as Record<string, unknown>)[p];
            continue;
        }
        return undefined;
    }
    return cur;
}

/** 将任意值转为模板文本 */
function valueToText(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

/**
 * 解析 {{res}} / {{res.a.b}} 对应的值
 * 仅支持以 res 为根的路径
 */
function resolveResValue(res: unknown, key: string): unknown {
    if (key === 'res') return res;
    if (key.startsWith('res.')) return getByPath(res, key.slice(4));
    return undefined;
}

/** 媒体 file 字段：须为非空字符串 */
function resolveMediaFile(res: unknown, key: string): string {
    const v = resolveResValue(res, key);
    if (typeof v !== 'string') return '';
    return v.trim();
}

/**
 * 用 Webhook body（已去掉 secret）渲染通知模板
 * @returns 消息段；若无可发送内容则 segments 为空
 */
export function renderNotifyTemplate(
    template: string,
    res: unknown,
): { segments: NotifyMessageSegment[]; textPreview: string } {
    const src = template || '';
    const segments: NotifyMessageSegment[] = [];
    let textBuf = '';

    const flushText = () => {
        if (!textBuf) return;
        // 去掉纯空白段落，避免媒体前后多余空段；保留有意义的换行文本
        if (textBuf.trim()) {
            segments.push({ type: 'text', data: { text: textBuf } });
        }
        textBuf = '';
    };

    let lastIndex = 0;
    PLACEHOLDER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_RE.exec(src)) !== null) {
        textBuf += src.slice(lastIndex, m.index);
        lastIndex = m.index + m[0].length;

        const mediaType = m[1] as 'image' | 'video' | 'file' | undefined;
        const key = m[2];

        if (mediaType) {
            const file = resolveMediaFile(res, key);
            if (!file) {
                // 媒体值为空：跳过该标记，不插入空段
                continue;
            }
            flushText();
            segments.push({ type: mediaType, data: { file } });
            continue;
        }

        textBuf += valueToText(resolveResValue(res, key));
    }
    textBuf += src.slice(lastIndex);
    flushText();

    const textPreview = segments
        .map((seg) => {
            if (seg.type === 'text') return seg.data.text;
            return `[${seg.type}:${seg.data.file}]`;
        })
        .join('');

    return { segments, textPreview };
}

/**
 * 从 Webhook body 提取绑定到模板的 res（排除 secret）
 */
export function extractNotifyRes(body: Record<string, unknown>): Record<string, unknown> {
    const res: Record<string, unknown> = { ...body };
    delete res.secret;
    return res;
}
