import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { BilibiliSearchResult, MediaItem, CustomPlaylist, SavedMediaItem } from '../types'
import { formatTime } from '../utils'
import { useBilibiliDailyRecs } from '../hooks/useBilibiliDailyRecs'
import Settings from './Settings'
import { HeartIcon, PlusIcon } from './icons'
import { toast, toastSuccess, toastError } from '../utils/toast'

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 分'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h} 时 ${m} 分`
  return `${m} 分`
}

interface EmptyGuideProps {
  icon?: string
  title: string
  desc?: string
  actions?: { label: string; onClick?: () => void; primary?: boolean }[]
}

/** 引导性空状态：带图标 + 说明 + 快捷操作按钮 */
function EmptyGuide({ icon = '♪', title, desc, actions = [] }: EmptyGuideProps) {
  return (
    <div className="empty-guide">
      <div className="empty-guide-icon">{icon}</div>
      <div className="empty-guide-title">{title}</div>
      {desc && <div className="empty-guide-desc">{desc}</div>}
      {actions.length > 0 && (
        <div className="empty-guide-actions">
          {actions.map((a, i) => (
            <button
              key={i}
              className={`empty-guide-btn${a.primary ? ' primary' : ''}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface SongStat {
  plays: number
  seconds: number
  lastPlayed: number
}
interface PlayEvent {
  id: string
  ts: number
}

interface MainInterfaceProps {
  playlist: MediaItem[]
  currentIndex: number
  currentItem: MediaItem | null
  isPlaying: boolean
  currentTime: number
  duration: number
  activeTab: 'home' | 'playlist' | 'stats' | 'recommend' | 'settings'
  onNavigateTab: (tab: 'home' | 'playlist' | 'stats' | 'recommend' | 'settings') => void
  onGoHome: () => void
  durations?: Record<string, number>
  playStats?: Record<string, SongStat>
  playEvents?: PlayEvent[]
  onPlay: (index: number) => void
  onTogglePlay: () => void
  onOpenPlayer: () => void
  onAddBilibili: (item: BilibiliSearchResult) => void
  onPlayBilibili: (item: BilibiliSearchResult) => void
  onDelete: (index: number) => void
  onDeleteMany: (targets: number[] | string[]) => void
  onClearAll: () => void
  customPlaylists?: CustomPlaylist[]
  onCreatePlaylist?: (name: string) => string
  onAddToPlaylist?: (playlistId: string, item: SavedMediaItem) => void
  onDeletePlaylist?: (id: string) => void
  onRemoveFromPlaylist?: (playlistId: string, itemIndex: number) => void
  onPlaySavedItem?: (item: SavedMediaItem) => void
  downloadDir?: string
  onDownloadDirChange?: (dir: string) => void
  likedIds?: Set<string>
  onToggleLike?: (item: MediaItem) => void
  onExportM3u?: () => void
  onImportM3u?: () => void
  onImportFiles?: () => void
  onImportFolder?: () => void
}

function MainInterface({
  playlist,
  currentIndex,
  currentItem,
  isPlaying,
  currentTime,
  duration,
  activeTab,
  onNavigateTab,
  onGoHome,
  durations = {},
  playStats = {},
  playEvents = [],
  onPlay,
  onTogglePlay,
  onOpenPlayer,
  onAddBilibili,
  onPlayBilibili,
  onDelete,
  onDeleteMany,
  onClearAll,
  customPlaylists = [],
  onCreatePlaylist,
  onAddToPlaylist,
  onDeletePlaylist,
  onRemoveFromPlaylist,
  onPlaySavedItem,
  downloadDir = '',
  onDownloadDirChange,
  likedIds,
  onToggleLike,
  onExportM3u,
  onImportM3u,
  onImportFiles,
  onImportFolder
}: MainInterfaceProps) {
  const [mounted, setMounted] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<BilibiliSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [expandedPlaylists, setExpandedPlaylists] = useState<Set<string>>(new Set())
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [addTarget, setAddTarget] = useState<number | null>(null)
  const [addListName, setAddListName] = useState('')
  const [addPos, setAddPos] = useState<{ top: number; left: number } | null>(null)

  const { recs: dailyRecs, loading: recsLoading, error: recsError, refresh: recsRefresh } =
    useBilibiliDailyRecs(customPlaylists, playlist)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80)
    return () => clearTimeout(t)
  }, [])

  // 点击外部关闭弹窗
  useEffect(() => {
    if (addTarget == null) return
    const close = () => { setAddTarget(null); setAddPos(null) }
    const timer = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', close) }
  }, [addTarget])

  const progress = useMemo(
    () => (duration > 0 ? (currentTime / duration) * 100 : 0),
    [currentTime, duration]
  )

  // ===== 真实听歌数据分析 =====

  // 常听歌曲排行：按真实播放次数排序
  const topItems = useMemo(() => {
    const withCount = playlist.map((item, idx) => ({
      item,
      idx,
      plays: playStats[item.id]?.plays || 0,
      seconds: playStats[item.id]?.seconds || 0
    }))
    return withCount
      .filter((x) => x.plays > 0)
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .slice(0, 5)
  }, [playlist, playStats])

  // 最近播放：按真实 lastPlayed 时间排序
  const recentItems = useMemo(() => {
    const withTs = playlist
      .map((item, idx) => ({ item, idx, last: playStats[item.id]?.lastPlayed || 0 }))
      .filter((x) => x.last > 0)
      .sort((a, b) => b.last - a.last)
      .slice(0, 6)
    if (withTs.length > 0) return withTs
    // 无播放记录时回退到歌单尾部
    return playlist
      .map((item, idx) => ({ item, idx, last: 0 }))
      .slice(-6)
      .reverse()
  }, [playlist, playStats])

  // 听歌时长统计（全量基于真实数据）
  const listeningStats = useMemo(() => {
    const listenedSeconds = playlist.reduce(
      (sum, item) => sum + (playStats[item.id]?.seconds || 0),
      0
    )
    const totalPlays = playlist.reduce((sum, item) => sum + (playStats[item.id]?.plays || 0), 0)
    const knownDurationSeconds = playlist.reduce(
      (sum, item) => sum + (durations[item.id] || 0),
      0
    )
    const knownDurationCount = playlist.filter((item) => durations[item.id]).length
    const total = playlist.length
    const bili = playlist.filter((i) => i.source === 'bilibili').length
    const local = total - bili
    const avgDuration = knownDurationCount > 0 ? knownDurationSeconds / knownDurationCount : 0
    return {
      listenedSeconds, // 真实累计听歌秒数
      totalPlays, // 真实累计播放次数
      totalSeconds: listenedSeconds,
      bilibiliCount: bili,
      localCount: local,
      avgDuration,
      bilibiliRatio: total > 0 ? bili / total : 0
    }
  }, [playlist, durations, playStats])

  // 听歌时段分布：基于真实播放事件的时间戳
  const timeSlots = useMemo(() => {
    const slotDefs = [
      { key: 'dawn', label: '清晨', range: '05–09', from: 5, to: 9 },
      { key: 'morning', label: '上午', range: '09–12', from: 9, to: 12 },
      { key: 'afternoon', label: '下午', range: '12–18', from: 12, to: 18 },
      { key: 'evening', label: '夜晚', range: '18–24', from: 18, to: 24 },
      { key: 'night', label: '深夜', range: '00–05', from: 0, to: 5 }
    ]
    const counts = slotDefs.map(() => 0)
    playEvents.forEach((e) => {
      const h = new Date(e.ts).getHours()
      const idx = slotDefs.findIndex((s) => h >= s.from && h < s.to)
      if (idx >= 0) counts[idx]++
    })
    const sum = counts.reduce((a, b) => a + b, 0)
    return slotDefs.map((s, i) => ({
      ...s,
      value: sum > 0 ? counts[i] / sum : 0,
      count: counts[i]
    }))
  }, [playEvents])

  // 近 7 日听歌趋势：按每首歌「平均每次播放听歌秒数 = 累计秒数 / 累计播放次数」分摊到各天
  const weeklyTrend = useMemo(() => {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const now = new Date()
    const DAY = 86400000
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const weekStart = startOfToday - 6 * DAY
    const weekEnd = startOfToday + DAY

    const perSongDayCount: Record<string, number[]> = {}
    playEvents.forEach((e) => {
      if (e.ts < weekStart || e.ts >= weekEnd) return
      const dayIdx = Math.floor((e.ts - weekStart) / DAY)
      ;(perSongDayCount[e.id] ||= new Array(7).fill(0))[dayIdx]++
    })

    const perDaySeconds = new Array(7).fill(0)
    Object.entries(perSongDayCount).forEach(([id, counts]) => {
      const totalSec = playStats[id]?.seconds || 0
      const lifetimePlays = playStats[id]?.plays || 0
      if (lifetimePlays <= 0 || totalSec <= 0) return
      const secPerPlay = totalSec / lifetimePlays
      counts.forEach((c, day) => {
        perDaySeconds[day] += c * secPerPlay
      })
    })

    const buckets: { day: string; minutes: number; isToday: boolean }[] = []
    for (let back = 6; back >= 0; back--) {
      const d = new Date(startOfToday - back * DAY)
      const idx = 6 - back
      buckets.push({
        day: dayNames[d.getDay()],
        minutes: Math.round(perDaySeconds[idx] / 60),
        isToday: back === 0
      })
    }
    return buckets
  }, [playEvents, playStats])

  // 个人偏好标签：基于真实来源比例 + 歌名关键词
  const preferenceTags = useMemo(() => {
    const tags: { label: string; weight: number }[] = []
    const total = playlist.length
    const bili = listeningStats.bilibiliCount
    const local = listeningStats.localCount
    const listenedSec = listeningStats.listenedSeconds
    if (total === 0) return []
    // 来源偏好
    if (bili > 0) {
      tags.push({ label: 'B 站精选', weight: Math.round((bili / total) * 100) })
    }
    if (local > 0) {
      tags.push({ label: '本地收藏', weight: Math.round((local / total) * 100) })
    }
    // 关键词偏好（扫描歌名）
    const keywordTags: { label: string; weight: number; hits: number }[] = [
      { label: 'ACG / 动漫', weight: 0, hits: 0 },
      { label: '纯音乐', weight: 0, hits: 0 },
      { label: '流行', weight: 0, hits: 0 },
      { label: '电子', weight: 0, hits: 0 },
      { label: '影视原声', weight: 0, hits: 0 }
    ]
    const matchers: RegExp[] = [
      /(op|ed|动漫|anime| vocaloid|lofi|acg|bv|番剧)/i,
      /(纯音乐| instrumental|钢琴|piano|轻音乐|sans|无人声)/i,
      /(流行|pop| cover|翻唱| remix)/i,
      /(电子|edm|electronic|house|trance|dubstep| remix|d j|dj)/i,
      /( ost|原声|电影|影视|主题曲|片尾|片头)/i
    ]
    playlist.forEach((item) => {
      const name = item.name.replace(/\.[^/.]+$/, '')
      matchers.forEach((re, i) => {
        if (re.test(name)) keywordTags[i].hits++
      })
    })
    keywordTags.forEach((t) => {
      if (t.hits > 0) {
        tags.push({ label: t.label, weight: Math.round((t.hits / total) * 100) })
      }
    })
    // 资深标签基于真实累计听歌时长
    const mins = listenedSec / 60
    if (mins >= 60) tags.push({ label: '活跃听众', weight: Math.min(100, Math.round((mins / 600) * 100)) })
    if (mins >= 600) tags.push({ label: '资深乐迷', weight: Math.min(100, Math.round((mins / 1800) * 100)) })
    return tags
      .filter((t) => t.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8)
  }, [playlist, listeningStats])

  // 活跃度等级：基于真实累计听歌时长
  const listenerLevel = useMemo(() => {
    const mins = listeningStats.listenedSeconds / 60
    if (mins < 30) return { label: '初露锋芒', color: '#7ad7c2' }
    if (mins < 180) return { label: '渐入佳境', color: '#00f5d4' }
    if (mins < 600) return { label: '音乐达人', color: '#f4d28a' }
    return { label: '资深乐迷', color: '#ff5367' }
  }, [listeningStats])

  // ===== 听歌推荐 =====
  // 反复聆听：播放次数最多的歌曲
  const replayItems = useMemo(() => {
    return playlist
      .map((item, idx) => {
        const stat = playStats[item.id]
        return { item, idx, plays: stat?.plays || 0, seconds: stat?.seconds || 0 }
      })
      .filter((x) => x.plays > 0)
      .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds)
      .slice(0, 6)
  }, [playlist, playStats])



  const handleDownload = useCallback(
    async (bvid: string, title: string) => {
      if (!downloadDir) {
        toastError('请先在设置中设置下载目录')
        onNavigateTab('settings')
        return
      }
      try {
        const audio = await window.electronAPI.getBilibiliAudio(bvid, title)
        const fileName = `${title || bvid}.m4a`
        const result = await window.electronAPI.downloadFile({
          url: audio.url,
          fileName,
          saveDir: downloadDir
        })
        if (result.success) {
          toastSuccess(`下载完成：${fileName}`)
        } else {
          toastError(`下载失败：${result.error}`)
        }
      } catch (err) {
        toastError(err instanceof Error ? err.message : '下载失败')
      }
    },
    [downloadDir]
  )

  const handleAddToPlaylist = useCallback(
    (playlistId: string, item: SavedMediaItem) => {
      onAddToPlaylist?.(playlistId, item)
    },
    [onAddToPlaylist]
  )

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchError('请输入搜索关键词')
      setShowResults(true)
      return
    }
    setSearchLoading(true)
    setSearchError('')
    setSearchResults([])
    setShowResults(true)
    try {
      const list = await window.electronAPI.bilibiliSearch(searchQuery.trim())
      setSearchResults(list)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery])

  const navItem = (id: typeof activeTab, label: string, icon: string) => (
    <button
      key={id}
      className={`dashboard-nav-item ${activeTab === id ? 'active' : ''}`}
      onClick={() => onNavigateTab(id)}
    >
      <span className="dashboard-nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  )

  const toggleSelect = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const handleDeleteSelected = useCallback(() => {
    if (selected.size === 0) return
    onDeleteMany(Array.from(selected))
    setSelected(new Set())
  }, [selected, onDeleteMany])

  const handleClearAll = useCallback(() => {
    if (playlist.length === 0) return
    if (window.confirm(`确定要清空全部 ${playlist.length} 首歌曲吗?`)) {
      onClearAll()
      setSelected(new Set())
    }
  }, [playlist.length, onClearAll])

  const handleDeleteOne = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete(index)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(index)
        return next
      })
    },
    [onDelete, setSelected]
  )

  return (
    <div className={`dashboard ${mounted ? 'mounted' : ''}`}>
      <div className="dashboard-particles" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} className="dashboard-particle" style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>
      <div className="dashboard-glow" aria-hidden="true" />

      <aside className="dashboard-sidebar">
        <div className="dashboard-logo">
          <div className="dashboard-logo-mark">
            <span>M</span>
            <span className="dashboard-logo-dot" />
          </div>
          <div>
            <div className="dashboard-logo-title">MineRadio</div>
            <div className="dashboard-logo-sub">3D Player</div>
          </div>
        </div>

        <nav className="dashboard-nav">
          <button className="dashboard-nav-item dashboard-nav-back" onClick={onGoHome}>
            <span className="dashboard-nav-icon">←</span>
            <span>返回主界面</span>
          </button>
          {navItem('home', '首页', '⌂')}
          {navItem('playlist', '我的歌单', '♫')}
          {navItem('stats', '听歌分析', '◈')}
          {navItem('recommend', '听歌推荐', '✦')}
          {navItem('settings', '设置', '⚙')}
        </nav>

        <div className="dashboard-mini-player">
          <div
            className="dashboard-mini-cover"
            style={currentItem?.cover ? { backgroundImage: `url(${currentItem.cover})` } : undefined}
          />
          <div className="dashboard-mini-info">
            <div className="dashboard-mini-title" title={currentItem?.name || ''}>
              {currentItem ? currentItem.name.replace(/\.[^/.]+$/, '') : '未播放'}
            </div>
            <div className="dashboard-mini-time">
              {currentItem ? `${formatTime(currentTime)} / ${formatTime(duration)}` : '--:--'}
            </div>
          </div>
          <button className="dashboard-mini-play" onClick={currentItem ? onTogglePlay : onOpenPlayer}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          {isPlaying && (
            <div className="dashboard-eq mini-eq" aria-hidden="true">
              <span /><span /><span />
            </div>
          )}
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1 className="dashboard-greeting">欢迎回来</h1>
            <p className="dashboard-subtitle">今天想听点什么？</p>
          </div>
          <button className="dashboard-enter-player" onClick={onOpenPlayer}>
            <span>进入播放器</span>
            <span>→</span>
          </button>
        </header>

        {activeTab === 'home' && (
          <div className="dashboard-content">
            <section className="dashboard-hero">
              <div className="dashboard-hero-bg" />
              <div className="dashboard-hero-info">
                <div className="dashboard-hero-label">正在热播</div>
                <h2 className="dashboard-hero-title">
                  {currentItem ? currentItem.name.replace(/\.[^/.]+$/, '') : playlist.length === 0 ? '欢迎来到 MineRadio3D' : '沉浸于 3D 音乐空间'}
                </h2>
                <p className="dashboard-hero-desc">
                  {currentItem
                    ? currentItem.source === 'bilibili'
                      ? 'Bilibili 音频'
                      : '本地音频文件'
                    : playlist.length === 0
                      ? '还没有歌曲，导入本地音乐或搜索 B 站开始体验'
                      : '选择一首歌，开启可视化之旅'}
                </p>
                <div className="dashboard-hero-actions">
                  <button className="dashboard-btn-primary" onClick={currentItem ? onTogglePlay : (playlist.length === 0 ? onImportFiles : onOpenPlayer)}>
                    {isPlaying ? '暂停播放' : currentItem ? '立即播放' : playlist.length === 0 ? '导入本地音乐' : '立即播放'}
                  </button>
                  {playlist.length === 0 && onImportFolder && (
                    <button className="dashboard-btn-ghost" onClick={onImportFolder}>
                      导入文件夹
                    </button>
                  )}
                  {playlist.length === 0 && (
                    <button className="dashboard-btn-ghost" onClick={onOpenPlayer}>
                      搜索 B 站
                    </button>
                  )}
                  {isPlaying && (
                    <div className="dashboard-eq hero-eq" aria-hidden="true">
                      <span /><span /><span /><span /><span />
                    </div>
                  )}
                </div>
              </div>
              <div className="dashboard-hero-visual">
                <div className="dashboard-hero-disc">
                  <div className="dashboard-hero-disc-inner" />
                </div>
                <div className="dashboard-hero-orbit" />
                <div className="dashboard-hero-orbit reverse" />
              </div>
            </section>

            <section className="dashboard-section">
              <div className="dashboard-section-header">
                <h3>最近播放</h3>
                <button className="dashboard-link" onClick={() => setActiveTab('playlist')}>
                  查看全部
                </button>
              </div>
              <div className="dashboard-cards">
                {recentItems.length === 0 && (
                  <EmptyGuide
                    icon="♪"
                    title="还没有播放记录"
                    desc={playlist.length === 0 ? '导入本地音乐或搜索 B 站音频，开始你的第一首歌' : '从歌单中点开一首歌，播放记录会显示在这里'}
                    actions={playlist.length === 0 ? [
                      { label: '导入本地音乐', onClick: onImportFiles, primary: true },
                      { label: '进入播放器', onClick: onOpenPlayer }
                    ] : undefined}
                  />
                )}
                {recentItems.map(({ item, idx }) => (
                  <div
                    key={item.id}
                    className={`dashboard-card ${idx === currentIndex ? 'active' : ''}`}
                    onDoubleClick={() => onPlay(idx)}
                  >
                    <div
                      className="dashboard-card-cover"
                      style={item.cover ? { backgroundImage: `url(${item.cover})` } : undefined}
                    />
                    <div className="dashboard-card-body">
                      <div className="dashboard-card-title" title={item.name}>
                        {item.name.replace(/\.[^/.]+$/, '')}
                      </div>
                      <div className="dashboard-card-meta">
                        {item.source === 'bilibili' ? 'Bilibili' : '本地'}
                      </div>
                    </div>
                    <button
                      className="dashboard-card-play"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlay(idx)
                      }}
                    >
                      ▶
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="dashboard-section">
              <div className="dashboard-section-header">
                <h3>听歌概览</h3>
              </div>
              <div className="dashboard-stats">
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">{playlist.length}</div>
                  <div className="dashboard-stat-label">歌曲总数</div>
                </div>
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">{listeningStats.totalPlays}</div>
                  <div className="dashboard-stat-label">累计播放(次)</div>
                </div>
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">
                    {formatDuration(listeningStats.listenedSeconds)}
                  </div>
                  <div className="dashboard-stat-label">听歌时长</div>
                </div>
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">
                    {playlist.filter((i) => i.source === 'bilibili').length}
                  </div>
                  <div className="dashboard-stat-label">B 站音频</div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'playlist' && (
          <div className="dashboard-content">
            <section className="dashboard-section wide">
              <div className="dashboard-section-header">
                <h3>我的歌单</h3>
                <div className="dashboard-header-actions">
                  <div className="dashboard-list-toolbar">
                    {onExportM3u && (
                      <button
                        className="dashboard-toolbar-btn"
                        onClick={onExportM3u}
                        title="导出为 m3u 歌单文件"
                      >
                        导出 m3u
                      </button>
                    )}
                    {onImportM3u && (
                      <button
                        className="dashboard-toolbar-btn"
                        onClick={onImportM3u}
                        title="从 m3u 文件导入歌曲"
                      >
                        导入 m3u
                      </button>
                    )}
                    <button
                      className="dashboard-toolbar-btn"
                      onClick={handleDeleteSelected}
                      disabled={selected.size === 0}
                      title="删除选中的歌曲"
                    >
                      删除所选{selected.size > 0 ? `(${selected.size})` : ''}
                    </button>
                    <button
                      className="dashboard-toolbar-btn danger"
                      onClick={handleClearAll}
                      title="清空整个歌单"
                    >
                      清空列表
                    </button>
                  </div>
                  <div className="dashboard-search-box">
                    <input
                      className="dashboard-search-input"
                      type="text"
                      placeholder="搜索 B 站视频并加入歌单"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                    <button
                      className="dashboard-search-btn"
                      onClick={handleSearch}
                      disabled={searchLoading}
                    >
                      {searchLoading ? '…' : '搜索'}
                    </button>
                  </div>
                  <div className="dashboard-search-box" style={{ maxWidth: 200, marginLeft: 6 }}>
                    <input
                      className="dashboard-search-input"
                      type="text"
                      placeholder="新建歌单名称"
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newPlaylistName.trim()) {
                          onCreatePlaylist?.(newPlaylistName)
                          setNewPlaylistName('')
                        }
                      }}
                    />
                    <button
                      className="dashboard-search-btn"
                      disabled={!newPlaylistName.trim()}
                      onClick={() => {
                        if (!newPlaylistName.trim()) return
                        onCreatePlaylist?.(newPlaylistName)
                        setNewPlaylistName('')
                      }}
                    >
                      <PlusIcon size={14} />
                    </button>
                  </div>
                  <span className="dashboard-count">{playlist.length} 首</span>
                </div>
              </div>

              {showResults && (
                <div className="dashboard-search-panel">
                  <div className="dashboard-search-panel-header">
                    <span>B 站搜索结果</span>
                    <button
                      className="dashboard-search-close"
                      onClick={() => {
                        setShowResults(false)
                        setSearchResults([])
                        setSearchError('')
                      }}
                    >
                      关闭
                    </button>
                  </div>
                  {searchError && <div className="dashboard-search-error">{searchError}</div>}
                  <div className="dashboard-search-results">
                    {searchResults.length === 0 && !searchLoading && !searchError && (
                      <div className="dashboard-empty">暂无搜索结果</div>
                    )}
                    {searchResults.map((item) => (
                      <div
                        key={item.bvid}
                        className="dashboard-search-result"
                        onDoubleClick={() => onPlayBilibili(item)}
                        title="双击立即播放"
                      >
                        <img
                          className="dashboard-search-result-cover"
                          src={item.pic}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <div className="dashboard-search-result-info">
                          <div className="dashboard-search-result-title" title={item.title}>
                            {item.title}
                          </div>
                          <div className="dashboard-search-result-meta">
                            {item.author} · {item.duration}
                          </div>
                        </div>
                        <div className="dashboard-search-result-actions">
                          <button
                            className="dashboard-search-result-dl"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDownload(item.bvid, item.title)
                            }}
                            title="下载音频"
                          >
                            ⬇
                          </button>
                          <button
                            className="dashboard-search-result-add"
                            onClick={(e) => {
                              e.stopPropagation()
                              onAddBilibili(item)
                            }}
                            title="加入播放列表"
                          >
                            +
                          </button>
                          <button
                            className="dashboard-search-result-play"
                            onClick={(e) => {
                              e.stopPropagation()
                              onPlayBilibili(item)
                            }}
                            title="立即播放"
                          >
                            ▶
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 自定义歌单卡片 */}
              {customPlaylists.length === 0 ? (
                <div style={{ padding: '4px 0 16px' }}>
                  <EmptyGuide
                    icon="▤"
                    title="还没有收藏歌单"
                    desc="在上方输入歌单名称创建，播放时点击收藏即可快速归拢喜欢的歌曲"
                  />
                </div>
              ) : (
                <div className="dashboard-cards" style={{ marginBottom: 24 }}>
                    {customPlaylists.map((pl) => {
                      const expanded = expandedPlaylists.has(pl.id)
                      return (
                        <div key={pl.id} className="dashboard-card-wrap">
                          <div
                            className="dashboard-card-header"
                            onClick={() =>
                              setExpandedPlaylists((prev) => {
                                const next = new Set(prev)
                                if (next.has(pl.id)) next.delete(pl.id)
                                else next.add(pl.id)
                                return next
                              })
                            }
                          >
                            <span className="dashboard-card-header-name">{pl.name}</span>
                            <span className="dashboard-card-header-count">{pl.items.length} 首</span>
                            <span className={`collection-card-arrow ${expanded ? 'open' : ''}`}>▸</span>
                            <button
                              className="dashboard-card-header-del"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (window.confirm(`删除歌单"${pl.name}"？`)) onDeletePlaylist?.(pl.id)
                              }}
                              title="删除歌单"
                            >
                              ×
                            </button>
                          </div>
                          {expanded && (
                            <div className="dashboard-card-items">
                              {pl.items.length === 0 ? (
                                <div className="dashboard-empty" style={{ padding: '14px 0', fontSize: '12px' }}>
                                  歌单为空，在播放器或搜索结果中使用收藏功能添加歌曲
                                </div>
                              ) : (
                                pl.items.map((sitem, sidx) => (
                                  <div key={`${sitem.path}-${sidx}`} className="dashboard-card-item"
                                    onDoubleClick={() => onPlaySavedItem?.(sitem)}
                                    title="双击播放">
                                    <span className="dashboard-card-item-name" title={sitem.name}>
                                      {sitem.name.replace(/\.[^/.]+$/, '')}
                                    </span>
                                    <span className="dashboard-card-item-src">
                                      {sitem.source === 'bilibili' ? 'B站' : '本地'}
                                    </span>
                                    <button
                                      className="dashboard-card-item-del"
                                      onClick={() => onRemoveFromPlaylist?.(pl.id, sidx)}
                                      title="从歌单移除"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
              )}
              {customPlaylists.length > 0 && (
                <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0 0 16px' }} />
              )}

              <div className="dashboard-list">
                <div className="dashboard-section-header" style={{ marginBottom: 8 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.4)', margin: 0 }}>当前播放队列</h3>
                </div>
                {playlist.length === 0 && (
                  <EmptyGuide
                    icon="♫"
                    title="播放队列还是空的"
                    desc="导入本地音频文件，或搜索 B 站视频直接加入播放"
                    actions={[
                      { label: '导入本地音乐', onClick: onImportFiles, primary: true },
                      { label: '导入文件夹', onClick: onImportFolder },
                      { label: '搜索 B 站', onClick: onOpenPlayer }
                    ]}
                  />
                )}
                {playlist.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`dashboard-list-item ${idx === currentIndex ? 'active' : ''} ${selected.has(idx) ? 'selected' : ''}`}
                    onDoubleClick={() => onPlay(idx)}
                  >
                    <input
                      type="checkbox"
                      className="dashboard-list-checkbox"
                      checked={selected.has(idx)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(idx)}
                    />
                    <span className="dashboard-list-index">{idx + 1}</span>
                    <div
                      className="dashboard-list-cover"
                      style={item.cover ? { backgroundImage: `url(${item.cover})` } : undefined}
                    />
                    <div className="dashboard-list-body">
                      <div className="dashboard-list-title" title={item.name}>
                        {item.name.replace(/\.[^/.]+$/, '')}
                      </div>
                      <div className="dashboard-list-meta">
                        {item.source === 'bilibili' ? 'Bilibili' : '本地文件'}
                      </div>
                    </div>
                    <button
                      className="dashboard-list-play"
                      onClick={(e) => {
                        e.stopPropagation()
                        onPlay(idx)
                      }}
                    >
                      ▶
                    </button>
                    <button
                      className={`dashboard-list-like ${likedIds?.has(item.path) ? 'liked' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleLike?.(item)
                      }}
                      title={likedIds?.has(item.path) ? '取消喜欢' : '喜欢'}
                    >
                      <HeartIcon active={likedIds?.has(item.path)} size={15} />
                    </button>
                    <button
                      className="dashboard-list-addtopl"
                      onClick={(e) => {
                        e.stopPropagation()
                        const rect = e.currentTarget.getBoundingClientRect()
                        setAddPos({ top: rect.bottom + 4, left: rect.right - 240 })
                        setAddTarget(addTarget === idx ? null : idx)
                        setAddListName('')
                      }}
                      title="添加到收藏歌单"
                    >
                      +
                    </button>
                    <button
                      className="dashboard-list-delete"
                      onClick={handleDeleteOne(idx)}
                      title="从歌单移除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="dashboard-content">
            {/* 听歌活跃度概览 */}
            <section className="dashboard-section stats-hero">
              <div className="stats-hero-card">
                <div className="stats-hero-badge" style={{ color: listenerLevel.color }}>
                  <span className="stats-hero-badge-dot" style={{ background: listenerLevel.color }} />
                  <span className="stats-hero-badge-label">{listenerLevel.label}</span>
                </div>
                <div className="stats-hero-title">你的音乐图谱</div>
                <div className="stats-hero-sub">
                  已收录 {playlist.length} 首歌曲 · 累计听歌{' '}
                  {formatDuration(listeningStats.listenedSeconds)}
                </div>
                <div className="stats-hero-bars">
                  <div className="stats-hero-bar">
                    <span className="stats-hero-bar-label">本地</span>
                    <div className="stats-hero-bar-track">
                      <div
                        className="stats-hero-bar-fill local"
                        style={{
                          width: `${(1 - listeningStats.bilibiliRatio) * 100}%`
                        }}
                      />
                    </div>
                    <span className="stats-hero-bar-value">
                      {listeningStats.localCount}
                    </span>
                  </div>
                  <div className="stats-hero-bar">
                    <span className="stats-hero-bar-label">B 站</span>
                    <div className="stats-hero-bar-track">
                      <div
                        className="stats-hero-bar-fill bili"
                        style={{
                          width: `${listeningStats.bilibiliRatio * 100}%`
                        }}
                      />
                    </div>
                    <span className="stats-hero-bar-value">
                      {listeningStats.bilibiliCount}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* 数据概览卡片 */}
            <section className="dashboard-section">
              <div className="dashboard-section-header">
                <h3>听歌概览</h3>
              </div>
              <div className="dashboard-stats">
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">
                    {formatDuration(listeningStats.totalSeconds)}
                  </div>
                  <div className="dashboard-stat-label">累计时长</div>
                </div>
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">
                    {formatDuration(listeningStats.avgDuration)}
                  </div>
                  <div className="dashboard-stat-label">平均曲目时长</div>
                </div>
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">{playlist.length}</div>
                  <div className="dashboard-stat-label">歌曲总数</div>
                </div>
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">
                    {listeningStats.bilibiliCount}
                  </div>
                  <div className="dashboard-stat-label">B 站音频</div>
                </div>
              </div>
            </section>

            {/* 听歌时段分布 */}
            <section className="dashboard-section wide">
              <div className="dashboard-section-header">
                <h3>听歌时段分布</h3>
                <span className="dashboard-count">
                  {playEvents.length > 0
                    ? `高峰期：${timeSlots.reduce((m, s) => (s.value > m.value ? s : m), timeSlots[0]).label}`
                    : '暂无播放记录'}
                </span>
              </div>
              <div className="stats-slots">
                {timeSlots.map((slot) => (
                  <div key={slot.key} className="stats-slot">
                    <div className="stats-slot-bars">
                      <div
                        className="stats-slot-fill"
                        style={{ height: `${slot.value * 100}%` }}
                      />
                    </div>
                    <div className="stats-slot-label">{slot.label}</div>
                    <div className="stats-slot-range">{slot.range}</div>
                    <div className="stats-slot-pct">
                      {(slot.value * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 近 7 日趋势 */}
            <section className="dashboard-section wide">
              <div className="dashboard-section-header">
                <h3>近 7 日听歌时长</h3>
                <span className="dashboard-count">
                  本周累计{' '}
                  {weeklyTrend.reduce((s, d) => s + d.minutes, 0)} 分钟
                </span>
              </div>
              <div className="stats-week">
                {(() => {
                  const maxMin = Math.max(...weeklyTrend.map((d) => d.minutes), 1)
                  return weeklyTrend.map((d) => (
                    <div key={d.day + String(d.isToday)} className="stats-week-col">
                      <div className="stats-week-bars">
                        <div
                          className={`stats-week-fill ${d.isToday ? 'today' : ''}`}
                          style={{ height: `${(d.minutes / maxMin) * 100}%` }}
                        />
                      </div>
                      <div className="stats-week-day">{d.day}</div>
                      <div className="stats-week-min">{d.minutes}分</div>
                    </div>
                  ))
                })()}
              </div>
            </section>

            {/* 常听歌曲排行 */}
            <section className="dashboard-section wide">
              <div className="dashboard-section-header">
                <h3>常听歌曲排行</h3>
              </div>
              <div className="dashboard-chart">
                {topItems.length === 0 && (
                  <EmptyGuide
                    icon="♛"
                    title="还没有播放记录"
                    desc="多听几首就能在这里看到常听歌曲排行"
                    actions={playlist.length === 0 ? [{ label: '导入本地音乐', onClick: onImportFiles, primary: true }] : undefined}
                  />
                )}
                {(() => {
                  const maxPlays = Math.max(...topItems.map((t) => t.plays), 1)
                  return topItems.map(({ item, idx, plays, seconds }, i) => (
                    <div
                      key={item.id}
                      className="dashboard-chart-row"
                      onDoubleClick={() => onPlay(idx)}
                      title="双击播放"
                    >
                      <span className="dashboard-chart-rank">{i + 1}</span>
                      <div
                        className="dashboard-chart-cover"
                        style={item.cover ? { backgroundImage: `url(${item.cover})` } : undefined}
                      />
                      <div className="dashboard-chart-info">
                        <div className="dashboard-chart-title" title={item.name}>
                          {item.name.replace(/\.[^/.]+$/, '')}
                        </div>
                        <div className="dashboard-chart-bar-wrap">
                          <div
                            className="dashboard-chart-bar"
                            style={{ width: `${(plays / maxPlays) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="dashboard-chart-plays">
                        {plays} 次 · {formatDuration(seconds)}
                      </div>
                    </div>
                  ))
                })()}
              </div>
            </section>

            {/* 听歌偏好标签 */}
            <section className="dashboard-section">
              <div className="dashboard-section-header">
                <h3>听歌偏好</h3>
              </div>
              <div className="dashboard-tags stats-tags">
                {preferenceTags.length === 0 && (
                  <div className="dashboard-empty">添加并播放歌曲后将分析你的偏好</div>
                )}
                {preferenceTags.map((tag, i) => (
                  <span
                    key={tag.label}
                    className="stats-tag"
                    style={
                      {
                        '--d': i,
                        fontSize: `${12 + (tag.weight / 100) * 4}px`,
                        opacity: 0.6 + (tag.weight / 100) * 0.4
                      } as React.CSSProperties
                    }
                  >
                    {tag.label}
                    <span className="stats-tag-weight">{tag.weight}%</span>
                  </span>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="dashboard-content">
            <Settings
              downloadDir={downloadDir}
              onDownloadDirChange={onDownloadDirChange || (() => {})}
            />
          </div>
        )}

        {activeTab === 'recommend' && (
          <div className="dashboard-content">
            <section className="dashboard-section stats-hero">
              <div className="stats-hero-card" style={{ background: 'linear-gradient(135deg, rgba(168, 230, 255, 0.08), rgba(0, 245, 212, 0.04))' }}>
                <div className="stats-hero-badge" style={{ color: listenerLevel.color }}>
                  <span className="stats-hero-badge-dot" style={{ background: listenerLevel.color }} />
                  <span className="stats-hero-badge-label">{listenerLevel.label}</span>
                </div>
                <div className="stats-hero-title">为你推荐</div>
                <div className="stats-hero-sub">
                  基于 {playlist.length} 首歌曲 · {listeningStats.totalPlays} 次播放 · {formatDuration(listeningStats.listenedSeconds)} 听歌时长
                </div>
              </div>
            </section>

            {/* 反复聆听 */}
            <section className="dashboard-section">
              <div className="dashboard-section-header">
                <h3>反复聆听</h3>
                <span className="dashboard-count">播放最多</span>
              </div>
              {replayItems.length === 0 ? (
                <EmptyGuide
                  icon="♻"
                  title="反复聆听区域还空着"
                  desc="多听几首歌，这里会推荐你最爱的曲目"
                  actions={playlist.length === 0 ? [{ label: '导入本地音乐', onClick: onImportFiles, primary: true }] : undefined}
                />
              ) : (
                <div className="dashboard-cards">
                  {replayItems.map(({ item, idx, plays }, i) => (
                    <div
                      key={item.id}
                      className="dashboard-card"
                      onDoubleClick={() => onPlay(idx)}
                      title="双击播放"
                    >
                      <div className="dashboard-card-cover"
                        style={item.cover ? { backgroundImage: `url(${item.cover})` } : undefined}
                      />
                      <div className="dashboard-card-body">
                        <div className="dashboard-card-title" title={item.name}>
                          {item.name.replace(/\.[^/.]+$/, '')}
                        </div>
                        <div className="dashboard-card-meta">
                          {plays} 次播放
                        </div>
                      </div>
                      <span className="recommend-rank" style={{ color: i < 3 ? '#00f5d4' : 'rgba(255,255,255,0.3)' }}>
                        #{i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* B站每日推荐 */}
            <section className="dashboard-section">
              <div className="dashboard-section-header">
                <h3>B站每日推荐</h3>
                <span className="dashboard-count">根据你的收藏生成</span>
              </div>
              {recsLoading ? (
                <div className="dashboard-cards">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="dashboard-card dashboard-card-skeleton">
                      <div className="dashboard-card-cover skeleton-pulse" />
                      <div className="dashboard-card-body">
                        <div className="skeleton-line" style={{ width: '80%', height: 13, marginBottom: 6 }} />
                        <div className="skeleton-line" style={{ width: '50%', height: 11 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recsError ? (
                <div className="dashboard-empty" style={{ padding: '24px 0' }}>
                  <p>{recsError}</p>
                  <button
                    className="dashboard-btn-ghost"
                    onClick={recsRefresh}
                    style={{ marginTop: 8, color: '#00f5d4', cursor: 'pointer', background: 'none', border: '1px solid rgba(0,245,212,0.3)', padding: '6px 16px', borderRadius: 8 }}
                  >
                    重试
                  </button>
                </div>
              ) : dailyRecs.length === 0 ? (
                <EmptyGuide
                  icon="✦"
                  title="B站每日推荐待生成"
                  desc="收藏一些歌曲到歌单后，这里会为你推荐 B 站歌曲"
                  actions={customPlaylists.length === 0 && playlist.length === 0 ? [
                    { label: '导入本地音乐', onClick: onImportFiles, primary: true },
                    { label: '搜索 B 站', onClick: onOpenPlayer }
                  ] : undefined}
                />
              ) : (
                <div className="dashboard-cards">
                  {dailyRecs.map((item) => (
                    <div
                      key={item.bvid}
                      className="dashboard-card"
                      onDoubleClick={() => onPlayBilibili(item)}
                      title="双击播放"
                    >
                      <div
                        className="dashboard-card-cover"
                        style={{ backgroundImage: `url(${item.pic})` }}
                      />
                      <div className="dashboard-card-body">
                        <div className="dashboard-card-title" title={item.title}>
                          {item.title}
                        </div>
                        <div className="dashboard-card-meta">
                          {item.author} · B站推荐
                        </div>
                      </div>
                      <button
                        className="dashboard-card-dl"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownload(item.bvid, item.title)
                        }}
                        title="下载音频"
                      >
                        ⬇
                      </button>
                      <button
                        className="dashboard-card-play"
                        onClick={(e) => {
                          e.stopPropagation()
                          onPlayBilibili(item)
                        }}
                        title="立即播放"
                      >
                        ▶
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 你的口味标签 */}
            {preferenceTags.length > 0 && (
              <section className="dashboard-section">
                <div className="dashboard-section-header">
                  <h3>你的音乐口味</h3>
                </div>
                <div className="dashboard-tags stats-tags" style={{ paddingBottom: 20 }}>
                  {preferenceTags.map((tag, i) => (
                    <span key={tag.label} className="stats-tag"
                      style={{ '--d': i, fontSize: `${14 + (tag.weight / 100) * 6}px`, opacity: 0.65 + (tag.weight / 100) * 0.35 } as React.CSSProperties}>
                      {tag.label}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* 播放队列添加到歌单弹窗（fixed 定位） */}
      {addTarget != null && addPos && playlist[addTarget] && (
        <div
          className="search-collect-popup-fixed"
          style={{ top: addPos.top, left: addPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="scp-header">添加到歌单</div>
          <div className="scp-list">
            {customPlaylists.length === 0 ? (
              <div className="scp-empty">暂无歌单</div>
            ) : (
              customPlaylists.map((pl) => (
                <button key={pl.id} className="scp-item" onClick={(e) => {
                  e.stopPropagation()
                  onAddToPlaylist?.(pl.id, {
                    source: playlist[addTarget].source,
                    path: playlist[addTarget].path,
                    name: playlist[addTarget].name,
                    cover: playlist[addTarget].cover
                  })
                  setAddTarget(null)
                  setAddPos(null)
                }}>
                  <span className="scp-item-name">{pl.name}</span>
                  <span className="scp-item-count">{pl.items.length}</span>
                </button>
              ))
            )}
          </div>
          <div className="scp-create">
            <input className="scp-input" type="text" placeholder="新建歌单" value={addListName}
              onChange={(e) => setAddListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && addListName.trim()) {
                  e.stopPropagation()
                  const id = onCreatePlaylist?.(addListName) || ''
                  if (id) onAddToPlaylist?.(id, {
                    source: playlist[addTarget].source, path: playlist[addTarget].path, name: playlist[addTarget].name, cover: playlist[addTarget].cover
                  })
                  setAddTarget(null)
                  setAddPos(null)
                  setAddListName('')
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <button className="scp-create-btn" disabled={!addListName.trim()}
              onClick={(e) => {
                e.stopPropagation()
                if (!addListName.trim()) return
                const id = onCreatePlaylist?.(addListName) || ''
                if (id) onAddToPlaylist?.(id, {
                  source: playlist[addTarget].source, path: playlist[addTarget].path, name: playlist[addTarget].name, cover: playlist[addTarget].cover
                })
                setAddTarget(null)
                setAddPos(null)
                setAddListName('')
              }}>
              <PlusIcon size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(MainInterface)
