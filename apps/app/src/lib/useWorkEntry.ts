import { useQuery } from '@tanstack/react-query'
import { RpcError, rpc } from '../work/api/client'
import { featureContext, featureVisible } from '../work/capabilities/features'
import type { NodeFacts } from '../work/api/types'

/**
 * 「工作」入口是否显示：由能力表（work/capabilities/features.ts 的 work）决定。
 * 网关存在但未登录（unauthorized）也显示，让用户进去登录；没有网关（请求失败、非网关响应）则隐藏。
 */
export function useWorkEntry(): boolean {
  const probe = useQuery({
    queryKey: ['work-gateway'],
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<'facts' | 'login' | 'none'> => {
      try {
        const facts = await rpc<NodeFacts>('capabilities.get')
        return featureVisible('work', featureContext({ gatewayAuthed: true, facts })).state === 'show' ? 'facts' : 'none'
      } catch (error) {
        return error instanceof RpcError && error.code === 'unauthorized' ? 'login' : 'none'
      }
    },
  })
  return probe.data === 'facts' || probe.data === 'login'
}
