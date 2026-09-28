import { useState, useRef, useCallback, useEffect } from 'react'
import Player from './components/Player'
import Playlist from './components/Playlist'
import Visualizer from './components/Visualizer'
import LockScreen from './components/LockScreen'
import SplashScreen from './components/SplashScreen'
import MainInterface from './components/MainInterface'
import HomeView, { HomeNavTab } from './components/HomeView'
import TitleBar from './components/TitleBar'
import LyricsSearchModal from './components/LyricsSearchModal'
import { useIdleTimer } from './hooks/useIdleTimer'
import { MediaItem, PlayMode, BilibiliSearchResult, SavedMediaItem, ReverbPreset, CustomPlaylist } from './types'
import { getMimeType, generateId, cleanSongKeyword } from './utils'
import { parseLrc, LrcLine } from './utils/lrc'
import { keywordStyle, analyzeAudio, audioStyleTag } from './utils/audioStyle'
import { toast, toastError, toastSuccess } from './utils/toast'
import './styles/index.css'

const PLAYLIST_STORAGE_KEY = 'mineradio3d-playlist'
const PLAYLIST_STATE_KEY = 'mineradio3d-playlist-state'
const LEGACY_PATHS_KEY = 'mineradio3d-playlist-paths'
const VOLUME_STORAGE_KEY = 'mineradio3d-volume'
const PLAY_STATS_STORAGE_KEY = 'mineradio3d-playstats'
const PLAY_EVENTS_STORAGE_KEY = 'mineradio3d-playevents'
const PLAY_EVENTS_CAP = 2000
const REVERB_STORAGE_KEY = 'mineradio3d-reverb'
const DOWNLOAD_DIR_STORAGE_KEY = 'mineradio3d-download-dir'
const CUSTOM_PLAYLISTS_STORAGE_KEY = 'mineradio3d-custom-playlists'
const LIKED_STORAGE_KEY = 'mineradio3d-liked'
const LYRICS_CACHE_KEY = 'mineradio3d-lyrics-cache'
const LYRICS_OFFSET_KEY = 'mineradio3d-lyrics-offset'
const PLAY_MODE_KEY = 'mineradio3d-play-mode'
const PLAYBACK_RATE_KEY = 'mineradio3d-playback-rate'
const EQ_STORAGE_KEY = 'mineradio3d-eq'
const CROSSFADE_KEY = 'mineradio3d-crossfade'

// 存储 schema 版本：结构变更时递增并实现对应迁移，避免旧数据静默损坏
const STORAGE_VERSION_KEY = 'mineradio3d-storage-version'
const STORAGE_VERSION = 1

function migrateStoredData(): void {
  let current = 0
  try {
    current = Number(localStorage.getItem(STORAGE_VERSION_KEY)) || 0
  } catch {
    /* ignore */
  }
  if (current >= STORAGE_VERSION) return

  // v0 -> v1：历史上遗留的“路径型歌单”已由 mineradio3d-playlist 覆盖，
  // 直接清除旧 key，避免两份数据并存造成困惑。
  if (current < 1) {
    try {
      localStorage.removeItem(LEGACY_PATHS_KEY)
    } catch {
      /* ignore */
    }
  }

  try {
    localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION))
  } catch {
    /* ignore */
  }
}

migrateStoredData()

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const CROSSFADE_SECONDS = 1.2

// 混响参数：Reverb Time=2800ms / Diffusion=92% / Decay=42% / Brightness=18% / Dry Out=22% / Wet Out=78%
const REVERB_CONFIG = {
  duration: 2.8,       // Reverb Time 2800ms
  decay: 2.15,         // 衰减指数：Decay 42%
  diffusion: 0.92,     // Diffusion 92%
  bright: 0.18,        // Brightness 18%
  dry: 0.22,           // Dry Out 22%
  wet: 0.78,           // Wet Out 78%
}

// 程序化生成混响冲击响应（立体声白噪声 + 指数衰减），无需外部 IR 文件即可工作
function createImpulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / length
      const env = Math.pow(1 - t, decay)
      data[i] = (Math.random() * 2 - 1) * env
    }
  }
  return impulse
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

