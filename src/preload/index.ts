import { contextBridge, ipcRenderer } from 'electron'
import type { BilibiliSearchResult, NeteaseSong } from '../renderer/src/types'

export interface MediaFileStat {
  exists: boolean
  name: string
  size: number
  url: string
}

export interface BilibiliAudioData {
  url: string
  backups?: string[]
  title: string
  bitrate?: number
}

export type MediaControlAction = 'toggle' | 'next' | 'prev'

export interface PlaybackState {
  isPlaying: boolean
  hasItem: boolean
  currentTime?: number
  duration?: number
}

const api = {
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFolder'),
  statFile: (filePath: string): Promise<MediaFileStat> => ipcRenderer.invoke('file:stat', filePath),
  readTextFile: (filePath: string): Promise<{ success: boolean; text?: string }> =>
    ipcRenderer.invoke('file:readText', filePath),
  saveTextFile: (params: { defaultName: string; content: string }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('file:saveText', params),
  readM3uFile: (filePath: string): Promise<{ success: boolean; text?: string }> =>
    ipcRenderer.invoke('file:readM3u', filePath),
  openM3uFile: (): Promise<string> => ipcRenderer.invoke('dialog:openM3u'),
  searchNeteaseLyric: (keyword: string): Promise<{ success: boolean; lrc?: string }> =>
    ipcRenderer.invoke('lyrics:searchNetease', keyword),
  searchNeteaseSongs: (keyword: string): Promise<NeteaseSong[]> =>
    ipcRenderer.invoke('lyrics:searchSongs', keyword),
  getNeteaseLyricById: (songId: number): Promise<{ success: boolean; lrc?: string }> =>
    ipcRenderer.invoke('lyrics:getById', songId),
  setFullscreen: (fullscreen: boolean): Promise<void> =>
    ipcRenderer.invoke('window:setFullscreen', fullscreen),
  isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullscreen'),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  bilibiliSearch: (keyword: string): Promise<BilibiliSearchResult[]> =>
    ipcRenderer.invoke('bilibili:search', keyword),
  getBilibiliAudio: (bvid: string, title?: string): Promise<BilibiliAudioData> =>
    ipcRenderer.invoke('bilibili:getAudio', bvid, title),
  chooseDownloadDir: (): Promise<string> => ipcRenderer.invoke('dialog:chooseDirectory'),
  notify: (payload: { title: string; body?: string }): void =>
    ipcRenderer.send('app:notify', payload),
  downloadFile: (params: {
    url: string
    fileName: string
    saveDir: string
  }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('download:saveFile', params),
  getLogPath: (): Promise<string> => ipcRenderer.invoke('app:logPath'),
  log: (level: 'info' | 'warn' | 'error', message: unknown): void =>
    ipcRenderer.send('app:log', level, message),
  reportPlaybackState: (state: PlaybackState): void => {
    ipcRenderer.send('media:state', state)
  },
  onMediaControl: (callback: (action: MediaControlAction) => void): (() => void) => {
    const listener = (_: unknown, action: MediaControlAction): void => callback(action)
    ipcRenderer.on('media:control', listener)
    return () => ipcRenderer.removeListener('media:control', listener)
  },
  onOpenDeepLink: (
    callback: (payload: { type: 'play' | 'open' | 'm3u' | 'file'; url?: string; path?: string }) => void
  ): (() => void) => {
    const listener = (
      _: unknown,
      payload: { type: 'play' | 'open' | 'm3u' | 'file'; url?: string; path?: string }
    ): void => callback(payload)
    ipcRenderer.on('app:open-deep-link', listener)
    return () => ipcRenderer.removeListener('app:open-deep-link', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electronAPI = api
}

export type ElectronAPI = typeof api
