/**
 * 最小 SMTP 客户端
 * 用 Node 自带 net / tls 发信，避免再打包第三方邮件库。
 * 支持隐式 TLS（SSL）、STARTTLS 和明文。认证优先 AUTH LOGIN，不被支持时再试 AUTH PLAIN。
 */

import net from 'node:net';
import tls from 'node:tls';
import type { MailEncryption } from '../types';

/** 单次发信超时（毫秒） */
const SMTP_TIMEOUT_MS = 20000;

export interface SmtpSendRequest {
    host: string;
    port: number;
    encryption: MailEncryption;
    username: string;
    password: string;
    /** 已解析的发件人地址，不含显示名 */
    fromAddress: string;
    /** From 头，可以带编码后的显示名 */
    fromHeader: string;
    to: string;
    subject: string;
    text: string;
}

interface SmtpReply {
    code: number;
    text: string;
}

interface Waiter {
    resolve: (reply: SmtpReply) => void;
    reject: (error: Error) => void;
}

/**
 * 一条 SMTP 连接上的应答读取
 * 多行应答以「三位数字 + 空格」那一行作为结束
 */
class SmtpSession {
    private buffer = '';
    private waiters: Waiter[] = [];
    private failed = false;
    private socket: net.Socket;

    constructor(socket: net.Socket) {
        this.socket = socket;
        socket.on('data', (chunk: Buffer | string) => {
            this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            if (this.buffer.length > 256 * 1024) {
                this.fail(new Error('SMTP 响应过长'));
                this.socket.destroy();
                return;
            }
            this.drain();
        });
        socket.on('error', (error: Error) => {
            this.fail(error instanceof Error ? error : new Error(String(error)));
        });
        socket.on('close', () => {
            if (!this.failed && this.waiters.length > 0) {
                this.fail(new Error('SMTP 连接已关闭'));
            }
        });
    }

    /** STARTTLS 前卸掉监听，避免明文 socket 把 TLS 数据吃掉 */
    detach(): void {
        this.socket.removeAllListeners('data');
        this.socket.removeAllListeners('error');
        this.socket.removeAllListeners('close');
        this.socket.removeAllListeners('timeout');
    }

    read(): Promise<SmtpReply> {
        return new Promise((resolve, reject) => {
            const waiter: Waiter = {
                resolve: (reply) => {
                    clearTimeout(timer);
                    resolve(reply);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            };
            const timer = setTimeout(() => {
                this.removeWaiter(waiter);
                reject(new Error('SMTP 响应超时'));
            }, SMTP_TIMEOUT_MS);
            this.waiters.push(waiter);
            this.drain();
        });
    }

    async command(line: string, okCodes: number[]): Promise<SmtpReply> {
        if (/[\r\n]/.test(line)) {
            throw new Error('SMTP 命令含有换行');
        }
        this.socket.write(`${line}\r\n`);
        const reply = await this.read();
        if (!okCodes.includes(reply.code)) {
            throw new Error(shortSmtpError(reply));
        }
        return reply;
    }

    writeData(payload: string): void {
        this.socket.write(payload);
    }

    private drain(): void {
        while (this.waiters.length > 0) {
            const end = findReplyEnd(this.buffer);
            if (end < 0) return;
            const raw = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end);
            const lines = raw.split(/\r?\n/).map((line) => line.replace(/\r$/, '')).filter((line) => line.length > 0);
            const last = lines[lines.length - 1] || '';
            const code = Number(last.slice(0, 3));
            const waiter = this.waiters.shift();
            if (!waiter) return;
            if (!Number.isFinite(code)) {
                waiter.reject(new Error('SMTP 应答无法解析'));
                continue;
            }
            waiter.resolve({ code, text: lines.join(' ').slice(0, 500) });
        }
    }

    private removeWaiter(waiter: Waiter): void {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
    }

    private fail(error: Error): void {
        if (this.failed) return;
        this.failed = true;
        const pending = this.waiters;
        this.waiters = [];
        for (const waiter of pending) waiter.reject(error);
    }
}

function findReplyEnd(buffer: string): number {
    let start = 0;
    while (start < buffer.length) {
        const newline = buffer.indexOf('\n', start);
        if (newline < 0) return -1;
        const line = buffer.slice(start, newline).replace(/\r$/, '');
        if (/^\d{3} /.test(line)) return newline + 1;
        start = newline + 1;
    }
    return -1;
}