function App() {
  const [playlist, setPlaylist] = useState<MediaItem[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playMode, setPlayMode] = useState<PlayMode>(() => {
    try {
      const saved = localStorage.getItem(PLAY_MODE_KEY)
      if (saved === 'sequential' || saved === 'list-loop' || saved === 'single-loop' || saved === 'random') {
        return saved
      }
    } catch {
      /* ignore */
    }
    return 'list-loop'
  })
  const [playbackRate, setPlaybackRate] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(PLAYBACK_RATE_KEY))
      if ((PLAYBACK_RATES as readonly number[]).includes(saved)) return saved
    } catch {
      /* ignore */
    }
    return 1
  })
  const [eqBass, setEqBass] = useState(() => {
    try {
      const raw = localStorage.getItem(EQ_STORAGE_KEY)
      const p = raw ? JSON.parse(raw) : null
      if (p && typeof p.bass === 'number') return Math.max(-15, Math.min(15, p.bass))
    } catch {
      /* ignore */
    }
    return 0
  })
  const [eqTreble, setEqTreble] = useState(() => {
    try {
      const raw = localStorage.getItem(EQ_STORAGE_KEY)
      const p = raw ? JSON.parse(raw) : null
      if (p && typeof p.treble === 'number') return Math.max(-15, Math.min(15, p.treble))
    } catch {
      /* ignore */
    }
    return 0
  })
  const [crossfade, setCrossfade] = useState(() => {
    try {
      return localStorage.getItem(CROSSFADE_KEY) === 'on'
    } catch {
      return false
    }
  })
  const eqBassRef = useRef(eqBass)
  eqBassRef.current = eqBass
  const eqTrebleRef = useRef(eqTreble)
  eqTrebleRef.current = eqTreble
  const crossfadeRef = useRef(crossfade)
  crossfadeRef.current = crossfade
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem(VOLUME_STORAGE_KEY)
      if (saved !== null) {
        const v = Number(saved)
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
      }
    } catch {
      /* ignore */
    }
    return 1
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [splashDone, setSplashDone] = useState(false)
  const [splashExiting, setSplashExiting] = useState(false)
  const [view, setView] = useState<'dashboard' | 'player'>('dashboard')
  // 顶层画面：home = 新主界面（菜单屏）；app = 原有软件（dashboard / player）
  const [screen, setScreen] = useState<'home' | 'app'>('home')
  const [activeTab, setActiveTab] = useState<HomeNavTab>('home')
  const [showFullscreenHint, setShowFullscreenHint] = useState(false)
  const [reverbPreset, setReverbPreset] = useState<ReverbPreset>(() => {
    try {
      const saved = localStorage.getItem(REVERB_STORAGE_KEY)
      return saved === 'on' || saved === 'off' ? saved : 'off'
    } catch {
      return 'off'
    }
  })
  const [downloadDir, setDownloadDir] = useState(() => {
    try {
      return localStorage.getItem(DOWNLOAD_DIR_STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })
  // 自定义歌单
  const [customPlaylists, setCustomPlaylists] = useState<CustomPlaylist[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_PLAYLISTS_STORAGE_KEY)
      const p = raw ? JSON.parse(raw) : []
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  })
  // 喜欢的歌曲（按 path 持久化：本地为文件路径，B 站为 BV 号）
  const [likedIds, setLikedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LIKED_STORAGE_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? new Set(arr) : new Set()
    } catch {
      return new Set()
    }
  })
  // 播放器右侧队列面板开关
  const [queueOpen, setQueueOpen] = useState(true)
  // LRC 歌词
  const [lyricsLines, setLyricsLines] = useState<LrcLine[]>([])
  const [lyricsVisible, setLyricsVisible] = useState(true)
  const [lyricOffset, setLyricOffset] = useState(0)
  const [lyricsSearchOpen, setLyricsSearchOpen] = useState(false)

  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null)
  const playlistRef = useRef<MediaItem[]>(playlist)
  playlistRef.current = playlist
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const hasRestoredRef = useRef(false)
  const pendingPlayRef = useRef(false)
  const streamRetryRef = useRef<{ id: string; tries: number; alerted: boolean }>({
    id: '',
    tries: 0,
    alerted: false
  })

  // 真实听歌统计：每首歌的播放次数 / 累计听歌秒数 / 上次播放时间
  const [playStats, setPlayStats] = useState<Record<string, SongStat>>(() => {
    try {
      const raw = localStorage.getItem(PLAY_STATS_STORAGE_KEY)
      const p = raw ? JSON.parse(raw) : {}
      return p && typeof p === 'object' ? p : {}
    } catch {
      return {}
    }
  })
  // 播放事件流（带时间戳），用于听歌时段、近期趋势分析
  const [playEvents, setPlayEvents] = useState<PlayEvent[]>(() => {
    try {
      const raw = localStorage.getItem(PLAY_EVENTS_STORAGE_KEY)
      const e = raw ? JSON.parse(raw) : []
      return Array.isArray(e) ? e : []
    } catch {
      return []
    }
  })

  const prevTimeRef = useRef(0)
  const prevAccumIdRef = useRef('')
  const lastCountedIdRef = useRef('')
  const secondsFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 待合并的听歌秒数（ref 累积，定时器低频写入 state）
  const pendingSecondsRef = useRef<Record<string, number>>({})

  // 歌曲风格标签：关键词 + 音频特征分析，结果按歌曲缓存
  const [styleTag, setStyleTag] = useState('')
  const styleCacheRef = useRef<Record<string, string>>({})
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 音频分析链路持久化：切换界面时不打断播放
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataArrayRef = useRef<Uint8Array | null>(null)
  const connectedMediaRef = useRef<HTMLMediaElement | null>(null)
  // 混响链路：source -> dryGain -> destination；source -> convolver -> brightness(lowpass) -> wetGain -> destination
  const convolverRef = useRef<ConvolverNode | null>(null)
  const dryGainRef = useRef<GainNode | null>(null)
  const wetGainRef = useRef<GainNode | null>(null)
  const brightnessRef = useRef<BiquadFilterNode | null>(null)
  // EQ 链路：source -> bass(lowshelf) -> treble(highshelf) -> 后续所有分支
  const bassRef = useRef<BiquadFilterNode | null>(null)
  const trebleRef = useRef<BiquadFilterNode | null>(null)
  // 跨曲淡入淡出：source -> fadeGain -> 后续所有分支
  const fadeGainRef = useRef<GainNode | null>(null)
  const fadeInPendingRef = useRef(false)

  const currentItem =
    currentIndex >= 0 && currentIndex < playlist.length ? playlist[currentIndex] : null
  const isIdle = useIdleTimer(3000)

  const addFiles = useCallback(async (filePaths: string[]) => {
    const items: MediaItem[] = []
    const failedPaths: string[] = []
    for (const fp of filePaths) {
      try {
        const data = await window.electronAPI.statFile(fp)
        if (!data.exists) {
          failedPaths.push(fp)
          continue
        }
        items.push({
          id: fp,
          path: fp,
          name: data.name,
          size: data.size,
          url: data.url,
          source: 'local'
        })
      } catch (e) {
        console.error('Failed to stat file:', fp, e)
        failedPaths.push(fp)
      }
    }
    if (items.length > 0) {
      setPlaylist((prev) => {
        const existingPaths = new Set(prev.map((item) => item.path))
        const newItems = items.filter((item) => !existingPaths.has(item.path))
        return [...prev, ...newItems]
      })
    }
    return { failedPaths }
  }, [])

  const handleImportFiles = async () => {
    const filePaths = await window.electronAPI.openFiles()
    if (filePaths.length > 0) await addFiles(filePaths)
  }

  const handleImportFolder = async () => {
    const filePaths = await window.electronAPI.openFolder()
    if (filePaths.length > 0) await addFiles(filePaths)
  }

  // 导出当前播放列表为 m3u（本地文件写路径，B 站写扩展指令行）
  const handleExportM3u = useCallback(async () => {
    if (playlistRef.current.length === 0) {
      toastError('播放列表为空，无法导出')
      return
    }
    const lines = ['#EXTM3U']
    for (const item of playlistRef.current) {
      if (item.source === 'local') {
        lines.push(item.path)
      } else if (item.bvid) {
        lines.push(`#MR3D-BILI ${item.bvid} ${item.name}`)
      }
    }
    const res = await window.electronAPI.saveTextFile({
      defaultName: 'mineradio3d-playlist.m3u',
      content: lines.join('\r\n')
    })
    if (res.success) {
      toastSuccess(`已导出到：${res.filePath}`)
    } else if (res.error) {
      toastError(`导出失败：${res.error}`)
    }
  }, [])

  // 导入 m3u：本地路径经存在性校验后加入，B 站扩展行按 bvid 加入
  const handleImportM3u = useCallback(async () => {
    const filePath = await window.electronAPI.openM3uFile()
    if (!filePath) return
    const res = await window.electronAPI.readM3uFile(filePath)
    if (!res.success || !res.text) {
      toastError('导入失败：无法读取文件')
      return
    }
    const lines = res.text.split(/\r?\n/)
    const localPaths: string[] = []
    const biliItems: { bvid: string; name: string }[] = []
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      if (line.startsWith('#MR3D-BILI ')) {
        const rest = line.slice('#MR3D-BILI '.length)
        const sp = rest.indexOf(' ')
        const bvid = sp >= 0 ? rest.slice(0, sp) : rest
        const name = sp >= 0 ? rest.slice(sp + 1).trim() : bvid
        if (bvid) biliItems.push({ bvid, name: name || bvid })
      } else if (!line.startsWith('#')) {
        localPaths.push(line)
      }
    }
    let addedLocal = 0
    if (localPaths.length > 0) {
      const { failedPaths } = await addFiles(localPaths)
      addedLocal = localPaths.length - failedPaths.length
    }
    let addedBili = 0
    for (const b of biliItems) {
      if (playlistRef.current.some((i) => i.source === 'bilibili' && i.bvid === b.bvid)) continue
      const newItem: MediaItem = {
        id: b.bvid,
        path: b.bvid,
        name: b.name,
        size: 0,
        url: '',
        source: 'bilibili',
        bvid: b.bvid
      }
      setPlaylist((prev) =>
        prev.some((i) => i.source === 'bilibili' && i.bvid === b.bvid) ? prev : [...prev, newItem]
      )
      addedBili++
    }
    if (addedLocal === 0 && addedBili === 0) {
      toastError('未导入任何歌曲（文件可能不存在或已在列表中）')
    } else {
      toastSuccess(`导入完成：本地 ${addedLocal} 首，B 站 ${addedBili} 首`)
    }
  }, [addFiles])

  const ensureBilibiliAudio = useCallback(async (item: MediaItem) => {
    if (item.source !== 'bilibili') return item
    const audio = await window.electronAPI.getBilibiliAudio(item.bvid!, item.name)
    const updated: MediaItem = {
      ...item,
      url: audio.url,
      backups: audio.backups || [],
      bitrate: audio.bitrate || 0,
      name: audio.title || item.name
    }
    setPlaylist((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
    return updated
  }, [])

  // 跨曲淡入淡出：切换前把当前音频平滑淡出（仅在播放中且启用时生效）
  const fadeOutForSwitch = useCallback(async () => {
    if (!crossfadeRef.current) return
    if (!isPlayingRef.current) return
    const ctx = audioContextRef.current
    const g = fadeGainRef.current
    if (!ctx || !g) return
    const now = ctx.currentTime
    g.gain.cancelScheduledValues(now)
    g.gain.setValueAtTime(g.gain.value, now)
    g.gain.linearRampToValueAtTime(0.0001, now + CROSSFADE_SECONDS)
    fadeInPendingRef.current = true
    await new Promise((r) => setTimeout(r, CROSSFADE_SECONDS * 1000))
  }, [])

  // 新曲开始播放时淡入（由媒体元素 onPlay 触发）
  const fadeIn = useCallback(() => {
    if (!fadeInPendingRef.current) return
    fadeInPendingRef.current = false
    const ctx = audioContextRef.current
    const g = fadeGainRef.current
    if (!ctx || !g) return
    const now = ctx.currentTime
    g.gain.cancelScheduledValues(now)
    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(1, now + CROSSFADE_SECONDS * 0.6)
  }, [])

  const handlePlay = useCallback(
    async (index: number) => {
      const item = playlistRef.current[index]
      if (!item) return
      streamRetryRef.current.id = ''
      streamRetryRef.current.tries = 0
      streamRetryRef.current.alerted = false
      if (item.source === 'bilibili') {
        try {
          await ensureBilibiliAudio(item)
        } catch (err) {
          console.error('Bilibili play failed:', err)
          toastError(err instanceof Error ? err.message : '播放失败')
          return
        }
      }
      await fadeOutForSwitch()
      setCurrentIndex(index)
      setIsPlaying(true)
      setView('player')
    },
    [ensureBilibiliAudio, fadeOutForSwitch]
  )

  const togglePlay = useCallback(() => {
    if (!mediaRef.current) return
    if (isPlaying) {
      mediaRef.current.pause()
      setIsPlaying(false)
    } else {
      mediaRef.current.play().catch(() => {
        setIsPlaying(false)
      })
      setIsPlaying(true)
    }
  }, [isPlaying])

  const handleNext = useCallback(
    async (loopOnce = false) => {
      if (playlistRef.current.length === 0) return
      let next = currentIndex
      if (next < 0 || next >= playlistRef.current.length) next = 0
      if (playMode === 'single-loop' && !loopOnce) {
        next = currentIndex
      } else if (playMode === 'random') {
        if (playlistRef.current.length > 1) {
          let candidate = Math.floor(Math.random() * playlistRef.current.length)
          if (candidate === currentIndex) {
            candidate = (candidate + 1) % playlistRef.current.length
          }
          next = candidate
        } else {
          next = currentIndex
        }
      } else {
        next = currentIndex + 1
        if (next >= playlistRef.current.length) {
          next = playMode === 'list-loop' ? 0 : currentIndex
        }
      }
      if (next !== currentIndex || playMode === 'single-loop' || loopOnce) {
        const item = playlistRef.current[next]
        if (item?.source === 'bilibili') {
          try {
            await ensureBilibiliAudio(item)
          } catch (err) {
            console.error('Bilibili next failed:', err)
            toastError(err instanceof Error ? err.message : '播放失败')
            return
          }
        }
        await fadeOutForSwitch()
        setCurrentIndex(next)
        setIsPlaying(true)
      }
    },
    [currentIndex, playMode, ensureBilibiliAudio, fadeOutForSwitch]
  )

  const handlePrev = useCallback(
    async (loopOnce = false) => {
      if (playlistRef.current.length === 0) return
      const base = currentIndex >= 0 && currentIndex < playlistRef.current.length ? currentIndex : 0
      let prev = base - 1
      if (prev < 0) prev = playlistRef.current.length - 1
      const item = playlistRef.current[prev]
      if (item?.source === 'bilibili') {
        try {
          await ensureBilibiliAudio(item)
        } catch (err) {
          console.error('Bilibili prev failed:', err)
          toastError(err instanceof Error ? err.message : '播放失败')
          return
        }
      }
      await fadeOutForSwitch()
      setCurrentIndex(prev)
      setIsPlaying(true)
    },
    [currentIndex, ensureBilibiliAudio, fadeOutForSwitch]
  )

  // 歌单删除后同步清理对应的统计与事件（须在 handleDelete 等之前定义）
  const removeStatsForIds = useCallback((ids: string[]) => {
    const idSet = new Set(ids)
    if (idSet.size === 0) return
    setPlayStats((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of idSet) {
        if (next[id]) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
    setPlayEvents((prev) => prev.filter((e) => !idSet.has(e.id)))
  }, [])

  // 删除单首歌曲。删除当前正在播放的歌曲时，自动跳到下一首继续播放。
  const handleDelete = useCallback((index: number) => {
    const removedItem = playlistRef.current[index]
    if (removedItem) removeStatsForIds([removedItem.id])
    setPlaylist((prev) => {
      if (index < 0 || index >= prev.length) return prev
      const newList = [...prev]
      newList.splice(index, 1)
      return newList
    })
    setCurrentIndex((prevCur) => {
      if (prevCur === index) {
        // 被删除的是当前歌曲：指针指向「下一首」；若删的是最后一首则落到 -1（列表已空或指针回退）
        const newLen = playlistRef.current.length - 1
        if (newLen <= 0) return -1
        return prevCur >= newLen ? newLen - 1 : prevCur
      }
      if (index < prevCur) return prevCur - 1
      return prevCur
    })
    if (index === currentIndex) {
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
    }
  }, [currentIndex, removeStatsForIds])

  // 批量删除多首歌曲（按索引或按 id）。
  const handleDeleteMany = useCallback(
    (targets: number[] | string[]) => {
      const targetSet = new Set(targets)
      const removedIds = playlistRef.current
        .filter((item, idx) => targetSet.has(idx) || targetSet.has(item.id))
        .map((item) => item.id)
      removeStatsForIds(removedIds)
      setPlaylist((prev) => {
        const newList = prev.filter((item, idx) => {
          const hit = targetSet.has(idx) || targetSet.has(item.id)
          return !hit
        })
        // 重新计算 currentIndex：统计在当前歌曲之前被删除的数量
        setCurrentIndex((prevCur) => {
          if (prevCur < 0) return -1
          let removedBefore = 0
          let currentRemoved = false
          prev.forEach((item, idx) => {
            const hit = targetSet.has(idx) || targetSet.has(item.id)
            if (hit) {
              if (idx < prevCur) removedBefore++
              else if (idx === prevCur) currentRemoved = true
            }
          })
          if (currentRemoved) {
            setIsPlaying(false)
            setCurrentTime(0)
            setDuration(0)
            const shifted = prevCur - removedBefore // 落到原来的下一首
            return shifted >= newList.length ? newList.length - 1 : shifted
          }
          return prevCur - removedBefore
        })
        return newList
      })
    },
    []
  )

  // 清空整个歌单
  const handleClearAll = useCallback(() => {
    const ids = playlistRef.current.map((i) => i.id)
    setPlaylist(() => [])
    removeStatsForIds(ids)
    setCurrentIndex(-1)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [removeStatsForIds])

  // 调节音量 (0-1)，同时应用到当前媒体元素并持久化
  const handleVolumeChange = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v))
    setVolume(clamped)
    if (mediaRef.current) mediaRef.current.volume = clamped
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  // 切换混响：off / on
  const handleReverbToggle = useCallback(() => {
    setReverbPreset((prev) => (prev === 'off' ? 'on' : 'off'))
  }, [])

  // 播放速度：应用到当前媒体元素并持久化
  const handlePlaybackRateChange = useCallback((rate: number) => {
    const clamped = Math.min(2, Math.max(0.5, rate))
    setPlaybackRate(clamped)
    if (mediaRef.current) mediaRef.current.playbackRate = clamped
    try {
      localStorage.setItem(PLAYBACK_RATE_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  // EQ：低音/高音增益（dB，-15~15），实时应用并持久化
  const handleEqChange = useCallback((bass: number, treble: number) => {
    const b = Math.max(-15, Math.min(15, bass))
    const t = Math.max(-15, Math.min(15, treble))
    setEqBass(b)
    setEqTreble(t)
    if (bassRef.current) bassRef.current.gain.value = b
    if (trebleRef.current) trebleRef.current.gain.value = t
    try {
      localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify({ bass: b, treble: t }))
    } catch {
      /* ignore */
    }
  }, [])

  // 跨曲淡入淡出开关（持久化）
  const handleCrossfadeToggle = useCallback(() => {
    setCrossfade((prev) => {
      const next = !prev
      try {
        localStorage.setItem(CROSSFADE_KEY, next ? 'on' : 'off')
      } catch {
        /* ignore */
      }
      if (!next) {
        // 关闭时立即恢复满音量，避免残留在淡出中途
        fadeInPendingRef.current = false
        const ctx = audioContextRef.current
        const g = fadeGainRef.current
        if (ctx && g) {
          g.gain.cancelScheduledValues(ctx.currentTime)
          g.gain.setValueAtTime(1, ctx.currentTime)
        }
      }
      return next
    })
  }, [])

  // 下载目录
  const handleDownloadDirChange = useCallback((dir: string) => {
    setDownloadDir(dir)
    try {
      localStorage.setItem(DOWNLOAD_DIR_STORAGE_KEY, dir)
    } catch { /* ignore */ }
  }, [])

  // 自定义歌单 CRUD
  const handleCreatePlaylist = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return ''
    const id = generateId()
    setCustomPlaylists((prev) => [...prev, { id, name: trimmed, items: [], createdAt: Date.now() }])
    return id
  }, [])

  const handleDeletePlaylist = useCallback((id: string) => {
    setCustomPlaylists((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const handleAddToPlaylist = useCallback((playlistId: string, item: SavedMediaItem) => {
    setCustomPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p
        if (p.items.some((i) => i.path === item.path && i.source === item.source)) return p
        return { ...p, items: [...p.items, item] }
      })
    )
  }, [])

  const handleRemoveFromPlaylist = useCallback((playlistId: string, itemIndex: number) => {
    setCustomPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p
        const next = [...p.items]
        next.splice(itemIndex, 1)
        return { ...p, items: next }
      })
    )
  }, [])

  // 喜欢/取消喜欢
  const handleToggleLike = useCallback((item: MediaItem) => {
    setLikedIds((prev) => {
      const next = new Set(prev)
      if (next.has(item.path)) next.delete(item.path)
      else next.add(item.path)
      return next
    })
  }, [])

  // 持久化喜欢列表
  useEffect(() => {
    try {
      localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify([...likedIds]))
    } catch { /* ignore */ }
  }, [likedIds])

  // 持久化自定义歌单
  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_PLAYLISTS_STORAGE_KEY, JSON.stringify(customPlaylists))
    } catch { /* ignore */ }
  }, [customPlaylists])

  // 记录一次播放：播放次数 +1、记录时间戳、追加事件流
  const recordPlay = useCallback((id: string) => {
    const ts = Date.now()
    setPlayStats((prev) => {
      const s = prev[id]
      return {
        ...prev,
        [id]: { plays: (s?.plays || 0) + 1, seconds: s?.seconds || 0, lastPlayed: ts }
      }
    })
    setPlayEvents((prev) => {
      const next = [...prev, { id, ts }]
      return next.length > PLAY_EVENTS_CAP ? next.slice(-PLAY_EVENTS_CAP) : next
    })
  }, [])

  // 播放进度更新：同时累计真实听歌秒数（跳转不计）
  const handleTimeUpdate = useCallback(
    (t: number) => {
      setCurrentTime(t)
      const item = playlistRef.current[currentIndex]
      if (!item) return
      const id = item.id
      if (prevAccumIdRef.current !== id) {
        prevAccumIdRef.current = id
        prevTimeRef.current = t
        return
      }
      const delta = t - prevTimeRef.current
      prevTimeRef.current = t
      // 秒数先累加到 ref，由定时器低频合并进 state，避免 4Hz 触发全局重渲染
      if (delta > 0 && delta < 3) {
        pendingSecondsRef.current[id] = (pendingSecondsRef.current[id] || 0) + delta
      }
    },
    [currentIndex]
  )

  const handleEnded = () => {
    if (playMode === 'single-loop') {
      if (mediaRef.current) {
        mediaRef.current.currentTime = 0
        setCurrentTime(0)
        mediaRef.current.play().catch(() => {})
      }
    } else {
      handleNext()
    }
  }

  // 持久化播放列表（本地路径 + B 站 bvid / 标题 / 封面）
  useEffect(() => {
    if (!hasRestoredRef.current) return
    const saved: SavedMediaItem[] = playlist.map((item) => ({
      source: item.source,
      path: item.path,
      name: item.name,
      size: item.size,
      cover: item.cover
    }))
    try {
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(saved))
    } catch {
      /* 配额满等异常时静默忽略，避免阻塞播放 */
    }
  }, [playlist])

  // 持久化当前播放位置与播放状态
  useEffect(() => {
    if (!hasRestoredRef.current) return
    try {
      localStorage.setItem(PLAYLIST_STATE_KEY, JSON.stringify({ currentIndex, isPlaying }))
    } catch {
      /* ignore */
    }
  }, [currentIndex, isPlaying])

  // 当一首「新」歌曲真正开始播放时，记录一次播放事件
  useEffect(() => {
    if (!isPlaying || !currentItem) return
    const id = currentItem.id
    if (lastCountedIdRef.current !== id) {
      lastCountedIdRef.current = id
      recordPlay(id)
    }
  }, [isPlaying, currentItem, recordPlay])

  // 持久化听歌统计与事件流（防抖，避免高频写盘）
  useEffect(() => {
    if (!hasRestoredRef.current) return
    if (secondsFlushRef.current) clearTimeout(secondsFlushRef.current)
    secondsFlushRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PLAY_STATS_STORAGE_KEY, JSON.stringify(playStats))
        localStorage.setItem(PLAY_EVENTS_STORAGE_KEY, JSON.stringify(playEvents))
      } catch {
        /* ignore */
      }
    }, 1200)
  }, [playStats, playEvents])

  // 每 3 秒把 ref 中累积的听歌秒数合并进统计 state（低频写入，降低重渲染）
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = pendingSecondsRef.current
      const ids = Object.keys(pending)
      if (ids.length === 0) return
      pendingSecondsRef.current = {}
      setPlayStats((prev) => {
        let changed = false
        const next = { ...prev }
        for (const id of ids) {
          const s = next[id]
          if (!s) continue
          next[id] = { ...s, seconds: s.seconds + pending[id] }
          changed = true
        }
        return changed ? next : prev
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  // 关闭窗口前把未合并的听歌秒数落盘，避免丢失
  useEffect(() => {
    const handler = () => {
      const pending = pendingSecondsRef.current
      const ids = Object.keys(pending)
      if (ids.length === 0) return
      try {
        const raw = localStorage.getItem(PLAY_STATS_STORAGE_KEY)
        const stats: Record<string, SongStat> = raw ? JSON.parse(raw) : {}
        for (const id of ids) {
          const s = stats[id]
          if (s) stats[id] = { ...s, seconds: s.seconds + pending[id] }
        }
        localStorage.setItem(PLAY_STATS_STORAGE_KEY, JSON.stringify(stats))
        pendingSecondsRef.current = {}
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // 启动时恢复播放列表
  const restorePlaylist = useCallback(async () => {
    const raw = localStorage.getItem(PLAYLIST_STORAGE_KEY)
    let savedItems: SavedMediaItem[] = []

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SavedMediaItem[]
        savedItems = Array.isArray(parsed) ? parsed : []
      } catch {
        savedItems = []
      }
    } else {
      // 兼容旧版：仅保存了本地路径数组
      const legacy = localStorage.getItem(LEGACY_PATHS_KEY)
      if (legacy) {
        try {
          const paths = JSON.parse(legacy) as string[]
          savedItems = Array.isArray(paths)
            ? paths.map((p) => ({
                source: 'local' as const,
                path: p,
                name: p.split(/[\\/]/).pop() || p
              }))
            : []
          localStorage.removeItem(LEGACY_PATHS_KEY)
        } catch {
          savedItems = []
        }
      }
    }

    const savedStateRaw = localStorage.getItem(PLAYLIST_STATE_KEY)
    let savedIndex = -1
    let savedPlaying = false
    if (savedStateRaw) {
      try {
        const savedState = JSON.parse(savedStateRaw) as { currentIndex?: number; isPlaying?: boolean }
        savedIndex = typeof savedState.currentIndex === 'number' ? savedState.currentIndex : -1
        savedPlaying = savedState.isPlaying === true
      } catch {
        savedIndex = -1
        savedPlaying = false
      }
    }

    const restored: MediaItem[] = []
    let restoredIndex = -1

    for (let i = 0; i < savedItems.length; i++) {
      const target = savedItems[i]
      if (target.source === 'local') {
        try {
          const data = await window.electronAPI.statFile(target.path)
          if (!data.exists) continue
          restored.push({
            id: target.path,
            path: target.path,
            name: data.name,
            size: data.size,
            url: data.url,
            source: 'local'
          })
        } catch (e) {
          console.error('Failed to restore file:', target.path, e)
        }
      } else {
        restored.push({
          id: target.path,
          path: target.path,
          name: target.name,
          size: target.size ?? 0,
          url: '',
          source: 'bilibili',
          bvid: target.path,
          cover: target.cover
        })
      }
      if (i === savedIndex) {
        restoredIndex = restored.length - 1
      }
    }

    // 标记已恢复，避免首次渲染时把空列表覆盖掉旧数据
    hasRestoredRef.current = true
    setPlaylist(restored)
    setCurrentIndex(restoredIndex)
    pendingPlayRef.current =
      restoredIndex >= 0 && savedPlaying && !!restored[restoredIndex]?.url
  }, [])

  useEffect(() => {
    restorePlaylist()
  }, [restorePlaylist])

  const isVideo = currentItem
    ? currentItem.source === 'local' && /^video\//.test(getMimeType(currentItem.name))
    : false

  const handlePlayBilibili = useCallback(
    async (item: BilibiliSearchResult) => {
      streamRetryRef.current.id = ''
      streamRetryRef.current.tries = 0
      streamRetryRef.current.alerted = false
      try {
        const audio = await window.electronAPI.getBilibiliAudio(item.bvid, item.title)
        const newItem: MediaItem = {
          id: item.bvid,
          path: item.bvid,
          name: audio.title || item.title,
          size: 0,
          url: audio.url,
          backups: audio.backups || [],
          bitrate: audio.bitrate || 0,
          source: 'bilibili',
          bvid: item.bvid,
          cover: item.pic
        }

        const currentPlaylist = playlistRef.current
        const existingIndex = currentPlaylist.findIndex(
          (i) => i.source === 'bilibili' && i.path === item.bvid
        )
        let nextIndex: number
        let nextPlaylist: MediaItem[]
        if (existingIndex >= 0) {
          nextIndex = existingIndex
          nextPlaylist = currentPlaylist.map((i, idx) => (idx === existingIndex ? newItem : i))
        } else {
          nextIndex = currentPlaylist.length
          nextPlaylist = [...currentPlaylist, newItem]
        }

        setPlaylist(nextPlaylist)
        await fadeOutForSwitch()
        setCurrentIndex(nextIndex)
        setIsPlaying(true)
        setView('player')
      } catch (err) {
        console.error('Bilibili play failed:', err)
        toastError(err instanceof Error ? err.message : '播放失败')
      }
    },
    [fadeOutForSwitch]
  )

  // 深链 / 文件关联打开：mineradio:// 链接或双击媒体文件唤起本应用
  const handleOpenDeepLink = useCallback(
    async (payload: { type: 'play' | 'open' | 'm3u' | 'file'; url?: string; path?: string }) => {
      if (payload.type === 'm3u' && payload.path) {
        const res = await window.electronAPI.readM3uFile(payload.path)
        if (!res.success || !res.text) {
          toastError('导入失败：无法读取文件')
          return
        }
        const lines = res.text.split(/\r?\n/)
        const localPaths: string[] = []
        const biliItems: { bvid: string; name: string }[] = []
        for (const raw of lines) {
          const line = raw.trim()
          if (!line) continue
          if (line.startsWith('#MR3D-BILI ')) {
            const rest = line.slice('#MR3D-BILI '.length)
            const sp = rest.indexOf(' ')
            const bvid = sp >= 0 ? rest.slice(0, sp) : rest
            const name = sp >= 0 ? rest.slice(sp + 1).trim() : bvid
            if (bvid) biliItems.push({ bvid, name: name || bvid })
          } else if (!line.startsWith('#')) {
            localPaths.push(line)
          }
        }
        let addedLocal = 0
        if (localPaths.length > 0) {
          const { failedPaths } = await addFiles(localPaths)
          addedLocal = localPaths.length - failedPaths.length
        }
        for (const b of biliItems) {
          if (playlistRef.current.some((i) => i.source === 'bilibili' && i.bvid === b.bvid)) continue
          setPlaylist((prev) =>
            prev.some((i) => i.source === 'bilibili' && i.bvid === b.bvid) ? prev : [...prev, {
              id: b.bvid,
              path: b.bvid,
              name: b.name,
              size: 0,
              url: '',
              source: 'bilibili' as const,
              bvid: b.bvid
            }]
          )
          addedLocal++
        }
        if (addedLocal > 0) toastSuccess(`已从列表导入 ${addedLocal} 首`)
        return
      }
      if (payload.type === 'file' && payload.path) {
        await addFiles([payload.path])
        return
      }
      if (payload.type === 'play' && payload.url) {
        const bvid = payload.url.match(/BV[0-9A-Za-z]{10}/)?.[0]
        if (bvid) {
          await handlePlayBilibili({ bvid, title: payload.url, author: '', duration: '', pic: '' })
        }
        return
      }
      if (payload.type === 'open' && payload.path) {
        await addFiles([payload.path])
        return
      }
    },
    [addFiles, handlePlayBilibili]
  )

  const openDeepLinkRef = useRef(handleOpenDeepLink)
  openDeepLinkRef.current = handleOpenDeepLink
  useEffect(() => {
    const off = window.electronAPI.onOpenDeepLink((payload) => {
      void openDeepLinkRef.current(payload)
    })
    return off
  }, [])

  const handleAddBilibili = useCallback((item: BilibiliSearchResult) => {
    const currentPlaylist = playlistRef.current
    if (currentPlaylist.some((i) => i.source === 'bilibili' && i.bvid === item.bvid)) {
      return
    }
    const newItem: MediaItem = {
      id: item.bvid,
      path: item.bvid,
      name: item.title,
      size: 0,
      url: '',
      source: 'bilibili',
      bvid: item.bvid,
      cover: item.pic
    }
    setPlaylist((prev) => [...prev, newItem])
  }, [])

  // 从自定义歌单播放歌曲：B 站用已有流程，本地文件读取后加入队列并播放
  const handlePlaySavedItem = useCallback(
    async (item: SavedMediaItem) => {
      if (item.source === 'bilibili') {
        await handlePlayBilibili({
          bvid: item.path,
          title: item.name,
          author: '',
          duration: '',
          pic: item.cover || ''
        })
        return
      }
      const existingIdx = playlistRef.current.findIndex(
        (i) => i.source === 'local' && i.path === item.path
      )
      if (existingIdx >= 0) {
        await fadeOutForSwitch()
        setCurrentIndex(existingIdx)
        setIsPlaying(true)
        setView('player')
        return
      }
      try {
        const data = await window.electronAPI.statFile(item.path)
        if (!data.exists) {
          toastError('文件不存在，可能已被移动或删除')
          return
        }
        const newItem: MediaItem = {
          id: item.path,
          path: item.path,
          name: data.name,
          size: data.size,
          url: data.url,
          source: 'local'
        }
        const idx = playlistRef.current.length
        setPlaylist((prev) => [...prev, newItem])
        await fadeOutForSwitch()
        setCurrentIndex(idx)
        setIsPlaying(true)
        setView('player')
      } catch (err) {
        console.error('Play saved item failed:', item.path, err)
        toastError('文件读取失败，可能已被移动或删除')
      }
    },
    [handlePlayBilibili, fadeOutForSwitch]
  )

  const toggleFullscreen = useCallback(async () => {
    const next = !isFullscreen
    setIsFullscreen(next)
    await window.electronAPI.setFullscreen(next)
  }, [isFullscreen])

  const handleHistorySelect = useCallback(async (index: number) => {
    streamRetryRef.current.id = ''
    streamRetryRef.current.tries = 0
    streamRetryRef.current.alerted = false
    await fadeOutForSwitch()
    setCurrentIndex(index)
    setIsPlaying(true)
  }, [fadeOutForSwitch])

  // B 站流加载失败自动恢复：依次切换备用 CDN，仍失败则重新解析，最多 3 次
  const handleMediaError = useCallback(async () => {
    const item = currentItem
    if (!item) return
    // 本地文件解码/读取失败：静默跳到下一首，避免卡死（跳过视频避免反复触发）
    if (item.source === 'local') {
      if (item.path && /^video\//.test(getMimeType(item.name))) return
      const st = streamRetryRef.current
      if (st.id !== item.id) {
        st.id = item.id
        st.tries = 0
        st.alerted = false
      }
      if (st.tries < 1) {
        st.tries++
        handleNext()
      }
      return
    }
    if (!item.bvid) return
    const st = streamRetryRef.current
    if (st.id !== item.id) {
      st.id = item.id
      st.tries = 0
      st.alerted = false
    }
    if (st.tries >= 3) {
      if (!st.alerted) {
        st.alerted = true
        toastError('B 站音频流加载失败，可能是网络无法连接该 CDN，请稍后重试或更换视频')
      }
      return
    }
    st.tries++
    const remaining = (item.backups || []).filter((u) => u && u !== item.url)
    let next: MediaItem
    if (remaining.length > 0) {
      next = { ...item, url: remaining[0], backups: remaining.slice(1) }
    } else {
      try {
        const audio = await window.electronAPI.getBilibiliAudio(item.bvid, item.name)
        if (audio.url === item.url) return
        next = { ...item, url: audio.url, backups: audio.backups || [] }
      } catch {
        return
      }
    }
    setPlaylist((prev) => prev.map((i) => (i.id === item.id ? next : i)))
  }, [currentItem, handleNext])

  // 同步按 Esc 退出全屏的状态
  useEffect(() => {
    const sync = async () => {
      const fs = await window.electronAPI.isFullscreen()
      setIsFullscreen(fs)
    }
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  // 启动封面结束后，如果上次是播放状态则自动续播
  useEffect(() => {
    if (splashDone && pendingPlayRef.current && currentItem) {
      pendingPlayRef.current = false
      setIsPlaying(true)
    }
  }, [splashDone, currentItem])

  // 进入粒子界面时短暂提示“双击进入全屏”（仅首次进入显示，退出全屏后不再重复）
  useEffect(() => {
    if (view !== 'player' || isFullscreen) {
      setShowFullscreenHint(false)
      return
    }
    if (sessionStorage.getItem('mineradio3d-fs-hint-shown')) return
    sessionStorage.setItem('mineradio3d-fs-hint-shown', '1')
    // 等 main-area 淡入完成再显示，避免被 opacity:0 压住
    const showT = setTimeout(() => setShowFullscreenHint(true), 1100)
    const hideT = setTimeout(() => setShowFullscreenHint(false), 1100 + 5200)
    return () => {
      clearTimeout(showT)
      clearTimeout(hideT)
    }
  }, [view, isFullscreen])

  // 同步 isPlaying 到媒体元素（移除 autoPlay，避免启动时抢资源）
  useEffect(() => {
    if (!mediaRef.current) return
    if (isPlaying) {
      mediaRef.current.play().catch(() => {})
    } else {
      mediaRef.current.pause()
    }
  }, [isPlaying])

  // 切歌时如果处于播放状态则自动播放
  useEffect(() => {
    if (!currentItem || !isPlaying || !mediaRef.current) return
    mediaRef.current.play().catch(() => {})
  }, [currentItem, isPlaying])

  // 应用播放速度（切歌或速度变化时）
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = playbackRate
  }, [playbackRate, currentItem])

  // 应用混响参数到已建立的卷积器/增益/亮度滤波器链路
  const applyReverb = useCallback(() => {
    const ctx = audioContextRef.current
    const convolver = convolverRef.current
    const dry = dryGainRef.current
    const wet = wetGainRef.current
    const bright = brightnessRef.current
    if (!ctx || !convolver || !dry || !wet || !bright) return
    if (reverbPreset !== 'on') {
      wet.gain.value = 0
      dry.gain.value = 1
      bright.frequency.value = 20000
      return
    }
    const cfg = REVERB_CONFIG
    convolver.buffer = createImpulseResponse(ctx, cfg.duration, cfg.decay)
    wet.gain.value = cfg.wet
    dry.gain.value = cfg.dry
    // 明亮度：低通截止频率 800–20000Hz 线性映射
    bright.frequency.value = 800 + cfg.bright * (20000 - 800)
  }, [reverbPreset])

  // 混响预设变化时重新配置链路（链路可能尚未建立，待命中再应用）
  useEffect(() => {
    applyReverb()
    try {
      localStorage.setItem(REVERB_STORAGE_KEY, reverbPreset)
    } catch {
      /* ignore */
    }
  }, [reverbPreset, applyReverb])

  // 播放模式持久化（重启后恢复上次模式）
  useEffect(() => {
    try {
      localStorage.setItem(PLAY_MODE_KEY, playMode)
    } catch {
      /* ignore */
    }
  }, [playMode])

  // 建立/重建音频分析链路（media 元素切换时）
  useEffect(() => {
    if (!mediaRef.current) return
    if (connectedMediaRef.current === mediaRef.current) return

    const setup = async () => {
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect()
        } catch {
          // ignore
        }
        sourceRef.current = null
      }
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext()
      }
      const ctx = audioContextRef.current
      try {
        const source = ctx.createMediaElementSource(mediaRef.current!)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.5

        // 淡入淡出增益（跨曲切换时平滑音量）
        const fadeGain = ctx.createGain()
        fadeGain.gain.value = 1

        // EQ：低音/高音搁架滤波
        const bass = ctx.createBiquadFilter()
        bass.type = 'lowshelf'
        bass.frequency.value = 200
        const treble = ctx.createBiquadFilter()
        treble.type = 'highshelf'
        treble.frequency.value = 3500

        // 混响链路：干声直达 + 湿声经卷积器，强调空间纵深
        const dryGain = ctx.createGain()
        const wetGain = ctx.createGain()
        const convolver = ctx.createConvolver()
        const brightness = ctx.createBiquadFilter()
        dryGain.gain.value = 1
        wetGain.gain.value = 0
        convolver.buffer = null
        brightness.type = 'lowpass'
        brightness.frequency.value = 20000

        // source -> fadeGain -> bass -> treble -> 各分支
        source.connect(fadeGain)
        fadeGain.connect(bass)
        bass.connect(treble)
        treble.connect(analyser)
        treble.connect(dryGain)
        treble.connect(convolver)
        convolver.connect(brightness)
        brightness.connect(wetGain)
        dryGain.connect(ctx.destination)
        wetGain.connect(ctx.destination)

        sourceRef.current = source
        analyserRef.current = analyser
        dryGainRef.current = dryGain
        wetGainRef.current = wetGain
        convolverRef.current = convolver
        brightnessRef.current = brightness
        bassRef.current = bass
        trebleRef.current = treble
        fadeGainRef.current = fadeGain
        bass.gain.value = eqBassRef.current
        treble.gain.value = eqTrebleRef.current
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount)
        connectedMediaRef.current = mediaRef.current
        // 链路建好后立即应用当前混响设置
        applyReverb()
      } catch (err) {
        console.error('Failed to connect audio source:', err)
      }
    }
    setup()
  })

  // 播放时自动恢复 AudioContext
  useEffect(() => {
    const ctx = audioContextRef.current
    if (isPlaying && ctx && ctx.state === 'suspended') {
      ctx.resume()
    }
  }, [isPlaying])

  // 歌曲风格标签分析：新歌开播时先查关键词，无命中则做 ~3.6s 音频特征分析
  useEffect(() => {
    const id = currentItem ? currentItem.id : ''
    if (!id) {
      setStyleTag('')
      return
    }
    if (styleCacheRef.current[id]) {
      setStyleTag(styleCacheRef.current[id])
      return
    }
    const kw = keywordStyle(currentItem.name)
    if (kw) {
      styleCacheRef.current[id] = kw
      setStyleTag(kw)
      return
    }
    const analyser = analyserRef.current
    if (!isPlaying || !analyser) {
      setStyleTag('')
      return
    }
    setStyleTag('')
    let cancelled = false
    const abortCtrl = new AbortController()
    styleTimerRef.current = setTimeout(() => {
      analyzeAudio(analyser, abortCtrl.signal)
        .then((feat) => {
          if (cancelled) return
          const tag = audioStyleTag(feat)
          styleCacheRef.current[id] = tag
          setStyleTag(tag)
        })
        .catch(() => {})
    }, 900)
    return () => {
      cancelled = true
      abortCtrl.abort()
      if (styleTimerRef.current) clearTimeout(styleTimerRef.current)
    }
  }, [currentItem, isPlaying])

  // 全局快捷键：空格播放/暂停，Esc 退出全屏
  useEffect(() => {
    const isTyping = () => {
      const tag = document.activeElement?.tagName
      const editable = document.activeElement?.getAttribute('contenteditable')
      return tag === 'INPUT' || tag === 'TEXTAREA' || editable === 'true'
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'Escape' && isFullscreen) {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, togglePlay, toggleFullscreen])

  // 系统媒体键（通过 navigator.mediaSession 接入 OS 媒体控制，如键盘媒体键/系统媒体浮窗）
  const mediaControlRef = useRef({ togglePlay, handleNext, handlePrev })
  mediaControlRef.current = { togglePlay, handleNext, handlePrev }
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const setAction = (action: MediaSessionAction, handler: () => void) => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        // 某些平台/动作不支持时忽略
      }
    }
    setAction('play', () => mediaControlRef.current.togglePlay())
    setAction('pause', () => mediaControlRef.current.togglePlay())
    setAction('previoustrack', () => mediaControlRef.current.handlePrev())
    setAction('nexttrack', () => mediaControlRef.current.handleNext())
    return () => {
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
      } catch {
        /* ignore */
      }
    }
  }, [])

  // 切歌时更新系统媒体会话元数据与播放状态
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    if (!currentItem) {
      ms.metadata = null
      return
    }
    try {
      ms.metadata = new MediaMetadata({
        title: currentItem.name.replace(/\.[^/.]+$/, ''),
        artist: currentItem.source === 'bilibili' ? 'Bilibili' : '本地文件',
        album: 'MineRadio3D',
        artwork: currentItem.cover ? [{ src: currentItem.cover, sizes: '512x512' }] : []
      })
    } catch {
      ms.metadata = null
    }
    ms.playbackState = isPlaying ? 'playing' : 'paused'
  }, [currentItem, isPlaying])

  // 任务栏缩略图按钮 / 全局快捷键指令 → 播放控制
  const mediaControlRef2 = useRef({ togglePlay, handleNext, handlePrev })
  mediaControlRef2.current = { togglePlay, handleNext, handlePrev }
  useEffect(() => {
    const off = window.electronAPI.onMediaControl((action) => {
      if (action === 'toggle') mediaControlRef2.current.togglePlay()
      else if (action === 'next') mediaControlRef2.current.handleNext()
      else if (action === 'prev') mediaControlRef2.current.handlePrev()
    })
    return off
  }, [])

  // 上报播放状态 → 主进程更新任务栏按钮与进度条
  useEffect(() => {
    window.electronAPI.reportPlaybackState({
      isPlaying,
      hasItem: !!currentItem,
      currentTime,
      duration
    })
  }, [isPlaying, currentItem, currentTime, duration])

  // 切歌时发送系统通知（仅真正的切歌触发，同一首重复暂停/播放不重复通知）
  const notifiedIdRef = useRef('')
  useEffect(() => {
    if (!currentItem || !isPlaying) return
    if (notifiedIdRef.current === currentItem.id) return
    notifiedIdRef.current = currentItem.id
    try {
      window.electronAPI.notify({
        title: currentItem.name.replace(/\.[^/.]+$/, ''),
        body: currentItem.source === 'bilibili' ? 'Bilibili · 正在播放' : '本地文件 · 正在播放'
      })
    } catch { /* ignore */ }
  }, [currentItem, isPlaying])

  // 切歌时加载歌词：本地读同名 .lrc，B 站按歌名从网易云搜索（带缓存）；并恢复该歌的歌词偏移
  const lyricsLoadIdRef = useRef('')
  const loadLyrics = useCallback(async (item: MediaItem | null) => {
    const targetId = item?.id || ''
    lyricsLoadIdRef.current = targetId
    setLyricsLines([])
    setLyricOffset(0)
    if (!item) return

    try {
      const raw = localStorage.getItem(LYRICS_OFFSET_KEY)
      if (raw) {
        const map: Record<string, number> = JSON.parse(raw)
        if (typeof map[item.path] === 'number') setLyricOffset(map[item.path])
      }
    } catch { /* ignore */ }

    if (item.source === 'local') {
      const lrcPath = item.path.replace(/\.[^/.]+$/, '') + '.lrc'
      try {
        const res = await window.electronAPI.readTextFile(lrcPath)
        if (lyricsLoadIdRef.current !== targetId) return
        if (res.success && res.text) {
          const parsed = parseLrc(res.text)
          if (parsed.length > 0) setLyricsLines(parsed)
        }
      } catch { /* ignore */ }
      return
    }

    const keyword = cleanSongKeyword(item.name)
    if (!keyword) return
    try {
      let cache: Record<string, string> = {}
      try {
        const raw = localStorage.getItem(LYRICS_CACHE_KEY)
        cache = raw ? JSON.parse(raw) : {}
      } catch { /* ignore */ }

      let lrc = cache[item.path]
      if (!lrc) {
        const res = await window.electronAPI.searchNeteaseLyric(keyword)
        if (lyricsLoadIdRef.current !== targetId) return
        if (res.success && res.lrc) {
          lrc = res.lrc
          try {
            cache[item.path] = lrc
            localStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(cache))
          } catch { /* ignore */ }
        } else {
          console.warn('[lyrics] no match for keyword:', keyword)
        }
      }
      if (lrc) {
        const parsed = parseLrc(lrc)
        if (lyricsLoadIdRef.current === targetId && parsed.length > 0) {
          setLyricsLines(parsed)
        }
      }
    } catch (err) {
      console.warn('[lyrics] search failed:', keyword, err)
    }
  }, [])

  useEffect(() => {
    loadLyrics(currentItem)
  }, [currentItem, loadLyrics])

  // 歌词偏移：±0.5s 微调并持久化（按歌曲 path 记录），再点击归零
  const handleAdjustLyricOffset = useCallback(
    (delta: number) => {
      if (!currentItem) return
      setLyricOffset((prev) => {
        const next = Math.max(-60, Math.min(60, prev + delta))
        try {
          const raw = localStorage.getItem(LYRICS_OFFSET_KEY)
          const map: Record<string, number> = raw ? JSON.parse(raw) : {}
          map[currentItem.path] = next
          localStorage.setItem(LYRICS_OFFSET_KEY, JSON.stringify(map))
        } catch { /* ignore */ }
        return next
      })
    },
    [currentItem]
  )

