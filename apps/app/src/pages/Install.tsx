import { Copy } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'

const TEMPLATE = "请把这台设备上的 Yonder 连接到我的名片服务 {ENDPOINT}。我已登录网页并发起邀请，无需再打开确认页。\n\n1. 先执行 yonder version，确认实际版本和 home。如果找不到 Yonder，请告知我安装入口是官方仓库 https://github.com/GoYonderTogether/yonder-harness 的 docs/spec/09-cli-release.md §3；安装必须固定到已审核的官方 release。不要编造安装命令或版本，不要把开发分支当作官方发行版。包含 card 插件及邀请码兑换功能的官方发行版仍待发布；若当前版本不含这些功能，请明确说明并停止，不消耗邀请码。\n2. 执行 yonder plugins list、yonder channels list，核对实际加载状态。若 card 尚未启用，告诉我以下真实启用步骤，并在当前 home 保留已有配置地完成：用 yonder plugins add @yonder/plugin-channel-card 添加已安装发行包（该命令不下载包）；在 home/yonder.yaml 的 channels 中加入 card: { type: card, endpoint: \"{ENDPOINT}\" }。插件加载项以 yonder.yaml.plugins 为准，应有 use: \"@yonder/plugin-channel-card\"，不要重复添加。yonder.yaml 的插件和渠道变更需要重启；用 yonder doctor 校验，已安装服务用 yonder service restart，手动运行的 harness 按原方式重启，再核对运行中的渠道。不要启动第二个内核。若已有 card 实例指向其他 endpoint，不要覆盖或替换其令牌，请报告冲突。\n3. 连接会登记当前实例全部启用的 Agent。消息仍需各 Agent 的 agent.yaml 中已有的 card 渠道绑定才会唤醒；不要擅自扩大绑定或主人身份关联。若要使用名片草稿工具，需在相应 Agent 的 defaults.plugins 或实际 profile.plugins 中保留原列表并加入 channel-card（profile 数组会整体替换 defaults），工具选择须包含 channel-card_card_push，且该 profile 须具有 write、network 能力；无需为设备登录开启全部工具。\n4. 执行 yonder channels login card --verify-code {CODE}。邀请码是十位数字，十分钟有效且只能使用一次；不要在回复或日志中回显邀请码，不要打印任何 token、凭据或私有文件内容。\n5. 如实报告命令返回的结果：connected 为兑换成功并已登记 Agent、发起连接；already-connected 为本设备已连接此服务且未再次兑换；invalid-code 请我在网页重新添加设备获取邀请码；retry-later 请稍后重试。不要把契约测试或命令返回当作网页消息收发的真实验收。"
export const connectionPrompt = (code: string) => TEMPLATE.replaceAll('{CODE}', code).replaceAll('{ENDPOINT}', location.origin)

type Tab = 'prompt' | 'terminal'
export function Install() {
  const [tab, setTab] = useState<Tab>('prompt')
  const [invite, setInvite] = useState<{ code: string; expiresAt: string }>()
  const code = invite && Date.parse(invite.expiresAt) > Date.now() ? invite.code : '__________'
  const content = tab === 'prompt' ? connectionPrompt(code) : `yonder channels login card --verify-code ${code}`
  const copy = async () => {
    let current = invite && Date.parse(invite.expiresAt) > Date.now() ? invite : undefined
    if (!current) {
      try { current = await api.createInvite(); setInvite(current) }
      catch (error) {
        const message = error instanceof Error ? error.message : ''
        toast(/401|unauth|登录/i.test(message) ? '请登录后再获取连接邀请码' : message || '邀请码生成失败')
        return
      }
    }
    try {
      await navigator.clipboard.writeText(tab === 'prompt' ? connectionPrompt(current.code) : `yonder channels login card --verify-code ${current.code}`)
      toast('已复制')
    }
    catch { toast('复制失败，请长按选中文本复制') }
  }
  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-2xl px-4 pt-10 pb-16 md:px-6 md:pt-20">
        <h1 className="display rise">拥有自己的 Agent</h1>
        <div className="mt-6 flex gap-2" role="tablist">
          {(['prompt', 'terminal'] as const).map((key) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`press rounded-full px-4 py-2 text-small ${tab === key ? 'bg-accent text-on-accent' : 'bg-tone text-muted'}`}>{key === 'prompt' ? '提示词' : '终端命令'}</button>)}
        </div>
        <pre className="rise mt-5 max-h-[65dvh] select-text overflow-auto whitespace-pre-wrap rounded-card bg-ink p-5 font-mono text-small leading-relaxed text-ground">{content}</pre>
        <div className="rise mt-4 flex items-center gap-4">
          <Button variant="primary" onClick={copy}><Copy size={15} />复制{tab === 'prompt' ? '提示词' : '命令'}</Button>
          <Link to="/" className="text-small text-muted underline underline-offset-4 hover:text-ink">先逛逛</Link>
        </div>
      </div>
    </div>
  )
}
