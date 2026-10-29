import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'

const $toast = atom<{ id: number; text: string; error: boolean } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

/** 轻提醒：底部浮起 2.2 秒后自动消失；同一时间只留一条。提示信息都走这里，不在页面里常驻文字。 */
export function toast(text: string, error = false) {
  clearTimeout(timer)
  $toast.set({ id: Date.now(), text, error })
  timer = setTimeout(() => $toast.set(null), 2200)
}

export function Toaster() {
  const t = useStore($toast)
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-8">
      {t && <div key={t.id} role="status" className={`rise rounded-full bg-raised px-4 py-2.5 text-small shadow-float ${t.error ? 'text-danger' : 'text-ink'}`}>{t.text}</div>}
    </div>
  )
}