// 打开手动歌词搜索：自动带上清洗后的歌名作为默认关键词
  const openLyricsSearch = useCallback(() => {
    if (!currentItem) return
    setLyricsSearchOpen(true)
  }, [currentItem])

  // 手动搜索选中某首歌后：拉取歌词、写入缓存并立即应用
  const applyLyricsFromSearch = useCallback(
    async (songId: number, songName: string): Promise<boolean> => {
      if (!currentItem) return false
      try {
        const res = await window.electronAPI.getNeteaseLyricById(songId)
        if (!res.success || !res.lrc) return false

        const parsed = parseLrc(res.lrc)
        if (parsed.length === 0) return false

        try {
          const raw = localStorage.getItem(LYRICS_CACHE_KEY)
          const cache: Record<string, string> = raw ? JSON.parse(raw) : {}
          cache[currentItem.path] = res.lrc
          localStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(cache))
        } catch { /* ignore */ }

        lyricsLoadIdRef.current = currentItem.id
        setLyricsLines(parsed)
        setLyricsVisible(true)
        setLyricsSearchOpen(false)
        window.electronAPI.notify({
          title: '歌词已更新',
          body: `《${songName}》 · ${currentItem.source === 'bilibili' ? 'Bilibili' : '本地文件'}`
        })
        return true
      } catch {
        return false
      }
    },
