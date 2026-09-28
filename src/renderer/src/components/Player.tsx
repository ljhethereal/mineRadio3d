import { useEffect, useRef, useState } from 'react'
import { MediaItem, PlayMode, ReverbPreset, CustomPlaylist, SavedMediaItem } from '../types'
import { formatTime } from '../utils'
import { HeartIcon, PlusIcon } from './icons'

interface PlayerProps {
  currentItem: MediaItem | null
  isPlaying: boolean
  currentTime: number
  duration: number
  playMode: PlayMode
  volume: number
  isLiked: boolean
  queueOpen: boolean
  lyricsVisible: boolean
  hasLyrics: boolean
  onTogglePlay: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (time: number) => void
  onModeChange: (mode: PlayMode) => void
  onVolumeChange: (v: number) => void
  onToggleLike: () => void
  onToggleQueue: () => void
  onToggleLyrics: () => void
  onLyricsSearch: () => void
  reverbPreset: ReverbPreset
  onReverbToggle: () => void
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
  eqBass: number
  eqTreble: number
  onEqChange: (bass: number, treble: number) => void
  crossfade: boolean
  onCrossfadeToggle: () => void
  customPlaylists: CustomPlaylist[]
  onCreatePlaylist: (name: string) => string
  onAddToPlaylist: (playlistId: string, item: SavedMediaItem) => void
}

const modes: PlayMode[] = ['sequential', 'list-loop', 'single-loop', 'random']
const modeLabels: Record<PlayMode, string> = {
  sequential: '顺序播放',
  'list-loop': '列表循环',
  'single-loop': '单曲循环',
  random: '随机播放'
}

const reverbLabels: Record<ReverbPreset, string> = {
  off: '关闭',
  on: '混响'
}

const PlayIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const ReverbIcon = () => (
  <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
    <path d="M12 2v6M9 4v4M15 4v4" strokeLinecap="round" />
    <path d="M4 10a8 8 0 0 0 16 0" strokeLinecap="round" />
    <path d="M6 14a6 6 0 0 0 12 0" strokeLinecap="round" />
    <path d="M8 18a4 4 0 0 0 8 0" strokeLinecap="round" />
    <path d="M11 21h2" strokeLinecap="round" />
  </svg>
)

const PauseIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
)

const PrevIcon = () => (
  <svg width={18} height={18} fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
  </svg>
)

const NextIcon = () => (
  <svg width={18} height={18} fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
  </svg>
)

const ModeSequentialIcon = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M5 6h14M5 12h14M5 18h14" />
  </svg>
)

const ModeListLoopIcon = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)

const ModeSingleLoopIcon = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
    <text x="12" y="15" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="700">1</text>
  </svg>
)

const ModeRandomIcon = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
)

const modeIcons: Record<PlayMode, () => JSX.Element> = {
  sequential: ModeSequentialIcon,
  'list-loop': ModeListLoopIcon,
  'single-loop': ModeSingleLoopIcon,
  random: ModeRandomIcon
}

const QueueIcon = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

const VolumeIcon = ({ muted = false }: { muted?: boolean }) => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M3 9v6h4l5 5V4L7 9H3z" />
    {muted ? (
      <path d="M16 9l5 5M21 9l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    ) : (
      <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    )}
  </svg>
)

const CollectIcon = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const LyricsIcon = () => (
  <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
    <path d="M4 7h11M4 12h11M4 17h7" strokeLinecap="round" />
    <path d="M16.5 6v8.2" strokeLinecap="round" />
    <circle cx="16.5" cy="16.2" r="2" />
  </svg>
)

const LyricSearchIcon = () => (
  <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M20 20l-4.5-4.5M10.5 7.5v6M7.5 10.5h6" strokeLinecap="round" />
  </svg>
)

const EqIcon = () => (
  <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
    <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeOpacity="0.35" />
    <rect x="5" y="4" width="3" height="4" rx="1" fill="currentColor" stroke="none" />
    <rect x="12" y="10" width="3" height="4" rx="1" fill="currentColor" stroke="none" />
    <rect x="9" y="16" width="3" height="4" rx="1" fill="currentColor" stroke="none" />
  </svg>
)

const CrossfadeIcon = () => (
  <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
    <path d="M4 8a5 5 0 0 1 8 0 5 5 0 0 1 8 0" strokeLinecap="round" />
    <path d="M4 16a5 5 0 0 0 8 0 5 5 0 0 0 8 0" strokeLinecap="round" />
    <path d="M12 8v8" strokeLinecap="round" />
  </svg>
)