function shortSmtpError(reply: SmtpReply): string {
    return `SMTP ${reply.code} ${reply.text}`.replace(/\s+/g, ' ').slice(0, 300);
}

function openSocket(host: string, port: number, secure: boolean): net.Socket {
    const socket = secure
        ? tls.connect({ host, port, servername: host })
        : net.connect({ host, port });
    socket.setTimeout(SMTP_TIMEOUT_MS, () => {
        socket.destroy(new Error('SMTP 连接超时'));
    });
    socket.setNoDelay(true);
    return socket;
}

/** 把主题里的非 ASCII 编成 RFC 2047，避免中文主题把 SMTP 头弄乱 */
function encodeHeaderValue(value: string): string {
    if (/^[\t\x20-\x7E]*$/.test(value)) return value;
    const chars = Array.from(value);
    const words: string[] = [];
    let index = 0;
    while (index < chars.length) {
        let size = Math.min(15, chars.length - index);
        let word = '';
        while (size > 0) {
            const part = chars.slice(index, index + size).join('');
            word = `=?UTF-8?B?${Buffer.from(part, 'utf8').toString('base64')}?=`;
            if (word.length <= 75) break;
            size -= 1;
        }
        if (size <= 0) break;
        words.push(word);
        index += size;
    }
    return words.join('\r\n ');
}

function foldBase64(text: string): string {
    const encoded = Buffer.from(text, 'utf8').toString('base64');
    const lines: string[] = [];
    for (let index = 0; index < encoded.length; index += 76) {
        lines.push(encoded.slice(index, index + 76));
    }
    return lines.join('\r\n');
}

/** 组装 DATA，并对以点开头的行做点填充 */
function buildDataPayload(request: SmtpSendRequest): string {
    const headers = [
        `From: ${request.fromHeader}`,
        `To: ${request.to}`,
        `Subject: ${encodeHeaderValue(request.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
    ].join('\r\n');
    const raw = `${headers}\r\n\r\n${foldBase64(request.text)}\r\n`;
    const stuffed = raw.split('\r\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
    return `${stuffed}.\r\n`;
}

async function auth(session: SmtpSession, username: string, password: string): Promise<void> {
    // 先试 AUTH LOGIN。服务器明确不支持时再退回 AUTH PLAIN，避免把密码打进日志
    const login = await session.command('AUTH LOGIN', [334, 500, 502, 504]);
    if (login.code === 334) {
        await session.command(Buffer.from(username, 'utf8').toString('base64'), [334]);
        await session.command(Buffer.from(password, 'utf8').toString('base64'), [235]);
        return;
    }
    const token = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
    await session.command(`AUTH PLAIN ${token}`, [235]);
}

async function ehlo(session: SmtpSession): Promise<void> {
    const reply = await session.command('EHLO localhost', [250, 500, 502]);
    if (reply.code === 250) return;
    await session.command('HELO localhost', [250]);
}

/**
 * 发送一封纯文本邮件
 * 失败时抛出错误，由调用方记录日志；这里不保存、也不输出密码
 */
export async function sendSmtpMail(request: SmtpSendRequest): Promise<void> {
    const socket = openSocket(request.host, request.port, request.encryption === 'ssl');
    let session = new SmtpSession(socket);
    let activeSocket: net.Socket = socket;
    try {
        const greeting = await session.read();
        if (greeting.code !== 220) {
            throw new Error(shortSmtpError(greeting));
        }
        await ehlo(session);

        if (request.encryption === 'starttls') {
            await session.command('STARTTLS', [220]);
            socket.setTimeout(0);
            session.detach();
            const secure = await startTls(socket, request.host);
            activeSocket = secure;
            session = new SmtpSession(secure);
            await ehlo(session);
        }

        if (request.username) {
            await auth(session, request.username, request.password);
        }

        await session.command(`MAIL FROM:<${request.fromAddress}>`, [250]);
        await session.command(`RCPT TO:<${request.to}>`, [250, 251]);
        await session.command('DATA', [354]);
        session.writeData(buildDataPayload(request));
        const accepted = await session.read();
        if (accepted.code !== 250) {
            throw new Error(shortSmtpError(accepted));
        }
        await session.command('QUIT', [221]);
    } finally {
        if (activeSocket !== socket) activeSocket.destroy();
        socket.destroy();
    }
}

function startTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
        const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
        secure.setTimeout(SMTP_TIMEOUT_MS, () => {
            secure.destroy(new Error('SMTP 连接超时'));
        });
        secure.once('error', (error) => reject(error));
    });
}
