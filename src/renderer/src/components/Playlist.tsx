import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MediaItem, BilibiliSearchResult, CustomPlaylist, SavedMediaItem } from '../types'
import { HeartIcon, PlusIcon } from './icons'

interface PlaylistProps {
  playlist: MediaItem[]
  currentIndex: number
  onPlay: (index: number) => void
  onDelete: (index: number) => void
  onDeleteMany: (targets: number[] | string[]) => void
  onClearAll: () => void
  onAddBilibili: (item: BilibiliSearchResult) => void
  onPlayBilibili: (item: BilibiliSearchResult) => void
  customPlaylists?: CustomPlaylist[]
  onCreatePlaylist?: (name: string) => string
  onDeletePlaylist?: (id: string) => void
  onRemoveFromPlaylist?: (playlistId: string, itemIndex: number) => void
  onPlaySavedItem?: (item: SavedMediaItem) => void
  likedIds?: Set<string>
  onToggleLike?: (item: MediaItem) => void
  onExportM3u?: () => void
  onImportM3u?: () => void
  onImportFiles?: () => void
  onImportFolder?: () => void
  collapsed?: boolean
}

function Playlist({
  playlist,
  currentIndex,
  onPlay,
  onDelete,
  onDeleteMany,
  onClearAll,
  onAddBilibili,
  onPlayBilibili,
  customPlaylists = [],
  onCreatePlaylist,
  onDeletePlaylist,
  onRemoveFromPlaylist,
  onPlaySavedItem,
  likedIds,
  onToggleLike,
  onExportM3u,
  onImportM3u,
  onImportFiles,
  onImportFolder,
  collapsed = false
}: PlaylistProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [activeTab, setActiveTab] = useState<'local' | 'bilibili' | 'collections'>('local')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BilibiliSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedPlaylists, setExpandedPlaylists] = useState<Set<string>>(new Set())
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [collectTarget, setCollectTarget] = useState<BilibiliSearchResult | null>(null)
  const [collectListName, setCollectListName] = useState('')
  const [collectPos, setCollectPos] = useState<{ top: number; left: number } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 切换到 B 站搜索 tab 时自动聚焦输入框
  useEffect(() => {
    if (activeTab === 'bilibili') {
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [activeTab])

  // 点击外部关闭收藏弹窗
  useEffect(() => {
    if (!collectTarget) return
    const close = () => { setCollectTarget(null); setCollectPos(null) }
    const timer = setTimeout(() => document.addEventListener('click', close), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', close)
    }
  }, [collectTarget])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const handleSearch = async () => {
    if (!query.trim()) {
      setError('请输入搜索关键词')
      return
    }
    setLoading(true)
    setError('')
    setResults([])
    try {
      const list = await window.electronAPI.bilibiliSearch(query.trim())
      setResults(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setLoading(false)
    }
  }

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

  const playBilibili = useCallback(
    (item: BilibiliSearchResult) => {
      onPlayBilibili(item)
      setActiveTab('local')
    },
    [onPlayBilibili]
  )

  const addBilibili = useCallback(
    (item: BilibiliSearchResult) => {
      onAddBilibili(item)
      setActiveTab('local')
    },
    [onAddBilibili]
  )

  const handleDelete = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete(index)
    },
    [onDelete]
  )

  const handlePlay = useCallback(
    (index: number) => () => {
      onPlay(index)
    },
    [onPlay]
  )

  return (
    <div className={`playlist ${collapsed ? 'collapsed' : ''}`}>
      <div className="playlist-header">
        <div className="playlist-tabs">
          <button
            className={activeTab === 'local' ? 'active' : ''}
            onClick={() => setActiveTab('local')}
          >
            播放列表 ({playlist.length})
          </button>
          <button
            className={activeTab === 'bilibili' ? 'active' : ''}
            onClick={() => setActiveTab('bilibili')}
          >
            B 站搜索
          </button>
          <button
            className={activeTab === 'collections' ? 'active' : ''}
            onClick={() => setActiveTab('collections')}
          >
            收藏歌单 ({customPlaylists.length})
          </button>
        </div>
      </div>

      {activeTab === 'local' ? (
        <>
          {playlist.length > 0 && (
            <div className="playlist-toolbar">
              <span className="toolbar-info">
                {selected.size > 0 ? `已选 ${selected.size} 首` : `共 ${playlist.length} 首`}
              </span>
              <div className="toolbar-actions">
                {onExportM3u && (
                  <button className="toolbar-btn" onClick={onExportM3u} title="导出为 m3u 歌单文件">
                    导出 m3u
                  </button>
                )}
                {onImportM3u && (
                  <button className="toolbar-btn" onClick={onImportM3u} title="从 m3u 文件导入歌曲">
                    导入 m3u
                  </button>
                )}
                <button
                  className="toolbar-btn"
                  onClick={handleDeleteSelected}
                  disabled={selected.size === 0}
                >
                  删除所选
                </button>
                <button className="toolbar-btn danger" onClick={handleClearAll}>
                  清空列表
                </button>
              </div>
            </div>
          )}
          <div className="playlist-items">
            {playlist.length === 0 && (
              <div className="playlist-empty-guide">
                <div className="playlist-empty-icon">♪</div>
                <div className="playlist-empty-title">播放列表是空的</div>
                <div className="playlist-empty-desc">导入本地音频，或搜索 B 站视频加入播放</div>
                <div className="playlist-empty-actions">
                  <button className="playlist-empty-btn primary" onClick={onImportFiles}>导入本地音乐</button>
                  <button className="playlist-empty-btn" onClick={onImportFolder}>导入文件夹</button>
                  {onImportM3u && <button className="playlist-empty-btn" onClick={onImportM3u}>导入 m3u</button>}
                </div>
              </div>
            )}
            {playlist.map((item, idx) => (
              <div
                key={item.id}
                className={`playlist-item ${idx === currentIndex ? 'active' : ''}`}
                onDoubleClick={handlePlay(idx)}
                title={item.name}
              >
                <input
                  type="checkbox"
                  className="item-checkbox"
                  checked={selected.has(idx)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(idx)}
                />
                <span className="item-index">{idx + 1}</span>
                <span className="item-name">{item.name}</span>
                <span className="item-size">
                  {item.source === 'bilibili' ? 'B站' : formatSize(item.size)}
                </span>
                <button
                  className={`item-like ${likedIds?.has(item.path) ? 'liked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleLike?.(item)
                  }}
                  title={likedIds?.has(item.path) ? '取消喜欢' : '喜欢'}
                >
                  <HeartIcon active={likedIds?.has(item.path)} size={15} />
                </button>
                <button
                  className="item-delete"
                  onClick={handleDelete(idx)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      ) : activeTab === 'bilibili' ? (
        <div className="bilibili-panel">
          <div className="search-box">
            <input
              className="search-input"
              type="text"
              placeholder="搜索 B 站视频，仅播放音频"
              value={query}
              ref={searchInputRef}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="search-btn" onClick={handleSearch} disabled={loading}>
              {loading ? '搜索中' : '搜索'}
            </button>
          </div>

          {error && <div className="search-error">{error}</div>}

          <div className="search-results">
            {results.length === 0 && !loading && !error && (
              <div className="empty-tip">输入关键词搜索 B 站视频</div>
            )}
            {results.map((item) => (
              <div
                key={item.bvid}
                className="search-item"
                onDoubleClick={() => playBilibili(item)}
                title="双击播放"
              >
                <img
                  className="search-cover"
                  src={item.pic}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <div className="search-info">
                  <div className="search-title">{item.title}</div>
                  <div className="search-meta">
                    {item.author} · {item.duration}
                  </div>
                </div>
                <div className="search-actions">
                  <button
                    className="search-add"
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = e.currentTarget.getBoundingClientRect()
                      setCollectPos({ top: rect.bottom + 4, left: rect.right - 240 })
                      setCollectTarget(item)
                    }}
                    title="收藏到歌单"
                  >
                    +
                  </button>
                  <button
                    className="search-play"
                    onClick={(e) => {
                      e.stopPropagation()
                      playBilibili(item)
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
      ) : null}
      {/* 收藏弹窗（fixed 定位，避免被搜索框裁剪） */}
      {collectTarget && collectPos && (
        <div
          className="search-collect-popup-fixed"
          style={{ top: collectPos.top, left: collectPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="scp-header">添加到歌单</div>
          <div className="scp-list">
            {customPlaylists.length === 0 && (
              <div className="scp-empty">暂无歌单</div>
            )}
            {customPlaylists.map((pl) => (
              <button
                key={pl.id}
                className="scp-item"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddToPlaylist?.(pl.id, {
                    source: 'bilibili',
                    path: collectTarget.bvid,
                    name: collectTarget.title,
                    cover: collectTarget.pic
                  })
                  setCollectTarget(null)
                  setCollectPos(null)
                  setCollectListName('')
                }}
              >
                <span className="scp-item-name">{pl.name}</span>
                <span className="scp-item-count">{pl.items.length}</span>
              </button>
            ))}
          </div>
          <div className="scp-create">
            <input
              className="scp-input"
              type="text"
              placeholder="新建歌单"
              value={collectListName}
              onChange={(e) => setCollectListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && collectListName.trim()) {
                  e.stopPropagation()
                  const id = onCreatePlaylist?.(collectListName) || ''
                  if (id) {
                    onAddToPlaylist?.(id, {
                      source: 'bilibili',
                      path: collectTarget.bvid,
                      name: collectTarget.title,
                      cover: collectTarget.pic
                    })
                  }
                  setCollectTarget(null)
                  setCollectPos(null)
                  setCollectListName('')
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="scp-create-btn"
              disabled={!collectListName.trim()}
              onClick={(e) => {
                e.stopPropagation()
                if (!collectListName.trim()) return
                const id = onCreatePlaylist?.(collectListName) || ''
                if (id) {
                  onAddToPlaylist?.(id, {
                    source: 'bilibili',
                    path: collectTarget.bvid,
                    name: collectTarget.title,
                    cover: collectTarget.pic
                  })
                }
                setCollectTarget(null)
                setCollectPos(null)
                setCollectListName('')
              }}
            >
              +
            </button>
          </div>
        </div>
      )}
      {activeTab === 'collections' && (
        <div className="collections-tab">
          {/* 新建歌单 */}
          <div className="collection-create-bar">
            <input
              className="collection-create-input"
              type="text"
              placeholder="新建歌单"
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
              className="collection-create-btn"
              disabled={!newPlaylistName.trim()}
              onClick={() => {
                if (!newPlaylistName.trim()) return
                onCreatePlaylist?.(newPlaylistName)
                setNewPlaylistName('')
              }}
            >
              <PlusIcon size={16} />
            </button>
          </div>
          {/* 歌单列表 */}
          <div className="collections-list">
            {customPlaylists.length === 0 && (
              <div className="empty-tip">暂无歌单，在上方创建</div>
            )}
            {customPlaylists.map((pl) => {
              const expanded = expandedPlaylists.has(pl.id)
              return (
                <div key={pl.id} className="collection-card">
                  <div className="collection-card-header">
                    <button
                      className="collection-card-toggle"
                      onClick={() =>
                        setExpandedPlaylists((prev) => {
                          const next = new Set(prev)
                          if (next.has(pl.id)) next.delete(pl.id)
                          else next.add(pl.id)
                          return next
                        })
                      }
                    >
                      <span className="collection-card-title">{pl.name}</span>
                      <span className="collection-card-count">{pl.items.length} 首</span>
                      <span className={`collection-card-arrow ${expanded ? 'open' : ''}`}>▸</span>
                    </button>
                    <button
                      className="collection-card-delete-btn"
                      title="删除歌单"
                      onClick={() => {
                        if (window.confirm(`确定删除歌单"${pl.name}"吗？歌曲不会被删除。`)) {
                          onDeletePlaylist?.(pl.id)
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {expanded && (
                    <div className="collection-card-items">
                      {pl.items.length === 0 ? (
                        <div className="empty-tip">歌单为空</div>
                      ) : (
                        pl.items.map((item, idx) => (
                          <div
                            key={`${item.path}-${idx}`}
                            className="collection-item"
                            onDoubleClick={() => onPlaySavedItem?.(item)}
                            title="双击播放"
                          >
                            <span className="collection-item-name">
                              {item.name.replace(/\.[^/.]+$/, '')}
                            </span>
                            <span className="collection-item-source">
                              {item.source === 'bilibili' ? 'B站' : ''}
                            </span>
                            <button
                              className="collection-item-remove"
                              onClick={(e) => {
                                e.stopPropagation()
                                onRemoveFromPlaylist?.(pl.id, idx)
                              }}
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
        </div>
      )}
    </div>
  )
}

export default memo(Playlist)
