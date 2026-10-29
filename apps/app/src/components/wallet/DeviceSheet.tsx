import { Laptop, Monitor, Server } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState } from 'react'
import { api } from '../../api'
import type { Device, DeviceKind } from '../../api/types'
import { cn } from '../../lib/cn'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { toast } from '../../ui/Toast'

export const deviceIcon: Record<DeviceKind, typeof Laptop> = { laptop: Laptop, desktop: Monitor, server: Server, cloud: Server }

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onChange(!on) }}
      className={cn('press relative h-6 w-10 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-tone-2')}>
      <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-raised shadow-sm transition-transform', on && 'translate-x-4')} />
    </button>
  )
}

/** 设备管理：改名、一键开关这台设备上全部 Agent 的联网。 */
export function DeviceSheet({ device, agents, open, onOpenChange, onChanged }: { device: Device; agents: number; open: boolean; onOpenChange: (v: boolean) => void; onChanged: () => void }) {
  const [name, setName] = useState(device.name)
  const Icon = deviceIcon[device.kind]
  const save = async () => {
    try { await api.renameDevice(device.id, name.trim()); onChanged(); toast('已改名'); onOpenChange(false) }
    catch (error) { toast(error instanceof Error ? error.message : '改名失败', true) }
  }
  const power = async (v: boolean) => {
    try { await api.setDeviceOnline(device.id, v); onChanged(); toast(v ? `${device.name} 上的 Agent 已联网` : `${device.name} 上的 Agent 已断开`) }
    catch (error) { toast(error instanceof Error ? error.message : '更新失败', true) }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="rise fixed inset-x-0 bottom-0 z-50 flex max-h-[85%] flex-col gap-5 rounded-t-[24px] bg-raised p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-float outline-none md:inset-auto md:top-1/2 md:left-1/2 md:w-[420px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[24px]">
          <Dialog.Title className="flex items-center gap-3 text-[20px] font-semibold tracking-tight">
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-tone"><Icon size={20} /></span>设备
          </Dialog.Title>
          <Dialog.Description className="sr-only">改名，或开关这台设备上全部 Agent 的联网</Dialog.Description>
          {device.code && <p className="select-text text-small text-muted">设备 ID · {device.code}</p>}
          <Field label="名称" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex items-center justify-between rounded-card bg-tone px-4 py-3">
            <span className="text-[15px]">联网<span className="ml-2 text-[13px] text-muted">{agents} 个 Agent</span></span>
            <Switch on={device.online} onChange={power} label="这台设备联网" />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} disabled={!name.trim() || name.trim() === device.name}>保存</Button>
            <Dialog.Close asChild><Button variant="ghost">关闭</Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
