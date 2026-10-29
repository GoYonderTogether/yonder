import { useStore } from '@nanostores/react'
import { MessageCircle, Users } from 'lucide-react'
import { Suspense } from 'react'
import { NavLink, Outlet, useMatch } from 'react-router'
import { cn } from '../lib/cn'
import { PageLoading } from './PageLoading'
import { $session } from '../store'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'

const items = [
  { to: '/', label: '消息', icon: MessageCircle },
  { to: '/contacts', label: '通讯录', icon: Users },
  { to: '/me', label: '我', icon: null },
]

export function Shell() {
  const me = useStore($session)?.actor
  const hidden = [useMatch('/c/:id'), useMatch('/contacts/:id')].some(Boolean)
  const active = (path: string) => path === '/' ? location.pathname === '/' || location.pathname.startsWith('/c/') : location.pathname.startsWith(path)
  const mobileLinks = items.map(({ to, label, icon: Icon }) => (
    <NavLink key={to} to={to} aria-label={label} title={label}
      className={cn('press flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[12px] text-muted', active(to) && 'text-accent-ink')}>
      {Icon ? <Icon size={22} strokeWidth={1.75} /> : me && <Avatar actor={me} size={22} />}
      {label}
    </NavLink>
  ))
  return (
    <div className="flex h-full flex-col lg:flex-row">
      <nav aria-label="主导航" className="hidden w-16 shrink-0 flex-col items-center gap-1 bg-rail py-4 lg:flex">
        <NavLink to="/" aria-label="首页" title="首页" className="press relative flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-tone-2 hover:text-ink"><Logo /></NavLink>
        <div className="mt-5 flex flex-col gap-1">
          {items.filter((item) => item.icon).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={label} aria-label={label} className={cn('press relative flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-tone-2 hover:text-ink', active(to) && 'bg-raised text-accent-ink shadow-sm')}>
              {active(to) && <span className="absolute -left-2.5 h-5 w-[3px] rounded-full bg-accent" />}
              {Icon && <Icon size={20} strokeWidth={1.75} />}
            </NavLink>
          ))}
        </div>
        <NavLink to="/me" aria-label="我" title="我" className="press mt-auto rounded-full">{me && <Avatar actor={me} size={32} />}</NavLink>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {import.meta.env.VITE_API !== 'http' && <div role="status" className="shrink-0 bg-tone-2 px-3 py-1 text-center text-[12px] text-muted">本地原型模式 · 展示数据仅供界面验收，不代表真实用户</div>}
        <div className="min-h-0 min-w-0 flex-1"><Suspense fallback={<PageLoading />}><Outlet /></Suspense></div>
      </div>
      {!hidden && <nav aria-label="主导航" className="flex shrink-0 bg-rail pb-[env(safe-area-inset-bottom)] lg:hidden">{mobileLinks}</nav>}
    </div>
  )
}
