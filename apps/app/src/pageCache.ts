/** The worker owns atomic asset updates and navigation; registration never gates rendering. */
export function registerPageCache(liveDev: boolean) {
  if (!('serviceWorker' in navigator)) return
  const workers = navigator.serviceWorker
  const check = () => workers.controller?.postMessage({ type: 'yonder:check' })
  window.addEventListener('online', check)
  void workers.register('/yonder-sw.js', { updateViaCache: 'none' })
    .then(() => workers.ready)
    .then((registration) => registration.active?.postMessage({ type: 'yonder:check' }))
    .catch((error) => console.warn('页面缓存注册失败，下次打开时重试', error))
  if (liveDev) {
    const events = new EventSource('/__yonder_dev/events')
    events.onmessage = check
  }
}
