type ToastType = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  type: ToastType
  text: string
}

let container: HTMLDivElement | null = null
let nextId = 1

function ensureContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) return container
  container = document.createElement('div')
  container.className = 'toast-container'
  document.body.appendChild(container)
  return container
}

function removeToast(id: number): void {
  const el = document.querySelector(`[data-toast-id="${id}"]`)
  if (!el) return
  el.classList.add('leaving')
  window.setTimeout(() => el.remove(), 250)
}

export function toast(text: string, type: ToastType = 'info', duration = 2800): void {
  const c = ensureContainer()
  const id = nextId++
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.dataset.toastId = String(id)
  el.textContent = text
  el.addEventListener('click', () => removeToast(id))
  c.appendChild(el)
  requestAnimationFrame(() => el.classList.add('in'))
  window.setTimeout(() => removeToast(id), duration)
}

export function toastSuccess(text: string): void {
  toast(text, 'success')
}

export function toastError(text: string): void {
  toast(text, 'error')
}