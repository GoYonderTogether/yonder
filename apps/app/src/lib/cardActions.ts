import { entityRef } from './entityRef'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api'
import type { CardSource } from '../api/types'
import { selectAccount } from '../cache'
import { $session } from '../store'
import { toast } from '../ui/Toast'
import { useStore } from '@nanostores/react'

export async function copyText(text: string, message = '链接已复制') {
  try { await navigator.clipboard.writeText(text); toast(message) }
  catch { toast('复制失败，请长按文本复制', true) }
}

/** 「Hi」：必要时建匿名账号，收下这张名片，再开私聊。 */
export function useStartChat() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const session = useStore($session)
  const [busy, setBusy] = useState(false)
  const start = async (respondentId: string, collect?: { cardId: string; source?: CardSource }) => {
    setBusy(true)
    try {
      if (!session) { const anonymous = await api.createAnonymous(); selectAccount(anonymous.actor.id, qc); $session.set(anonymous) }
      else if (!session.actor.anonymous && collect) { await api.collectCard(collect.cardId, collect.source); void qc.invalidateQueries({ queryKey: ['cards'] }) }
      const conv = await api.openDm(respondentId)
      nav(`/c/${entityRef(conv)}`)
    } catch (error) { toast(error instanceof Error ? error.message : '无法打开会话', true) }
    finally { setBusy(false) }
  }
  return { busy, start }
}
