import { app, shell, BrowserWindow, ipcMain, dialog, net, protocol, Notification, globalShortcut, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { Readable } from 'stream'
import type { AddressInfo } from 'net'
import type { BilibiliSearchResult } from '../renderer/src/types'

// 全局日志：主进程错误 / 未处理拒绝落盘，便于用户反馈与排障
log.initialize()
log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024

process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason)
})

// 自定义 media:// 协议：让 <audio>/<video> 直接从磁盘流式读取本地文件，
// 避免把整个文件读入内存生成 blob URL，显著降低内存占用并支持拖动进度（Range）。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

const BILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const BILI_REFERER = 'https://www.bilibili.com'
const BILI_SEARCH_REFERER = 'https://search.bilibili.com'

function generateBuvid3(): string {
  const chars = 'abcdef0123456789'
  let s = ''
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s + 'infoc'
}

const BILI_BUVID3 = generateBuvid3()

function bilibiliCookies(): string {
  const rand = (n: number): string => {
    const chars = 'abcdef0123456789'
    let s = ''
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return s
  }
  const now = Date.now()
  return [
    `buvid3=${BILI_BUVID3}`,
    `buvid4=${rand(32)}infoc`,
    `b_nut=${now}`,
    `b_lsid=${now}_${Math.floor(Math.random() * 100000)}`,
    `CURRENT_FNVAL=4048`
  ].join('; ')
}

const MEDIA_MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime'
}

function mediaMimeType(filePath: string): string {
  return MEDIA_MIME_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function fileToMediaUrl(filePath: string): string {
  return `media://local/${encodeURIComponent(filePath)}`
}

// 仅允许 B 站相关域名作为代理 / 下载目标，防止本机代理被用作开放转发（SSRF）
function isAllowedMediaHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'bilibili.com' ||
    h.endsWith('.bilibili.com') ||
    h === 'bilivideo.com' ||
    h.endsWith('.bilivideo.com') ||
    h === 'bilivideo.cn' ||
    h.endsWith('.bilivideo.cn') ||
    h === 'b23.tv' ||
    h.endsWith('.hdslb.com')
  )
}

/** 校验待下载/代理的目标 URL；若是本机代理地址则解析其 url 参数后校验 */
function resolveSafeTarget(input: string): string | null {
  try {
    const u = new URL(input)
    if (
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      u.pathname === '/proxy'
    ) {
      const target = u.searchParams.get('url')
      if (!target) return null
      const t = new URL(target)
      return isAllowedMediaHost(t.hostname) ? t.href : null
    }
    return isAllowedMediaHost(u.hostname) ? u.href : null
  } catch {
    return null
  }
}

function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      const encoded = url.pathname.replace(/^\/+/, '')
      const filePath = decodeURIComponent(encoded)
      // 仅允许媒体扩展名，防止通过 media:// 读取任意本地文件
      if (!MEDIA_MIME_MAP[path.extname(filePath).toLowerCase()]) {
        return new Response('Forbidden', { status: 403 })
      }
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) throw new Error('not a file')
      const size = stat.size

      const headers: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Content-Type': mediaMimeType(filePath)
      }

      let status = 200
      let start = 0
      let end = size - 1
      const range = request.headers.get('Range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        if (m) {
          start = m[1] !== '' ? Number(m[1]) : 0
          end = m[2] !== '' ? Number(m[2]) : size - 1
          if (!Number.isFinite(start) || start < 0) start = 0
          if (!Number.isFinite(end) || end >= size) end = size - 1
          if (start > end) end = start
          if (start > 0 || end < size - 1) {
            status = 206
            headers['Content-Range'] = `bytes ${start}-${end}/${size}`
          }
        }
      }
      headers['Content-Length'] = String(end - start + 1)

      if (request.method === 'HEAD') {
        return new Response(null, { status, headers })
      }
      const stream = fs.createReadStream(filePath, { start, end })
      const body = Readable.toWeb(stream) as unknown as ReadableStream
      return new Response(body, { status, headers })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

let proxyPort = 0
const proxyServer = http.createServer()

