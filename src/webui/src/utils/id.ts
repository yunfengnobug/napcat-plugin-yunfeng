/**
 * 生成短随机 ID（WebUI 用）
 * NapCat 插件页常非 Secure Context，crypto.randomUUID 可能不可用
 */
export function randomId(length = 16): string {
    const size = Math.max(1, Math.floor(length))
    const bytes = new Uint8Array(Math.ceil(size / 2))

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes)
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256)
        }
    }

    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, size)
}
