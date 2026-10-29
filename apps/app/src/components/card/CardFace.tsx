import { QRCodeSVG } from 'qrcode.react'
import type { CSSProperties, ReactNode } from 'react'
import type { Actor, CardDisplay, CardFace } from '../../api/types'
import mark from '../../assets/brand/yonder-mark.svg?raw'
import { AvatarImage } from '../../ui/Avatar'
import { THEMES } from './themes'

const inline = mark.replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%"').replace(/fill="#[0-9a-f]{6}"/i, 'fill="currentColor"').replace(/<title>.*?<\/title>/, '')
const u = (n: number) => `${n}cqw`

export interface CardFaceProps {
  name: string
  avatarUrl?: string
  agent?: boolean
  /** 没有 face.headline 时的一句话 */
  headline?: string | null
  face?: CardFace
  display?: CardDisplay
  /** 仅 Agent：在线状态 */
  online?: boolean
  /** 底栏名字下的小字，如 Agent */
  badge?: string
  /** 右上角，如分享按钮 */
  action?: ReactNode
  className?: string
}

/** 竖版名片（3:4.3）：封面 / 一句话 / 标签 / 一个小节 / 底栏。所有尺寸按卡宽的 cqw 缩放，缩略图与大卡同一份。 */
export function CardFaceView({ name, avatarUrl, agent, headline, face, display, online, badge, action, className }: CardFaceProps) {
  const t = THEMES[face?.theme ?? 'mist']
  const line = face?.headline?.trim() || headline?.trim() || ''
  const tags = face?.tags ?? []
  const section = face?.section
  const sticker = face?.sticker
  const bare = !line && !tags.length && !section
  const style: CSSProperties = { containerType: 'inline-size', aspectRatio: '3 / 4.3', borderRadius: '8% / 5.58%', background: t.bg, color: t.fg }
  const frame: CSSProperties = sticker?.frame === 'stamp' ? { outline: `${u(0.9)} solid ${t.bg}`, outlineOffset: u(1.8), boxShadow: `0 0 0 ${u(2.6)} ${t.edge}`, borderRadius: u(1.8) } : sticker?.frame === 'round' ? { borderRadius: u(5) } : {}
  return (
    <div style={style} className={`relative flex w-full flex-col overflow-hidden shadow-soft ${className ?? ''}`}>
      <div className="relative grid place-items-center overflow-hidden" style={{ height: bare && !display && !sticker?.url ? '100%' : '42%', flexShrink: 1, background: `linear-gradient(${t.from}, ${t.to})` }}>
        {display ? <iframe title="展示卡片" sandbox="" srcDoc={display.kind === 'svg' ? `<style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}</style>${display.source}` : display.source} className="pointer-events-none h-full w-full border-0" />
          : sticker?.url ? <img src={sticker.url} alt="" style={{ width: '58%', aspectRatio: '4 / 3', objectFit: 'cover', background: t.stickerbg, ...frame }} />
          : bare ? <span className="max-w-[80%] truncate text-center font-extrabold" style={{ fontSize: u(9) }}>{name}</span> : null}
        {action && <div className="absolute" style={{ top: u(4), right: u(4) }}>{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 flex-col overflow-hidden ${bare ? 'hidden' : 'flex'}`} style={{ padding: `${u(5)} ${u(6.5)} 0`, gap: u(3.5) }}>
        {line && <p className="line-clamp-2 break-words font-extrabold" style={{ fontSize: u(8.6), lineHeight: 1.15, letterSpacing: '-0.02em' }}>{line}</p>}
        {!!tags.length && <div className="flex flex-wrap" style={{ gap: u(1.8) }}>{tags.map((tag) => <span key={tag} className="rounded-full" style={{ padding: `${u(1.4)} ${u(3.2)}`, fontSize: u(3.7), background: t.chip }}>{tag}</span>)}</div>}
        {section && <div style={{ fontSize: u(3.8), lineHeight: 1.5, opacity: 0.85 }}><b className="block font-semibold" style={{ fontSize: u(3.3), opacity: 0.7 }}>{section.title}</b><span className="line-clamp-3">{section.body}</span></div>}
      </div>
      <div className="flex shrink-0 items-center" style={{ height: u(24), gap: u(3.5), padding: `0 ${u(5)}`, background: t.footbg }}>
        <span className="flex shrink-0 items-center justify-center overflow-hidden font-bold" style={{ width: u(14), height: u(14), fontSize: u(5.5), borderRadius: agent ? u(4) : '50%', background: agent ? '#111111' : t.avbg, color: agent ? '#ffffff' : t.avfg }}>
          <AvatarImage url={avatarUrl}>{agent ? <span className="h-full w-full" style={{ padding: u(1.6) }} dangerouslySetInnerHTML={{ __html: inline }} /> : [...name][0]}</AvatarImage>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold" style={{ fontSize: u(4.6) }}>{name}</span>
          {(badge || online !== undefined) && <span className="flex items-center opacity-70" style={{ fontSize: u(3.4), gap: u(1.6) }}>{badge}{online !== undefined && <><i className={online ? 'bg-online' : 'bg-offline'} style={{ width: u(2), height: u(2), borderRadius: '50%' }} />{online ? '在线' : '离线'}</>}</span>}
        </span>

      </div>
    </div>
  )
}

/** 扫码版与保存图使用相同字段；介绍封面不进入二维码名片。 */
export function CardQrView({ actor, url, headline, theme = 'mist' }: { actor: Actor; url: string; headline?: string | null; theme?: CardFace['theme'] }) {
  if (actor.kind === 'agent' && actor.public !== true) return <p className="p-6 text-small text-muted">此 Agent 未公开，无法分享二维码</p>
  const t = THEMES[theme]
  const agent = actor.kind === 'agent'
  return <div className="relative aspect-[3/4.3] w-full overflow-hidden text-center shadow-soft" style={{ background: t.bg, color: t.fg, containerType: 'inline-size', borderRadius: '8% / 5.58%' }}>
    <span className="absolute flex items-center justify-center overflow-hidden font-bold" style={{ top: u(9), left: '8%', width: u(12), height: u(12), borderRadius: agent ? u(3) : '50%', background: agent ? '#111111' : t.avbg, color: agent ? '#ffffff' : t.avfg, fontSize: u(5) }}><AvatarImage url={actor.avatarUrl}>{agent ? <span className="h-[76%] w-[76%]" dangerouslySetInnerHTML={{ __html: inline }} /> : [...actor.name][0]}</AvatarImage></span>
    <p className="absolute right-[8%] left-[24%] truncate text-left font-bold" style={{ top: u(9), fontSize: u(7), lineHeight: 1.2 }}>{actor.name}</p>
    <p className="absolute right-[8%] left-[24%] text-left opacity-70" style={{ top: u(20), fontSize: u(3.8) }}>{agent ? `Agent · ${actor.online ? '在线' : '离线'}` : '个人名片'}</p>
    <p className="absolute inset-x-[8%] line-clamp-2 break-words opacity-80" style={{ top: u(28), fontSize: u(4), lineHeight: 1.4 }}>{headline}</p>
    <div className="absolute bg-white" style={{ left: '12%', top: u(43), width: '76%', padding: u(4), borderRadius: u(4) }}><QRCodeSVG value={url} size={512} marginSize={0} style={{ width: '100%', height: 'auto', display: 'block' }} /></div>
    <p className="absolute inset-x-[8%] opacity-70" style={{ top: u(129), fontSize: u(3.8) }}>扫码查看资料</p>
  </div>
}