proxyServer.on('request', (req, res) => {
  try {
    const reqUrl = new URL(req.url || '', `http://127.0.0.1:${proxyPort}`)
    if (reqUrl.pathname !== '/proxy') {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Origin, Content-Type'
      })
      res.end()
      return
    }

    const target = reqUrl.searchParams.get('url')
    if (!target) {
      res.writeHead(400)
      res.end('Missing url')
      return
    }

    let targetUrl: string
    try {
      const t = new URL(target)
      if (!isAllowedMediaHost(t.hostname)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      targetUrl = t.href
    } catch {
      res.writeHead(400)
      res.end('Invalid url')
      return
    }

    const remoteReq = net.request({
      method: req.method || 'GET',
      url: targetUrl,
      headers: {
        'User-Agent': BILI_UA,
        Referer: BILI_REFERER
      }
    })

    const range = req.headers['range']
    if (range) {
      remoteReq.setHeader('Range', Array.isArray(range) ? range.join(', ') : range)
    }

    const timer = setTimeout(() => {
      remoteReq.abort()
      if (!res.writableEnded) {
        res.writeHead(504)
        res.end('Proxy Timeout')
      }
    }, 30000)

    remoteReq.on('response', (remoteRes) => {
      clearTimeout(timer)
      const headers: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(remoteRes.headers)) {
        if (value === undefined) continue
        headers[key] = value
      }

      headers['access-control-allow-origin'] = '*'
      headers['access-control-allow-headers'] = 'Range, Origin, Content-Type'

      res.writeHead(remoteRes.statusCode || 200, remoteRes.statusMessage || '', headers)
      remoteRes.on('data', (chunk) => {
        // 背压处理：写不出去时暂停远端，待 drain 后再续传
        if (!res.write(chunk)) {
          remoteRes.pause()
          res.once('drain', () => remoteRes.resume())
        }
      })
      remoteRes.on('end', () => {
        if (!res.writableEnded) res.end()
      })
      remoteRes.on('error', () => {
        if (!res.writableEnded) res.end()
      })
    })

    // 客户端提前断开时中止远端请求，避免泄漏连接
    res.on('close', () => {
      if (!res.writableEnded) remoteReq.abort()
    })

    remoteReq.on('error', () => {
      clearTimeout(timer)
      if (!res.writableEnded) {
        res.writeHead(502)
        res.end('Proxy Error')
      }
    })

    remoteReq.end()
  } catch {
    res.writeHead(500)
    res.end('Internal Error')
  }
})

function startProxyServer(): Promise<number> {
  return new Promise((resolve) => {
    if (proxyPort) {
      resolve(proxyPort)
      return
    }
    proxyServer.listen(0, '127.0.0.1', () => {
      const addr = proxyServer.address() as AddressInfo
      proxyPort = addr.port
      resolve(proxyPort)
    })
  })
}

function proxyUrl(remoteUrl: string): string {
  return `http://127.0.0.1:${proxyPort}/proxy?url=${encodeURIComponent(remoteUrl)}`
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim()
}

function normalizePic(pic: string | undefined): string {
  if (!pic) return ''
  return pic.startsWith('//') ? `https:${pic}` : pic
}

interface NetResponse {
  ok: boolean
  status: number
  body: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function nodeFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 15000,
  redirects = 3
): Promise<NetResponse> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.request(
      url,
      {
        method: 'GET',
        headers,
        // 复用连接，减少 TLS 握手次数
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = []
        let settled = false

        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          res.destroy()
          reject(new Error('请求超时'))
        }, timeoutMs)

        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const body = Buffer.concat(chunks)
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            body: body.toString(),
            json: async () => JSON.parse(body.toString()),
            text: async () => body.toString()
          })
        })
        res.on('error', (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(err)
        })
      }
    )

    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')))

    req.on('error', (err) => reject(err))
    req.end()
  })
}