export default function Player({
  currentItem,
  isPlaying,
  currentTime,
  duration,
  playMode,
  volume,
  isLiked,
  queueOpen,
  lyricsVisible,
  hasLyrics,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onModeChange,
  onVolumeChange,
  onToggleLike,
  onToggleQueue,
  onToggleLyrics,
  onLyricsSearch,
  reverbPreset,
  onReverbToggle,
  playbackRate,
  onPlaybackRateChange,
  eqBass,
  eqTreble,
  onEqChange,
  crossfade,
  onCrossfadeToggle,
  customPlaylists,
  onCreatePlaylist,
  onAddToPlaylist
}: PlayerProps) {

  const [muted, setMuted] = useState(false)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [showCollectPopup, setShowCollectPopup] = useState(false)
  const [showEqPopup, setShowEqPopup] = useState(false)
  const [newListName, setNewListName] = useState('')
  const progressRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)
  const collectRef = useRef<HTMLDivElement>(null)
  const eqRef = useRef<HTMLDivElement>(null)
  const lastVolumeRef = useRef(volume > 0 ? volume : 1)
  const draggingVolumeRef = useRef(false)

  // 点击外部关闭 EQ 弹窗
  useEffect(() => {
    if (!showEqPopup) return
    const handler = (e: MouseEvent) => {
      if (eqRef.current && !eqRef.current.contains(e.target as Node)) {
        setShowEqPopup(false)
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
    }
  }, [showEqPopup])

  const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

  const cycleRate = () => {
    const idx = PLAYBACK_RATES.indexOf(playbackRate)
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length]
    onPlaybackRateChange(next)
  }

  const rateLabel = `${playbackRate}x`

  // 音质标签：本地按来源展示，B 站按实际码率展示（无码率信息时显示"流媒体"）
  const qualityLabel = currentItem
    ? currentItem.source === 'bilibili'
      ? currentItem.bitrate
        ? `${Math.round(currentItem.bitrate / 1000)}k`
        : '流媒体'
      : '本地'
    : '—'

  // 点击外部关闭收藏弹窗
  useEffect(() => {
    if (!showCollectPopup) return
    const handler = (e: MouseEvent) => {
      if (collectRef.current && !collectRef.current.contains(e.target as Node)) {
        setShowCollectPopup(false)
        setNewListName('')
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
    }
  }, [showCollectPopup])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return
    const rect = progressRef.current.getBoundingClientRect()
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    onSeek(ratio * duration)
  }

  const cycleMode = () => {
    const idx = modes.indexOf(playMode)
    onModeChange(modes[(idx + 1) % modes.length])
  }

  const effectiveVolume = muted ? 0 : volume
  const isMuted = muted || volume === 0

  // 点击喇叭：静音/取消静音（取消后恢复上一次音量）
  const handleVolumeClick = () => {
    if (muted || volume === 0) {
      setMuted(false)
      const restore = lastVolumeRef.current > 0 ? lastVolumeRef.current : 0.6
      onVolumeChange(restore)
    } else {
      lastVolumeRef.current = volume
      setMuted(true)
      onVolumeChange(0)
    }
  }

  // 根据鼠标 x 坐标计算音量比例 (0-1)
  const calcVolumeRatio = (clientX: number) => {
    if (!volumeRef.current) return 0
    const rect = volumeRef.current.getBoundingClientRect()
    return Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1)
  }

  const commitVolume = (ratio: number) => {
    if (ratio > 0) {
      lastVolumeRef.current = ratio
      setMuted(false)
    }
    onVolumeChange(ratio)
  }

  // 点击滑轨跳到对应音量
  const handleVolumeSliderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    commitVolume(calcVolumeRatio(e.clientX))
  }

  // 开始拖动：按下鼠标即更新一次并进入拖动状态
  const handleVolumeSliderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingVolumeRef.current = true
    setShowVolumeSlider(true)
    commitVolume(calcVolumeRatio(e.clientX))
  }

  // 拖动 / 松开的全局监听（挂载时注册一次，运行时根据拖动标志判断）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingVolumeRef.current) return
      commitVolume(calcVolumeRatio(e.clientX))
    }
    const onUp = () => {
      if (!draggingVolumeRef.current) return
      draggingVolumeRef.current = false
      // 拖动结束后收起滑条（若鼠标仍在区域内，再次 hover 会重新展开）
      setShowVolumeSlider(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 滚轮调节音量（每次 ±5%）
  const handleVolumeWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    const next = Math.min(1, Math.max(0, (muted ? 0 : volume) + delta))
    if (next > 0) {
      lastVolumeRef.current = next
      setMuted(false)
    }
    onVolumeChange(next)
  }

  // 记住上一个非零音量，便于取消静音时恢复
  if (volume > 0 && !muted) {
    lastVolumeRef.current = volume
  }

  const ModeIcon = modeIcons[playMode]

  const coverStyle = currentItem?.cover
    ? { backgroundImage: `url(${currentItem.cover})` }
    : undefined

  return (
    <div className="player-bar">
      <div className="player-progress" ref={progressRef} onClick={handleProgressClick}>
        <div className="player-progress-track" />
        <div className="player-progress-fill" style={{ width: `${progress}%` }} />
        <div className="player-progress-thumb" style={{ left: `${progress}%` }} />
      </div>

      <div className="player-controls">
        <div className="player-cluster actions">
          <div className="player-track">
            <div className="player-cover" style={coverStyle} />
            <div className="player-meta">
              <div className="player-title" title={currentItem?.name || ''}>
                {currentItem ? currentItem.name.replace(/\.[^/.]+$/, '') : '未选择媒体'}
              </div>
              <div className="player-artist">
                {currentItem?.source === 'bilibili' ? 'Bilibili' : currentItem ? '本地文件' : '等待播放'}
              </div>
            </div>
          </div>
          <div className="player-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          <button
            className="player-btn quality-pill"
            title={
              currentItem?.source === 'bilibili' && currentItem.bitrate
                ? `B 站音频 · ${Math.round(currentItem.bitrate / 1000)} kbps`
                : '音质'
            }
          >
            <span>{qualityLabel}</span>
          </button>
          <button
            className="player-btn speed-pill"
            onClick={cycleRate}
            title={`播放速度: ${rateLabel}`}
          >
            <span>{rateLabel}</span>
          </button>
          <div className="player-eq-wrap" ref={eqRef}>
            <button
              className={`player-btn ${showEqPopup || eqBass !== 0 || eqTreble !== 0 ? 'active-queue' : ''}`}
              onClick={() => setShowEqPopup((v) => !v)}
              title="均衡器"
            >
              <EqIcon />
            </button>
            {showEqPopup && (
              <div className="eq-popup">
                <div className="eq-popup-header">均衡器</div>
                <div className="eq-slider-row">
                  <span className="eq-slider-label">低音</span>
                  <input
                    type="range"
                    min={-15}
                    max={15}
                    step={1}
                    value={eqBass}
                    onChange={(e) => onEqChange(Number(e.target.value), eqTreble)}
                  />
                  <span className="eq-slider-val">{eqBass > 0 ? `+${eqBass}` : eqBass}</span>
                </div>
                <div className="eq-slider-row">
                  <span className="eq-slider-label">高音</span>
                  <input
                    type="range"
                    min={-15}
                    max={15}
                    step={1}
                    value={eqTreble}
                    onChange={(e) => onEqChange(eqBass, Number(e.target.value))}
                  />
                  <span className="eq-slider-val">{eqTreble > 0 ? `+${eqTreble}` : eqTreble}</span>
                </div>
                <button
                  className="eq-reset"
                  onClick={() => onEqChange(0, 0)}
                  disabled={eqBass === 0 && eqTreble === 0}
                >
                  重置
                </button>
              </div>
            )}
          </div>
          <button
            className={`player-btn ${crossfade ? 'active-queue' : ''}`}
            onClick={onCrossfadeToggle}
            title={crossfade ? '跨曲淡入淡出: 开' : '跨曲淡入淡出: 关'}
          >
            <CrossfadeIcon />
          </button>
          <button
            className={`player-btn reverb-pill ${reverbPreset !== 'off' ? 'active' : ''}`}
            onClick={onReverbToggle}
            title={`混响: ${reverbLabels[reverbPreset]}`}
          >
            <ReverbIcon />
          </button>
          <button
            className={`player-btn ${lyricsVisible ? 'active-queue' : ''}`}
            onClick={onToggleLyrics}
            disabled={!hasLyrics}
            title={hasLyrics ? (lyricsVisible ? '隐藏歌词' : '显示歌词') : '当前歌曲无歌词'}
          >
            <LyricsIcon />
          </button>
          <button
            className="player-btn"
            onClick={onLyricsSearch}
            disabled={!currentItem}
            title="手动搜索歌词（当前歌曲无歌词或歌词不对时使用）"
          >
            <LyricSearchIcon />
          </button>
          <button
            className={`player-btn ${isLiked ? 'active' : ''}`}
            onClick={onToggleLike}
            title={isLiked ? '取消喜欢' : '喜欢'}
          >
            <HeartIcon active={isLiked} />
          </button>
          <div className="player-collect-wrap" ref={collectRef}>
            <button
              className={`player-btn ${showCollectPopup ? 'active' : ''}`}
              title="收藏到歌单"
              onClick={() => setShowCollectPopup((v) => !v)}
            >
              <CollectIcon />
            </button>
            {showCollectPopup && (
              <div className="collect-popup">
                <div className="collect-popup-header">收藏到歌单</div>
                <div className="collect-popup-list">
                  {customPlaylists.length === 0 && (
                    <div className="collect-popup-empty">暂无歌单，请新建</div>
                  )}
                  {customPlaylists.map((pl) => (
                    <button
                      key={pl.id}
                      className="collect-popup-item"
                      onClick={() => {
                        if (!currentItem) return
                        onAddToPlaylist(pl.id, {
                          source: currentItem.source,
                          path: currentItem.path,
                          name: currentItem.name,
                          size: currentItem.size,
                          cover: currentItem.cover
                        })
                        setShowCollectPopup(false)
                      }}
                    >
                      <span className="collect-popup-item-name">{pl.name}</span>
                      <span className="collect-popup-item-count">{pl.items.length}</span>
                    </button>
                  ))}
                </div>
                <div className="collect-popup-create">
                  <input
                    className="collect-popup-input"
                    type="text"
                    placeholder="新建歌单"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newListName.trim()) {
                        const id = onCreatePlaylist(newListName)
                        if (id && currentItem) {
                          onAddToPlaylist(id, {
                            source: currentItem.source,
                            path: currentItem.path,
                            name: currentItem.name,
                            size: currentItem.size,
                            cover: currentItem.cover
                          })
                        }
                        setNewListName('')
                        setShowCollectPopup(false)
                      }
                    }}
                  />
                  <button
                    className="collect-popup-create-btn"
                    disabled={!newListName.trim()}
                    onClick={() => {
                      if (!newListName.trim()) return
                      const id = onCreatePlaylist(newListName)
                      if (id && currentItem) {
                        onAddToPlaylist(id, {
                          source: currentItem.source,
                          path: currentItem.path,
                          name: currentItem.name,
                          size: currentItem.size,
                          cover: currentItem.cover
                        })
                      }
                      setNewListName('')
                      setShowCollectPopup(false)
                    }}
                  >
                    <PlusIcon size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="player-cluster transport">
          <button className="player-btn" onClick={cycleMode} title={modeLabels[playMode]}>
            <ModeIcon />
          </button>
          <button className="player-btn" onClick={onPrev} title="上一首">
            <PrevIcon />
          </button>
          <button className="player-btn play" onClick={onTogglePlay} title="播放/暂停">
            {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          </button>
          <button className="player-btn" onClick={onNext} title="下一首">
            <NextIcon />
          </button>
          <button
            className={`player-btn ${queueOpen ? 'active-queue' : ''}`}
            title="播放队列"
            onClick={onToggleQueue}
          >
            <QueueIcon />
          </button>
        </div>

        <div
          className="player-cluster volume"
          onMouseEnter={() => setShowVolumeSlider(true)}
          onMouseLeave={() => {
            // 拖动中不收起，避免宽度归零导致拖动计算失效
            if (!draggingVolumeRef.current) setShowVolumeSlider(false)
          }}
        >
          <button
            className={`player-btn ${isMuted ? 'muted' : ''}`}
            onClick={handleVolumeClick}
            title={isMuted ? '取消静音' : '静音'}
          >
            <VolumeIcon muted={isMuted} />
          </button>
          <div
            className={`player-volume-slider ${showVolumeSlider ? 'visible' : ''} ${draggingVolumeRef.current ? 'dragging' : ''}`}
            ref={volumeRef}
            onClick={handleVolumeSliderClick}
            onMouseDown={handleVolumeSliderMouseDown}
            onWheel={handleVolumeWheel}
            title="拖动 / 滚轮调节音量"
          >
            <div className="player-volume-track" />
            <div className="player-volume-fill" style={{ width: `${effectiveVolume * 100}%` }} />
            <div className="player-volume-thumb" style={{ left: `${effectiveVolume * 100}%` }} />
          </div>
          <span className="player-volume-value">{Math.round(effectiveVolume * 100)}</span>
        </div>

      </div>
    </div>
  )
}
