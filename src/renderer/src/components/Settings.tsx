import { memo, useState } from 'react'

interface SettingsProps {
  downloadDir: string
  onDownloadDirChange: (dir: string) => void
}

function Settings({ downloadDir, onDownloadDirChange }: SettingsProps) {
  const [choosing, setChoosing] = useState(false)

  const handleChooseDir = async () => {
    setChoosing(true)
    try {
      const dir = await window.electronAPI.chooseDownloadDir()
      if (dir) onDownloadDirChange(dir)
    } finally {
      setChoosing(false)
    }
  }

  return (
    <div className="settings-panel">
      <h3 className="settings-title">下载设置</h3>

      <div className="settings-row">
        <div className="settings-row-info">
          <span className="settings-row-label">下载目录</span>
          <span className="settings-row-value">
            {downloadDir || '未设置'}
          </span>
        </div>
        <button
          className="settings-row-btn"
          onClick={handleChooseDir}
          disabled={choosing}
        >
          {choosing ? '...' : '选择文件夹'}
        </button>
      </div>

      {!downloadDir && (
        <p className="settings-hint">
          设置下载目录后，即可将 B 站音频下载到本地保存
        </p>
      )}
    </div>
  )
}

export default memo(Settings)