function bilibiliFetch(
  url: string,
  timeoutMs = 15000,
  referer = BILI_REFERER
): Promise<NetResponse> {
  return nodeFetch(
    url,
    {
      'User-Agent': BILI_UA,
      Referer: referer,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Origin: referer,
      Cookie: bilibiliCookies()
    },
    timeoutMs
  )
}

async function bilibiliFetchWithRetry(
  url: string,
  retries = 2,
  timeoutMs = 15000,
  referer = BILI_REFERER
): Promise<NetResponse> {
  let lastError: Error | undefined
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await bilibiliFetch(url, timeoutMs, referer)
      // HTTP 成功但业务 code 异常时，把 body 带出来便于上层判断
      if (!res.ok) {
        log.warn(`[bilibili] HTTP ${res.status} for ${url}\n${res.body.slice(0, 500)}`)
      }
      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      log.warn(`[bilibili] fetch attempt ${i + 1} failed: ${lastError.message}`)
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)))
      }
    }
  }
  throw lastError || new Error('网络请求失败')
}

// ---- 网易云歌词搜索（用于 B 站歌曲歌词） ----

function neteaseFetchJson(url: string, timeoutMs = 12000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': BILI_UA,
          Referer: 'https://music.163.com',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = []
        let settled = false

        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          res.destroy()
          reject(new Error('请求超时'))
        }, timeoutMs)

        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()))
          } catch {
            reject(new Error('响应解析失败'))
          }
        })
        res.on('error', (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(err)
        })
      }
    )

    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')))

    req.on('error', (err) => reject(err))
    req.end()
  })
}

export interface NeteaseSong {
  id: number
  name: string
  artist: string
  album: string
  duration: number
}

function extractNeteaseSongs(
  songs?: { id?: number; name?: string; artists?: { name?: string }[]; album?: { name?: string }; duration?: number }[]
): NeteaseSong[] {
  if (!Array.isArray(songs)) return []
  const out: NeteaseSong[] = []
  for (const s of songs) {
    if (!s || typeof s.id !== 'number') continue
    out.push({
      id: s.id,
      name: s.name || '未知歌曲',
      artist: Array.isArray(s.artists)
        ? s.artists.map((a) => a?.name).filter(Boolean).join(' / ')
        : '',
      album: s.album?.name || '',
      duration: typeof s.duration === 'number' ? s.duration : 0
    })
  }
  return out
}

/** 网易云搜索：返回候选歌曲列表（search/get，限流或网络异常时回退 cloudsearch/pc） */
async function neteaseSearchSongs(keyword: string): Promise<NeteaseSong[]> {
  try {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(keyword)}&type=1&limit=10&offset=0`
    const data = (await neteaseFetchJson(url)) as { code?: number; result?: { songs?: NeteaseSong[] } }
    if (data?.code === 200) {
      const list = extractNeteaseSongs(data.result?.songs)
      if (list.length > 0) return list
    }
  } catch (err) {
    log.warn(`[netease] search/get failed, fallback to cloudsearch: ${err}`)
  }
  try {
    const data2 = (await neteaseFetchJson(
      `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&limit=10&offset=0`
    )) as { code?: number; result?: { songs?: NeteaseSong[] } }
    if (data2?.code === 200) return extractNeteaseSongs(data2.result?.songs)
  } catch (err) {
    log.warn(`[netease] cloudsearch failed: ${err}`)
  }
  return []
}

/** 网易云取词：返回 LRC 文本 */
async function neteaseFetchLyric(songId: number): Promise<string | null> {
  const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`
  const data = (await neteaseFetchJson(url)) as { lrc?: { lyric?: string } }
  const lyric = data?.lrc?.lyric
  return lyric && lyric.trim() ? lyric : null
}

/** 自动匹配：按关键词依次尝试前几首候选，直到拿到可用歌词 */
async function searchNeteaseLyric(keyword: string): Promise<string | null> {
  const songs = await neteaseSearchSongs(keyword)
  for (const song of songs.slice(0, 5)) {
    try {
      const lrc = await neteaseFetchLyric(song.id)
      if (lrc) return lrc
    } catch { /* try next candidate */ }
  }
  return null
}

