import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { BilibiliSearchResult, CustomPlaylist, MediaItem } from '../types'

const CACHE_KEY = 'mineradio3d-bili-daily-recs'

interface DailyRecsCache {
  generatedAt: number
  items: BilibiliSearchResult[]
}

// ---- pure helpers ----

/** 去除文件名中的扩展名和常见质量标签 */
function cleanName(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '')           // 去扩展名
    .replace(/[[【(][^\]】)]*[\]】)]/g, '') // 去括号内容 [320K] (HQ) 等
    .replace(/_/g, ' ')
    .trim()
}

// 冷启动兜底关键词：收藏歌单为空时也能给出推荐
const FALLBACK_KEYWORDS = ['热门音乐', '纯音乐', '轻音乐']

/** 从收藏歌单中提取搜索关键词（最多 5 个）；无歌单时回退到默认关键词 */
function extractKeywords(playlists: CustomPlaylist[]): string[] {
  const names = new Set<string>()
  // 从所有歌单收集歌曲名
  for (const pl of playlists) {
    for (const item of pl.items) {
      const cleaned = cleanName(item.name)
      if (cleaned.length >= 2) names.add(cleaned)
    }
  }
  if (names.size === 0) return [...FALLBACK_KEYWORDS]
  // 按长度降序（更具体的查询往往更好），取前 5 个
  return Array.from(names)
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
}

/** 判断缓存是否过期：以每天 5:00 为界 */
function isCacheStale(cachedAt: number): boolean {
  const now = new Date()
  const today5am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0, 0, 0)
  const boundary = now >= today5am ? today5am : new Date(today5am.getTime() - 86400000)
  return cachedAt < boundary.getTime()
}

function readCache(): DailyRecsCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data && Array.isArray(data.items) && typeof data.generatedAt === 'number') {
      return data as DailyRecsCache
    }
    return null
  } catch {
    return null
  }
}

function writeCache(items: BilibiliSearchResult[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ generatedAt: Date.now(), items }))
  } catch { /* quota exceeded, ignore */ }
}

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function fetchDailyRecommendations(
  keywords: string[],
  existingBvids: Set<string>
): Promise<BilibiliSearchResult[]> {
  if (keywords.length === 0) return []

  const settled = await Promise.allSettled(
    keywords.map((kw) => window.electronAPI.bilibiliSearch(kw))
  )

  // 展平所有成功结果，去重并过滤已在歌单中的
  const seen = new Set<string>()
  const merged: BilibiliSearchResult[] = []

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      if (seen.has(item.bvid)) continue
      if (existingBvids.has(item.bvid)) continue
      seen.add(item.bvid)
      merged.push(item)
    }
  }

  return shuffle(merged).slice(0, 5)
}

// ---- hook ----

interface UseBilibiliDailyRecsResult {
  recs: BilibiliSearchResult[]
  loading: boolean
  error: string
  refresh: () => void
}

export function useBilibiliDailyRecs(
  customPlaylists: CustomPlaylist[],
  playlist: MediaItem[]
): UseBilibiliDailyRecsResult {
  const [recs, setRecs] = useState<BilibiliSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const fetchingRef = useRef(false)

  // 用 ref 持有最新入参，避免 doFetch 因数组引用变化而重建（进而重建 interval）
  const customPlaylistsRef = useRef(customPlaylists)
  customPlaylistsRef.current = customPlaylists
  const playlistRef = useRef(playlist)
  playlistRef.current = playlist
  // 数据变化时的“版本号”，仅在内容真正变化时触发重新拉取
  const dataVersion = useMemo(
    () =>
      JSON.stringify({
        lists: customPlaylists.map((p) => p.items.map((i) => i.name)),
        bili: playlist.filter((i) => i.source === 'bilibili').map((i) => i.bvid)
      }),
    [customPlaylists, playlist]
  )

  const doFetch = useCallback(async (force: boolean) => {
    // 检查缓存
    if (!force) {
      const cache = readCache()
      if (cache && !isCacheStale(cache.generatedAt)) {
        setRecs(cache.items)
        setLoading(false)
        return
      }
    }

    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    setError('')

    try {
      const keywords = extractKeywords(customPlaylistsRef.current)
      const existingBvids = new Set(
        playlistRef.current
          .filter((i) => i.source === 'bilibili' && i.bvid)
          .map((i) => i.bvid!)
      )
      const items = await fetchDailyRecommendations(keywords, existingBvids)
      writeCache(items)
      setRecs(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '推荐加载失败')
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [])

  // 初次加载 & 数据内容变化时重新获取
  useEffect(() => {
    doFetch(false)
  }, [doFetch, dataVersion])

  // 每 60 秒检查是否跨过 5:00 边界（依赖稳定，只注册一次）
  useEffect(() => {
    const timer = setInterval(() => {
      const cache = readCache()
      if (cache && isCacheStale(cache.generatedAt)) {
        doFetch(true)
      }
    }, 60000)
    return () => clearInterval(timer)
  }, [doFetch])

  const refresh = useCallback(() => doFetch(true), [doFetch])

  return { recs, loading, error, refresh }
}
