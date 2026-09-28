import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

// 渲染进程全局错误上报：未捕获异常 / 未处理 Promise 拒绝写入主进程日志
const report = (level: 'error' | 'warn', message: unknown): void => {
  try {
    window.electronAPI?.log(level, message)
  } catch {
    /* logging unavailable */
  }
}

window.addEventListener('error', (e) => {
  report('error', e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  report('error', e.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