// ---------- 平台体验：任务栏缩略图 / 进度条 / 全局快捷键 / 窗口记忆 ----------

let mainWindow: BrowserWindow | null = null

/** 渲染进程上报的播放状态，用于驱动任务栏按钮与进度 */
interface PlaybackState {
  isPlaying: boolean
  hasItem: boolean
  currentTime?: number
  duration?: number
}
let playbackState: PlaybackState = { isPlaying: false, hasItem: false }

/** 向渲染进程发送播放控制指令（来自任务栏按钮 / 全局快捷键） */
function sendMediaControl(action: 'toggle' | 'next' | 'prev'): void {
  mainWindow?.webContents.send('media:control', action)
}

/** Windows 任务栏缩略图按钮：上一首 / 播放暂停 / 下一首 */
function updateTaskbarButtons(): void {
  const win = mainWindow
  if (!win || process.platform !== 'win32') return
  const { isPlaying, hasItem } = playbackState
  const buttons = [
    {
      tooltip: '上一首',
      icon: nativeImageIcon('prev'),
      click: () => sendMediaControl('prev')
    },
    {
      tooltip: isPlaying ? '暂停' : '播放',
      icon: nativeImageIcon(isPlaying ? 'pause' : 'play'),
      click: () => sendMediaControl('toggle')
    },
    {
      tooltip: '下一首',
      icon: nativeImageIcon('next'),
      click: () => sendMediaControl('next')
    }
  ]
  try {
    win.setThumbarButtons(hasItem ? buttons : [])
  } catch {
    // 某些环境不支持时忽略
  }
}

/** 任务栏进度条：0~1，播放中为活动色，暂停为灰色，无曲目时清除 */
function updateTaskbarProgress(): void {
  const win = mainWindow
  if (!win || process.platform !== 'win32') return
  const { isPlaying, hasItem, currentTime = 0, duration = 0 } = playbackState
  if (!hasItem || !(duration > 0)) {
    win.setProgressBar(-1)
    return
  }
  const ratio = Math.max(0, Math.min(1, currentTime / duration))
  win.setProgressBar(ratio, { mode: isPlaying ? 'normal' : 'paused' })
}

// 程序化生成任务栏按钮图标（24x24 白色图形，纯 Node 无外部依赖）
function makeTaskbarIcon(kind: 'play' | 'pause' | 'prev' | 'next'): NativeImage {
  const SIZE = 24
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const set = (x: number, y: number, on: boolean): void => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    const i = (y * SIZE + x) * 4
    if (on) {
      px[i] = 255
      px[i + 1] = 255
      px[i + 2] = 255
      px[i + 3] = 255
    }
  }
  const tri = (cx: number, top: number, bottom: number, left: number): void => {
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / (bottom - top)
      const half = Math.round(left + t * 4)
      for (let x = cx - half; x <= cx + half; x++) {
        if (x >= cx - half + 1) set(x, y, true)
      }
    }
  }
  const bar = (x0: number, y0: number, h: number): void => {
    for (let y = y0; y < y0 + h; y++) {
      set(x0, y, true)
      set(x0 + 1, y, true)
    }
  }
  const blank = (): void => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, false)
  }
  blank()
  if (kind === 'play') {
    tri(8, 7, 17, 3)
  } else if (kind === 'pause') {
    bar(7, 7, 10)
    bar(14, 7, 10)
  } else if (kind === 'prev') {
    tri(17, 7, 17, 3)
    bar(6, 7, 10)
  } else if (kind === 'next') {
    tri(7, 7, 17, 3)
    bar(16, 7, 10)
  }
  return nativeImage.createFromBuffer(pngEncodeRgba(px, SIZE, SIZE))
}

/** 将 RGBA 像素数据编码为 PNG Buffer（8bit RGBA，无交错） */
function pngEncodeRgba(px: Buffer, width: number, height: number): Buffer {
  const CRC_TABLE = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })()
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
    return Buffer.concat([len, typeBuf, data, crc])
  }
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    px.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', require('zlib').deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function nativeImageIcon(kind: 'play' | 'pause' | 'prev' | 'next') {
  return makeTaskbarIcon(kind)
}