[currentItem]
  )

  // ===== 主界面（HomeView）导航与播放接线 =====

  // 进入 App 指定标签页（主界面菜单 → 原软件对应视图）
  const goApp = useCallback((tab: HomeNavTab) => {
    setActiveTab(tab)
    setView('dashboard')
    setScreen('app')
  }, [])

  // 从主界面直接进入播放器视图
  const handleOpenPlayer = useCallback(() => {
    setScreen('app')
    setView('player')
  }, [])

  // 从主界面队列点击播放：先切入 App，再开始播放（handlePlay 会把视图切到 player）
  const handlePlayFromHome = useCallback(
    (index: number) => {
      setScreen('app')
      handlePlay(index)
    },
    [handlePlay]
  )

  // 主界面「开始播放」：始终直接进入播放器界面（不弹文件选择）
  const handleHomeStart = useCallback(() => {
    setScreen('app')
    setView('player')
    if (currentIndex >= 0 && currentItem) {
      if (!isPlaying) togglePlay()
    } else if (playlistRef.current.length > 0) {
      void handlePlay(0)
    }
  }, [currentIndex, currentItem, isPlaying, togglePlay, handlePlay])

  return (
    <div className={`app ${isFullscreen ? 'fullscreen' : ''}`}>
      {!isFullscreen && <TitleBar />}
      {!splashDone && (
        <SplashScreen
          onExiting={() => setSplashExiting(true)}
          onComplete={() => setSplashDone(true)}
          cover={currentItem?.cover}
        />
      )}

      {splashDone && screen === 'home' && (
        <HomeView
          playlist={playlist}
          currentIndex={currentIndex}
          currentItem={currentItem}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          likedIds={likedIds}
          playStats={playStats}
          onTogglePlay={togglePlay}
          onNext={() => handleNext()}
          onPrev={() => handlePrev()}
          onSeek={(t) => {
            if (mediaRef.current) mediaRef.current.currentTime = t
            setCurrentTime(t)
          }}
          onVolumeChange={handleVolumeChange}
          onToggleLike={handleToggleLike}
          onPlay={handlePlayFromHome}
          onStart={handleHomeStart}
          onNavigate={goApp}
          onImportFiles={handleImportFiles}
          onImportFolder={handleImportFolder}
        />
      )}

      {splashDone && screen === 'app' && view === 'dashboard' && (
        <MainInterface
          activeTab={activeTab}
          onNavigateTab={setActiveTab}
          onGoHome={() => setScreen('home')}
          playlist={playlist}
          currentIndex={currentIndex}
          currentItem={currentItem}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          durations={durations}
          playStats={playStats}
          playEvents={playEvents}
          onPlay={handlePlay}
          onTogglePlay={togglePlay}
          onOpenPlayer={() => setView('player')}
          onAddBilibili={handleAddBilibili}
          onPlayBilibili={handlePlayBilibili}
          onPlaySavedItem={handlePlaySavedItem}
          onDelete={handleDelete}
          onDeleteMany={handleDeleteMany}
          onClearAll={handleClearAll}
          customPlaylists={customPlaylists}
          onCreatePlaylist={handleCreatePlaylist}
          onAddToPlaylist={handleAddToPlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onRemoveFromPlaylist={handleRemoveFromPlaylist}
          downloadDir={downloadDir}
          onDownloadDirChange={handleDownloadDirChange}
          likedIds={likedIds}
          onToggleLike={handleToggleLike}
          onExportM3u={handleExportM3u}
          onImportM3u={handleImportM3u}
          onImportFiles={handleImportFiles}
          onImportFolder={handleImportFolder}
        />
      )}

      {screen === 'app' && view === 'player' && (
        <div className={`main-area ${splashExiting ? 'main-area-visible' : 'main-area-hidden'}`}>
          <div className="visualizer-wrapper" onDoubleClick={toggleFullscreen}>
            {currentItem?.cover ? (
              <img
                key={currentItem.cover}
                className="visualizer-bg visible"
                src={currentItem.cover}
                alt=""
                draggable={false}
                referrerPolicy="no-referrer"
                onLoad={() => console.log('[bg] cover loaded:', currentItem.cover)}
                onError={() => console.warn('[bg] cover failed:', currentItem.cover)}
              />
            ) : (
              <div className="visualizer-bg" />
            )}
            <Visualizer
              mediaElement={mediaRef.current}
              analyserRef={analyserRef}
              dataArrayRef={dataArrayRef}
              isPlaying={isPlaying}
              isFullscreen={isFullscreen}
              title={currentItem ? currentItem.name.replace(/\.[^/.]+$/, '') : null}
              playlist={playlist}
              currentIndex={currentIndex}
              durations={durations}
              onHistorySelect={handleHistorySelect}
              reverbAmount={reverbPreset === 'on' ? REVERB_CONFIG.wet : 0}
              reverbPreset={reverbPreset}
              lyricsLines={lyricsLines}
              lyricsCurrentTime={currentTime}
              lyricsVisible={lyricsVisible}
              lyricOffset={lyricOffset}
              onLyricsAdjust={handleAdjustLyricOffset}
              onLyricsSearch={openLyricsSearch}
              styleTag={styleTag}
            />
            {!isFullscreen && (
              <div
                className={`fullscreen-hint ${showFullscreenHint ? 'show' : ''}`}
                onClick={() => setShowFullscreenHint(false)}
              >
                <span className="fullscreen-hint-icon">≋</span>
                <span>双击进入全屏</span>
              </div>
            )}
          </div>
          {!isFullscreen && (
            <>
              <button
                className="dashboard-back"
                onClick={() => setView('dashboard')}
                title="返回主界面"
              >
                ←
              </button>
              <Player
                currentItem={currentItem}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                playMode={playMode}
                volume={volume}
                isLiked={!!currentItem && likedIds.has(currentItem.path)}
                queueOpen={queueOpen}
                onTogglePlay={togglePlay}
                onNext={handleNext}
                onPrev={handlePrev}
                onSeek={(t) => {
                  if (mediaRef.current) mediaRef.current.currentTime = t
                  setCurrentTime(t)
                }}
                onModeChange={setPlayMode}
                onVolumeChange={handleVolumeChange}
                onToggleLike={() => currentItem && handleToggleLike(currentItem)}
                onToggleQueue={() => setQueueOpen((v) => !v)}
                lyricsVisible={lyricsVisible}
                hasLyrics={lyricsLines.length > 0}
                onToggleLyrics={() => setLyricsVisible((v) => !v)}
                onLyricsSearch={openLyricsSearch}
                reverbPreset={reverbPreset}
                onReverbToggle={handleReverbToggle}
                playbackRate={playbackRate}
                onPlaybackRateChange={handlePlaybackRateChange}
                eqBass={eqBass}
                eqTreble={eqTreble}
                onEqChange={handleEqChange}
                crossfade={crossfade}
                onCrossfadeToggle={handleCrossfadeToggle}
                customPlaylists={customPlaylists}
                onCreatePlaylist={handleCreatePlaylist}
                onAddToPlaylist={handleAddToPlaylist}
              />
            </>
          )}
        </div>
      )}

      {screen === 'app' && view === 'player' && !isFullscreen && splashDone && (
        <Playlist
          playlist={playlist}
          currentIndex={currentIndex}
          onPlay={handlePlay}
          onDelete={handleDelete}
          onDeleteMany={handleDeleteMany}
          onClearAll={handleClearAll}
          onAddBilibili={handleAddBilibili}
          onPlayBilibili={handlePlayBilibili}
          onPlaySavedItem={handlePlaySavedItem}
          customPlaylists={customPlaylists}
          onCreatePlaylist={handleCreatePlaylist}
          onAddToPlaylist={handleAddToPlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onRemoveFromPlaylist={handleRemoveFromPlaylist}
          likedIds={likedIds}
          onToggleLike={handleToggleLike}
          onExportM3u={handleExportM3u}
          onImportM3u={handleImportM3u}
          onImportFiles={handleImportFiles}
          onImportFolder={handleImportFolder}
          collapsed={!queueOpen}
        />
      )}

      {/* 全局隐藏的媒体元素：跨界面保持播放不中断 */}
      {currentItem &&
        (isVideo ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={currentItem.url}
            crossOrigin="anonymous"
            volume={volume}
            style={{ display: 'none', position: 'absolute', width: 0, height: 0 }}
            onEnded={handleEnded}
            onError={handleMediaError}
            onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const duration = e.currentTarget.duration
              setDuration(duration)
              if (currentItem) {
                setDurations((prev) => ({ ...prev, [currentItem.id]: duration }))
              }
            }}
            onPlay={() => {
              setIsPlaying(true)
              fadeIn()
            }}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={currentItem.url}
            crossOrigin="anonymous"
            volume={volume}
            style={{ display: 'none', position: 'absolute', width: 0, height: 0 }}
            onEnded={handleEnded}
            onError={handleMediaError}
            onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const duration = e.currentTarget.duration
              setDuration(duration)
              if (currentItem) {
                setDurations((prev) => ({ ...prev, [currentItem.id]: duration }))
              }
            }}
            onPlay={() => {
              setIsPlaying(true)
              fadeIn()
            }}
            onPause={() => setIsPlaying(false)}
          />
        ))}

      <LockScreen
        isFullscreen={isFullscreen}
        isIdle={isIdle}
        onExitFullscreen={toggleFullscreen}
      />

      <LyricsSearchModal
        open={lyricsSearchOpen}
        initialKeyword={currentItem ? cleanSongKeyword(currentItem.name) : ''}
        onClose={() => setLyricsSearchOpen(false)}
        onApply={applyLyricsFromSearch}
      />
    </div>
  )
}

export default App
