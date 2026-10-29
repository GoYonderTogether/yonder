import type { QueryClient } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import type { Session } from './api/types'

export const CACHE_PREFIX = 'yonder-query-cache:'
export const CACHE_SCHEMA = '1' // Change only when persisted data becomes incompatible.
export const CACHE_MAX_AGE = 30 * 86400_000
export const CACHE_GC_TIME = Infinity // A 30-day timer exceeds setTimeout's ~24.8-day limit and runs immediately.
export const ACCOUNT_KEY = `${CACHE_PREFIX}account`

/** Display snapshot only; every API request still uses the server's session cookie. */
export function readCachedSession(): Session | undefined {
  try {
    const account = localStorage.getItem(ACCOUNT_KEY)
    if (!account || account === 'guest') return
    const cache = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${account}`) ?? 'null') as PersistedClient | null
    if (!cache || cache.buster !== CACHE_SCHEMA || !cache.timestamp || Date.now() - cache.timestamp > CACHE_MAX_AGE) return
    const session = cache.clientState.queries.find((q) => q.queryKey[0] === 'session' && q.queryKey[1] === account)?.state.data as Session | undefined
    if (session?.actor?.id === account && typeof session.actor.name === 'string') return session
  } catch { /* Missing or unreadable storage falls back to the server. */ }
}

export function clearPersistedCache(queryClient?: QueryClient) {
  queryClient?.clear()
  for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key)
  localStorage.removeItem(ACCOUNT_KEY)
}

export function selectAccount(accountId: string | null, queryClient: QueryClient) {
  const previous = localStorage.getItem(ACCOUNT_KEY)
  const next = accountId ?? 'guest'
  if (previous && previous !== next) clearPersistedCache(queryClient)
  localStorage.setItem(ACCOUNT_KEY, next)
}

export const cardDraftKey = (id: string) => `yonder-card-editor:${id}`
export function readCardDraft(id: string) {
  try { return JSON.parse(localStorage.getItem(cardDraftKey(id)) ?? 'null') as { title: string; tagline?: string; md: string; svg: string; audience?: string } | null } catch { return null }
}
// Heading-only templates are still empty cards.
export const hasCardContent = (markdown: string, display: string) => !!display.trim() || markdown.split('\n').some((line) => !!line.trim() && !/^#{1,6}(\s|$)/.test(line.trim()))