/** 全局快捷键：媒体键 / 播放控制组合键，失焦时也可用 */
function registerGlobalShortcuts(): void {
  const bind = (accelerator: string, action: 'toggle' | 'next' | 'prev') => {
    try {
      const ok = globalShortcut.register(accelerator, () => sendMediaControl(action))
      if (!ok) log.warn(`[shortcut] register failed: ${accelerator}`)
    } catch {
      log.warn(`[shortcut] register error: ${accelerator}`)
    }
  }
  // 媒体键
  bind('MediaPlayPause', 'toggle')
  bind('MediaNextTrack', 'next')
  bind('MediaPreviousTrack', 'prev')
  // 组合键兜底（部分键盘无媒体键）
  bind('CommandOrControl+Alt+Space', 'toggle')
  bind('CommandOrControl+Alt+Right', 'next')
  bind('CommandOrControl+Alt+Left', 'prev')
}

// 支持通过命令行/文件关联打开媒体文件或 mineradio:// 深链
const AUDIO_EXT_RE = /\.(mp3|flac|wav|aac|ogg|m4a|opus)$/i
const M3U_EXT_RE = /\.(m3u|m3u8)$/i

function handleOpenTarget(target: string): void {
  if (!mainWindow) return
  if (target.startsWith('mineradio://')) {
    // 深链格式 mineradio://play?url=<encoded> 或 mineradio://open?path=<encoded>
    try {
      const u = new URL(target)
      const playUrl = u.searchParams.get('url')
      const openPath = u.searchParams.get('path')
      if (playUrl) {
        mainWindow.webContents.send('app:open-deep-link', { type: 'play', url: playUrl })
      } else if (openPath) {
        mainWindow.webContents.send('app:open-deep-link', { type: 'open', path: openPath })
      }
    } catch {
      log.warn(`[deeplink] parse failed: ${target}`)
    }
    return
  }
  if (M3U_EXT_RE.test(target)) {
    mainWindow.webContents.send('app:open-deep-link', { type: 'm3u', path: target })
  } else if (AUDIO_EXT_RE.test(target)) {
    mainWindow.webContents.send('app:open-deep-link', { type: 'file', path: target })
  }
}

/** 从启动参数提取待打开的目标（文件路径 / mineradio:// 链接） */
function extractOpenTarget(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('mineradio://')) return arg
    if (AUDIO_EXT_RE.test(arg) || M3U_EXT_RE.test(arg)) return arg
  }
  return null
}

/** 窗口大小/位置记忆：记录到用户数据目录 */
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json')

function readWindowState(): { width: number; height: number; x?: number; y?: number } {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_FILE(), 'utf-8')
    const data = JSON.parse(raw) as { width?: number; height?: number; x?: number; y?: number }
    if (typeof data.width === 'number' && typeof data.height === 'number') {
      return { width: data.width, height: data.height, x: data.x, y: data.y }
    }
  } catch {
    /* 无历史记录或损坏时用默认尺寸 */
  }
  return { width: 1280, height: 800 }
}

