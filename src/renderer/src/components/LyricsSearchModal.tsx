import { useEffect, useRef, useState } from 'react'
import { NeteaseSong } from '../types'
import { formatTime } from '../utils'

interface LyricsSearchModalProps {
  open: boolean
  initialKeyword: string
  onClose: () => void
  onApply: (songId: number, songName: string) => Promise<boolean>
}

function LyricsSearchModal({ open, initialKeyword, onClose, onApply }: LyricsSearchModalProps) {
  const [keyword, setKeyword] = useState(initialKeyword)
  const [results, setResults] = useState<NeteaseSong[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [applyingId, setApplyingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setKeyword(initialKeyword)
      setResults([])
      setSearched(false)
      setError('')
      setApplyingId(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, initialKeyword])

  if (!open) return null

  const doSearch = async () => {
    const kw = keyword.trim()
    if (!kw || loading) return
    setLoading(true)
    setError('')
    setSearched(false)
    setResults([])
    try {
      const list = await window.electronAPI.searchNeteaseSongs(kw)
      setResults(list)
      if (list.length === 0) setError('未找到相关歌曲，换个关键词试试')
    } catch {
      setError('搜索失败，请检查网络后重试')
    } finally {
      setSearched(true)
      setLoading(false)
    }
  }

  const handleApply = async (song: NeteaseSong) => {
    if (applyingId !== null) return
    setApplyingId(song.id)
    setError('')
    const ok = await onApply(song.id, song.name)
    setApplyingId(null)
    if (!ok) setError(`《${song.name}》没有可用歌词，换一首试试`)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="lyrics-search-mask" onClick={onClose}>
      <div className="lyrics-search-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="lyrics-search-header">
          <div>
            <div className="lyrics-search-title">搜索歌词</div>
            <div className="lyrics-search-sub">从网易云选择匹配的歌曲（选择后立即应用并记住）</div>
          </div>
          <button className="lyrics-search-close" onClick={onClose} title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="lyrics-search-input-row">
          <input
            ref={inputRef}
            className="lyrics-search-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入歌曲名 / 歌手"
            maxLength={80}
          />
          <button className="lyrics-search-go" onClick={doSearch} disabled={loading}>
            {loading ? '搜索中…' : '搜索'}
          </button>
        </div>

        {error && <div className="lyrics-search-error">{error}</div>}

        <div className="lyrics-search-list">
          {loading ? (
            <div className="lyrics-search-empty">正在搜索…</div>
          ) : results.length === 0 ? (
            <div className="lyrics-search-empty">{searched ? '无结果' : '输入关键词后回车搜索'}</div>
          ) : (
            results.map((song) => (
              <button
                key={song.id}
                className="lyrics-search-item"
                onClick={() => handleApply(song)}
                disabled={applyingId !== null}
              >
                <span className="lyrics-search-item-name">{song.name}</span>
                <span className="lyrics-search-item-artist">
                  {song.artist || '未知歌手'}
                  {song.duration > 0 ? ` · ${formatTime(song.duration / 1000)}` : ''}
                </span>
                {song.album && <span className="lyrics-search-item-album">{song.album}</span>}
                {applyingId === song.id && <span className="lyrics-search-item-loading">应用歌词…</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default LyricsSearchModal