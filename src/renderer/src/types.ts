export interface MediaItem {
  id: string
  path: string
  name: string
  size: number
  url: string
  source: 'local' | 'bilibili'
  bvid?: string
  cover?: string
  backups?: string[]
  bitrate?: number
}

export interface BilibiliSearchResult {
  bvid: string
  title: string
  author: string
  duration: string
  pic: string
}

export interface NeteaseSong {
  id: number
  name: string
  artist: string
  album: string
  duration: number
}

export interface SavedMediaItem {
  source: 'local' | 'bilibili'
  path: string
  name: string
  size?: number
  cover?: string
}

export type PlayMode = 'sequential' | 'list-loop' | 'single-loop' | 'random'

export type ReverbPreset = 'off' | 'on'

export interface CustomPlaylist {
  id: string
  name: string
  items: SavedMediaItem[]
  createdAt: number
}