function persistWindowState(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return
    const { x, y } = win.getBounds()
    const [width, height] = win.getSize()
    fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify({ x, y, width, height }), 'utf-8')
  } catch {
    /* 写失败不影响运行 */
  }
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const state = readWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#010304',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
    updateTaskbarButtons()
  })

  win.on('resize', () => {
    persistWindowState(win)
  })
  win.on('move', () => {
    persistWindowState(win)
  })
  win.on('maximize', () => {
    persistWindowState(win)
  })
  win.on('unmaximize', () => {
    persistWindowState(win)
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    try {
      const protocol = new URL(details.url).protocol
      if (protocol === 'http:' || protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // ignore malformed urls
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// 单实例锁：防止重复启动多个播放器实例
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    const target = extractOpenTarget(argv)
    if (target) {
      // 等待窗口就绪后再发送打开事件
      setTimeout(() => handleOpenTarget(target), 300)
    }
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.mineradio3d.player')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await startProxyServer()
  registerMediaProtocol()

  // 日志工具：返回日志文件路径 + 渲染进程错误上报入口
  ipcMain.handle('app:logPath', async () => log.transports.file.getFile().path)
  ipcMain.on('app:log', (_, level: string, message: unknown) => {
    const text = typeof message === 'string' ? message : JSON.stringify(message)
    if (level === 'error') log.error('[renderer]', text)
    else if (level === 'warn') log.warn('[renderer]', text)
    else log.info('[renderer]', text)
  })

  // 切歌系统通知
  ipcMain.on('app:notify', (_, payload: { title: string; body?: string }) => {
    if (!Notification.isSupported()) return
    new Notification({
      title: payload?.title || 'MineRadio3D',
      body: payload?.body || '',
      silent: true
    }).show()
  })

  ipcMain.handle('dialog:openFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media Files',
          extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'mp4', 'webm', 'mkv', 'mov']
        },
        { name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg'] },
        { name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (canceled) return []
    return filePaths
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) return []

    const dir = filePaths[0]
    const files = await fs.promises.readdir(dir)
    const mediaExts = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.mp4', '.webm', '.mkv', '.mov']
    const mediaFiles = files
      .filter((f) => mediaExts.includes(path.extname(f).toLowerCase()))
      .map((f) => path.join(dir, f))
    return mediaFiles
  })

  ipcMain.handle('dialog:chooseDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) return ''
    return filePaths[0]
  })

  ipcMain.handle('dialog:openM3u', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'M3U Playlist', extensions: ['m3u'] }]
    })
    if (canceled || filePaths.length === 0) return ''
    return filePaths[0]
  })

  ipcMain.handle('download:saveFile', async (_, params: { url: string; fileName: string; saveDir: string }) => {
    const { url, fileName, saveDir } = params
    try {
      const targetUrl = resolveSafeTarget(url)
      if (!targetUrl) {
        return { success: false, error: '不支持的下载地址' }
      }
      const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_')
      const filePath = path.join(saveDir, safeName)
      // 流式写盘，避免把整份数据累积在内存中；带超时与背压
      await new Promise<void>((resolve, reject) => {
        const request = net.request({
          method: 'GET',
          url: targetUrl,
          headers: {
            'User-Agent': BILI_UA,
            Referer: BILI_REFERER
          }
        })
        const out = fs.createWriteStream(filePath)
        let settled = false
        let receivedAny = false
        const done = (fn: () => void) => () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            fn()
          }
        }
        // 首字节超时：超过 30s 未收到响应即终止
        const timer = setTimeout(() => {
          if (settled) return
          request.abort()
          out.destroy()
          done(() => reject(new Error('下载超时')))()
        }, 30000)
        request.on('response', (response) => {
          if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
            out.destroy()
            done(() => reject(new Error(`HTTP ${response.statusCode}`)))()
            return
          }
          // 已有响应后取消首字节超时，避免大文件下载被误杀
          clearTimeout(timer)
          response.on('data', (chunk) => {
            receivedAny = true
            // 背压：磁盘写不过来时暂停远端，待 drain 后续传
            if (!out.write(Buffer.from(chunk))) {
              response.pause()
              out.once('drain', () => response.resume())
            }
          })
          response.on('end', () => out.end())
          response.on('error', () => {
            out.destroy()
            done(() => reject(new Error('下载响应失败')))()
          })
        })
        request.on('error', done(() => reject(new Error('网络请求失败'))))
        out.on('error', done(() => reject(new Error('写入文件失败'))))
        out.on('finish', done(() => resolve()))
        request.end()
      })
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '下载失败' }
    }
  })

  ipcMain.handle('file:stat', async (_, filePath: string) => {
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) {
        return { exists: false, name: path.basename(filePath), size: 0, url: '' }
      }
      return {
        exists: true,
        name: path.basename(filePath),
        size: stat.size,
        url: fileToMediaUrl(filePath)
      }
    } catch {
      return { exists: false, name: path.basename(filePath), size: 0, url: '' }
    }
  })

  ipcMain.handle('file:readText', async (_, filePath: string) => {
    try {
      if (path.extname(filePath).toLowerCase() !== '.lrc') {
        return { success: false }
      }
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile() || stat.size > 256 * 1024) {
        return { success: false }
      }
      const text = await fs.promises.readFile(filePath, 'utf-8')
      return { success: true, text }
    } catch {
      return { success: false }
    }
  })

  // 保存文本文件（m3u 导出）：先弹保存对话框，再写盘
  ipcMain.handle('file:saveText', async (_, params: { defaultName: string; content: string }) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '导出歌单',
        defaultPath: params?.defaultName || 'playlist.m3u',
        filters: [{ name: 'M3U Playlist', extensions: ['m3u'] }]
      })
      if (canceled || !filePath) return { success: false }
      if (path.extname(filePath).toLowerCase() !== '.m3u') {
        return { success: false, error: '文件扩展名必须为 .m3u' }
      }
      await fs.promises.writeFile(filePath, params?.content || '', 'utf-8')
      return { success: true, filePath }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '导出失败' }
    }
  })

  // 读取 m3u 歌单：仅允许 .m3u，限制大小
  ipcMain.handle('file:readM3u', async (_, filePath: string) => {
    try {
      if (path.extname(filePath).toLowerCase() !== '.m3u') {
        return { success: false }
      }
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        return { success: false }
      }
      const text = await fs.promises.readFile(filePath, 'utf-8')
      return { success: true, text }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('lyrics:searchNetease', async (_, keyword: string) => {
    const kw = typeof keyword === 'string' ? keyword.trim() : ''
    if (!kw) return { success: false }
    try {
      const lrc = await searchNeteaseLyric(kw)
      if (!lrc) return { success: false }
      return { success: true, lrc }
    } catch (err) {
      log.error('[lyrics:searchNetease] failed:', err)
      return { success: false }
    }
  })

  ipcMain.handle('lyrics:searchSongs', async (_, keyword: string) => {
    const kw = typeof keyword === 'string' ? keyword.trim() : ''
    if (!kw) return []
    try {
      return await neteaseSearchSongs(kw)
    } catch (err) {
      log.error('[lyrics:searchSongs] failed:', err)
      return []
    }
  })

  ipcMain.handle('lyrics:getById', async (_, songId: number) => {
    if (typeof songId !== 'number' || !Number.isInteger(songId) || songId <= 0) {
      return { success: false }
    }
    try {
      const lrc = await neteaseFetchLyric(songId)
      if (!lrc) return { success: false }
      return { success: true, lrc }
    } catch (err) {
      log.error('[lyrics:getById] failed:', err)
      return { success: false }
    }
  })

  ipcMain.handle('window:setFullscreen', async (_, fullscreen: boolean) => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      win.setFullScreen(fullscreen)
      if (process.platform !== 'darwin') {
        win.setMenuBarVisibility(!fullscreen)
      }
    }
  })

  ipcMain.handle('window:isFullscreen', async () => {
    const win = BrowserWindow.getFocusedWindow()
    return win ? win.isFullScreen() : false
  })

  ipcMain.handle('window:minimize', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.minimize()
  })

  ipcMain.handle('window:maximize', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle('window:isMaximized', async () => {
    const win = BrowserWindow.getFocusedWindow()
    return win ? win.isMaximized() : false
  })

  ipcMain.handle('window:close', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.close()
  })

  ipcMain.handle('bilibili:search', async (_, keyword: string) => {
    if (!keyword.trim()) return []
    const url = `https://api.bilibili.com/x/web-interface/search/type?keyword=${encodeURIComponent(
      keyword.trim()
    )}&search_type=video`
    const res = await bilibiliFetchWithRetry(url, 2, 15000, BILI_SEARCH_REFERER)
    if (!res.ok) {
      throw new Error(`搜索失败（HTTP ${res.status}），请稍后重试`)
    }
    const json = (await res.json()) as {
      code: number
      message?: string
      data?: { result?: unknown[] }
    }
    if (json.code !== 0) {
      log.error('[bilibili:search] code:', json.code, 'message:', json.message, 'body:', res.body.slice(0, 500))
      throw new Error(json.message || `搜索失败（错误码 ${json.code}）`)
    }
    const result = (json.data?.result || []) as {
      bvid?: string
      title?: string
      author?: string
      duration?: string
      pic?: string
    }[]
    return result
      .filter((item) => item.bvid)
      .map<BilibiliSearchResult>((item) => ({
        bvid: item.bvid!,
        title: stripHtml(item.title || ''),
        author: item.author || '',
        duration: item.duration || '',
        pic: normalizePic(item.pic)
      }))
  })

  ipcMain.handle('bilibili:getAudio', async (_, bvid: string, title?: string) => {
    if (!bvid) throw new Error('缺少 BV 号')

    const pageRes = await bilibiliFetchWithRetry(
      `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`,
      2,
      15000
    )
    if (!pageRes.ok) {
      throw new Error(`无法获取视频分P信息（HTTP ${pageRes.status}）`)
    }
    const pageJson = (await pageRes.json()) as {
      code: number
      message?: string
      data?: { cid: number; part: string }[]
    }
    if (pageJson.code !== 0 || !pageJson.data?.[0]?.cid) {
      log.error('[bilibili:getAudio] pagelist error:', pageJson.code, pageJson.message)
      throw new Error(pageJson.message || '无法获取视频分P信息')
    }
    const cid = pageJson.data[0].cid
    const partTitle = pageJson.data[0].part

    const playRes = await bilibiliFetchWithRetry(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnver=0&fnval=4048&fourk=1`,
      2,
      15000
    )
    if (!playRes.ok) {
      throw new Error(`获取播放地址失败（HTTP ${playRes.status}）`)
    }
    const playJson = (await playRes.json()) as {
      code: number
      message?: string
      data?: {
        dash?: {
          audio?: { baseUrl: string; backupUrl?: string[]; bandwidth: number }[]
        }
        durl?: { url: string }[]
      }
    }
    if (playJson.code !== 0) {
      log.error('[bilibili:getAudio] playurl error:', playJson.code, playJson.message)
      throw new Error(playJson.message || '获取播放地址失败')
    }

    let remoteUrl = ''
    const backups: string[] = []
    let bandwidth = 0
    const audios = playJson.data?.dash?.audio
    if (audios && audios.length > 0) {
      const best = [...audios].sort((a, b) => b.bandwidth - a.bandwidth)[0]
      remoteUrl = best.baseUrl
      bandwidth = best.bandwidth
      if (best.backupUrl) backups.push(...best.backupUrl)
      for (const a of audios) {
        if (a.baseUrl !== best.baseUrl) backups.push(a.baseUrl)
      }
    } else if (playJson.data?.durl?.[0]?.url) {
      remoteUrl = playJson.data.durl[0].url
    }

    if (!remoteUrl) {
      throw new Error('该视频暂无可用音频')
    }

    return {
      url: proxyUrl(remoteUrl),
      backups: backups.slice(0, 3).map(proxyUrl),
      title: title || partTitle || bvid,
      bitrate: bandwidth
    }
  })

  // 渲染进程上报播放状态 → 驱动任务栏缩略图按钮与进度条
  ipcMain.on('media:state', (_, state: PlaybackState) => {
    playbackState = { isPlaying: !!state?.isPlaying, hasItem: !!state?.hasItem, currentTime: state?.currentTime, duration: state?.duration }
    updateTaskbarButtons()
    updateTaskbarProgress()
  })

  registerGlobalShortcuts()

  // 深链 / 文件关联：处理首次启动与 open-url 事件
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('mineradio', process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('mineradio')
  }
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleOpenTarget(url)
  })

  createWindow()

  // 首次启动携带的媒体文件 / 深链在窗口加载后打开
  const initialTarget = extractOpenTarget(process.argv)
  if (initialTarget) {
    setTimeout(() => handleOpenTarget(initialTarget), 400)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    proxyServer.close()
    app.quit()
  }
})
