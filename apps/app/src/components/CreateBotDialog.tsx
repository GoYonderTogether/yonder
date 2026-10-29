import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { toast } from "../ui/Toast";

/** 新建云端 Bot：只填名字，其余用服务端默认值；能力随使用积累，不在创建时配置。 */
export function CreateBotDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const create = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		try {
			await api.createBot({ name: name.trim() });
			await qc.invalidateQueries({ queryKey: ["contacts"] });
			toast("Bot 已创建");
			setName("");
			onOpenChange(false);
		} catch (error) {
			toast(error instanceof Error ? error.message : "创建失败", true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fade fixed inset-0 z-40 bg-black/30" />
				<Dialog.Content className="rise fixed inset-x-0 bottom-0 z-50 flex flex-col gap-5 rounded-t-[24px] bg-raised p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-float outline-none md:inset-auto md:top-1/2 md:left-1/2 md:w-[420px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[24px]">
					<Dialog.Title className="text-[20px] font-semibold tracking-tight">新建 Bot</Dialog.Title>
					<Dialog.Description className="sr-only">输入名字即可创建云端 Bot</Dialog.Description>
					<form
						className="flex flex-col gap-5"
						onSubmit={(e) => {
							e.preventDefault();
							void create();
						}}
					>
						<Field label="名字" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
						<div className="flex gap-2">
							<Button variant="primary" type="submit" disabled={!name.trim() || busy}>
								创建
							</Button>
							<Dialog.Close asChild>
								<Button variant="ghost">取消</Button>
							</Dialog.Close>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
