import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { RpcError, rpc } from "../../api/client";
import { setActiveNode, setCloudDevice, useActiveNode } from "../../api/nodes";
import { type SessionOptions as Options, type RuntimeChoice, useRuntimes } from "../../api/session-options";
import { mux } from "../../api/stream";
import { workPath } from "../../shell/workRoutes";
import { RuntimePicker, SessionOptions } from "../../ui/SessionOptions";

export function NewTask({
	onClose,
	initial,
	parent,
}: {
	onClose(): void;
	initial?: RuntimeChoice;
	parent?: string;
	agent?: string;
}) {
	const active = useActiveNode();
	const { accountId } = useRuntimes();
	const [target, setTarget] = useState<RuntimeChoice>(initial ?? active);
	const [options, setOptions] = useState<Options>({ permission: "bypass", resources: [], effort: "auto" });
	const [opening, setOpening] = useState(false);
	const [error, setError] = useState("");
	const [unknown, setUnknown] = useState(false);
	const navigate = useNavigate();
	const qc = useQueryClient();
	const choose = (runtime: RuntimeChoice) => {
		setTarget(runtime);
		setOptions({ permission: "bypass", resources: [], effort: "auto" });
		setError("");
	};
	const open = async () => {
		if (opening) return;
		setOpening(true);
		setError("");
		try {
			const sameHost = target.id === active.id;
			const session = await rpc<{ id: string }>(
				"sessions.open",
				{
					preset: "default",
					close: "manual",
					options,
					...(sameHost && parent ? { parent } : {}),
				},
				undefined,
				target,
			);
			if (target.id !== active.id) {
				mux.reset();
				await qc.cancelQueries();
				qc.clear();
				if (target.deviceId && accountId) setCloudDevice(accountId, { id: target.deviceId, name: target.name });
				else setActiveNode(target.id);
			}
			await qc.invalidateQueries({ queryKey: ["sessions"] });
			void navigate(workPath({ session: session.id, ...(target.deviceId ? { deviceId: target.deviceId } : {}) }));
			onClose();
		} catch (failure) {
			if (failure instanceof RpcError && failure.code === "outcome_unknown") {
				setUnknown(true);
				setError("请求结果尚未确认。请关闭窗口并检查会话列表，避免重复创建。");
			} else setError(failure instanceof Error ? failure.message : "新建会话失败");
		} finally {
			setOpening(false);
		}
	};
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !opening) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30" />
				<Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(720px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-card bg-raised p-4 shadow-float outline-none">
					<div className="flex items-center justify-between gap-3">
						<Dialog.Title className="text-title font-semibold">新建会话</Dialog.Title>
						<Dialog.Close
							disabled={opening}
							aria-label="关闭"
							className="press grid size-10 place-items-center rounded-full hover:bg-tone"
						>
							<X size={18} />
						</Dialog.Close>
					</div>
					<Dialog.Description className="mt-1 mb-4 text-small text-muted">
						{parent
							? "原会话和渠道权限保持不变，在这里选择新会话的运行位置与资源。"
							: "选择 Agent 的运行位置、工作区和模型，随后开始对话。"}
					</Dialog.Description>
					<SessionOptions
						key={target.id}
						node={target}
						value={options}
						onChange={(patch) => setOptions((value) => ({ ...value, ...patch }))}
						disabled={opening}
						runtime={<RuntimePicker value={target} onChange={choose} disabled={opening || unknown} />}
					/>
					{error && (
						<p role="alert" className="mt-3 text-small text-danger">
							{error}
						</p>
					)}
					<div className="mt-5 flex justify-end">
						<button
							type="button"
							className="press min-h-11 rounded-control bg-accent px-4 text-small text-on-accent disabled:opacity-40"
							disabled={
								opening ||
								unknown ||
								target.online === false ||
								(!!target.deviceId && target.workProtocol !== undefined && target.workProtocol !== 1)
							}
							onClick={() => void open()}
						>
							{opening ? "正在创建…" : "创建会话"}
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
