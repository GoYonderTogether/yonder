import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { api } from '../api'
import { $session } from '../store'
import { selectAccount } from '../cache'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Logo } from '../ui/Logo'
import { toast } from '../ui/Toast'

export function Login() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const loc = useLocation()
  const query = new URLSearchParams(loc.search)
  const next = (loc.state as { next?: string } | null)?.next ?? (query.get('next')?.match(/^\/(?!\/)/) ? query.get('next')! : '/')
  const [mode, setMode] = useState<'login' | 'register'>(query.get('mode') === 'register' ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const s = mode === 'login' ? await api.login({ email, password }) : await api.register({ email, password, name })
      selectAccount(s.actor.id, qc); $session.set(s); nav(next, { replace: true })
    } catch (err) { setError(err instanceof Error ? err.message.includes('history_merge_failed') ? '历史合并未完成，访客记录已保留，请重试' : err.message : '失败') } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="rise flex w-full max-w-sm flex-col gap-5">
        <Logo size={36} />
        <div>
          <h1 className="display">{mode === 'login' ? '登录' : '注册'}</h1>
        </div>
        {mode === 'register' && <Field label="昵称" value={name} onChange={(e) => setName(e.target.value)} />}
        <Field label="邮箱" onFocus={() => toast('邮箱只当登录名，不验证，也不发验证码')} type="text" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="密码" type="password" passwordToggle autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <Button variant="primary" disabled={busy} className="h-11">{mode === 'login' ? '登录' : '创建账号'}</Button>
        <button type="button" className="press self-start text-[14px] text-muted hover:text-ink" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
        </button>
      </form>
    </div>
  )
}
