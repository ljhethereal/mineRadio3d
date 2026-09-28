import { useEffect, useState } from 'react'

const isMac = navigator.userAgent.includes('Macintosh')

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const sync = async () => {
      const maximized = await window.electronAPI.isMaximized()
      setIsMaximized(maximized)
    }
    sync()

    const handleResize = () => sync()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className={`title-bar ${isMac ? 'title-bar-mac' : ''}`}>
      <div className="title-bar-drag">
        {isMac && <span className="title-bar-traffic-spacer" />}
        <div className="title-bar-logo">
          <span className="title-bar-mark">M</span>
          {!isMac && <span className="title-bar-name">MineRadio 3D</span>}
        </div>
      </div>
      {isMac && <span className="title-bar-center-name">MineRadio 3D</span>}
      <div className="title-bar-controls">
        {!isMac && (
          <>
            <button
              className="title-bar-btn minimize"
              onClick={() => window.electronAPI.minimizeWindow()}
              title="最小化"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0" y="4" width="10" height="2" rx="1" fill="currentColor" />
              </svg>
            </button>
            <button
              className="title-bar-btn maximize"
              onClick={async () => {
                await window.electronAPI.maximizeWindow()
                setIsMaximized(await window.electronAPI.isMaximized())
              }}
              title={isMaximized ? '还原' : '最大化'}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path d="M2 4v4h4V4H2zm1-3v2h4v4h2V1H3z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <rect
                    x="0.5"
                    y="0.5"
                    width="9"
                    height="9"
                    rx="1"
                    stroke="currentColor"
                    fill="none"
                    strokeWidth="1.5"
                  />
                </svg>
              )}
            </button>
            <button
              className="title-bar-btn close"
              onClick={() => window.electronAPI.closeWindow()}
              title="关闭"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path
                  d="M1 1l8 8M9 1L1 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
