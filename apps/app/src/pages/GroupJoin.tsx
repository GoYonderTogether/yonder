import { ArrowRight } from 'lucide-react'
import { entityRef } from '../lib/entityRef'
import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { api } from '../api'
import { selectAccount } from '../cache'
import { $session } from '../store'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'

/** 群二维码页 /g/:token：显示群名与成员头像，加入后进群；已在群里的人直接进群。 */
export function GroupJoin() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const session = useStore($session)
  const [busy, setBusy] = useState(false)
  const { data: group, isLoading } = useQuery({ queryKey: ['group', token], queryFn: () => api.groupPreview(token) })
  if (isLoading || session === undefined) return <div className="skeleton m-6 h-72 rounded-card" />
  if (group?.member && group.convId) return <Navigate to={`/c/${group.convCode ?? group.convId}`} replace />
  if (!group) return <div className="flex flex-col items-center gap-3 p-8"><h1 className="text-title font-semibold">这个群二维码已失效</h1><Link to="/" className="inline-flex items-center gap-1 text-small text-muted">回到消息 <ArrowRight size={16} aria-hidden="true" /></Link></div>
  const join = async () => {
    setBusy(true)
    try {
      if (!session) { const anonymous = await api.createAnonymous(); selectAccount(anonymous.actor.id, qc); $session.set(anonymous) }
      const conv = await api.joinGroup(token)
      void qc.invalidateQueries({ queryKey: ['convs'] })
      nav(`/c/${entityRef(conv)}`, { replace: true })
    } catch (error) { toast(error instanceof Error ? error.message : '加入失败', true) }
    finally { setBusy(false) }
  }
  return (
    <div className="scroll-y h-dvh bg-ground">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-6 px-4 py-16 text-center">
        <div className="rise flex flex-col gap-1">
          <h1 className="display">{group.title}</h1>
          <p className="text-[14px] text-muted">{group.memberCount} 人</p>
        </div>
        <ul className="rise flex flex-wrap justify-center gap-3" style={{ animationDelay: '60ms' }}>
          {group.members.slice(0, 12).map((m) => <li key={m.id} title={m.name}><Avatar actor={m} size={44} /></li>)}
        </ul>
        <Button variant="primary" className="h-11 w-full" disabled={busy} onClick={join}>加入群聊</Button>
      </div>
    </div>
  )
}
