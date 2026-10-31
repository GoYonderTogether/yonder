import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { passwordApi } from "../api/password";
import type { Actor, VerifyKind } from "../api/types";
import { passwordError, validateNewPassword } from "../lib/password";
import { maskTarget } from "../lib/verify";
import { $session } from "../store";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { CodeForm } from "./VerifySheet";

function readableError(error: unknown) {
	return Object.assign(new Error(passwordError(error)), {
		retryAfter: error && typeof error === "object" && "retryAfter" in error ? error.retryAfter : undefined,
	});
}
export function PasswordReset({ actor }: { actor: Actor }) {
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState(false),
		[kind, setKind] = useState<VerifyKind>(actor.phone ? "phone" : "email");
	const [password, setPassword] = useState(""),
		[confirmation, setConfirmation] = useState(""),
		[done, setDone] = useState(false);
	const kinds: VerifyKind[] = (["phone", "email"] as const).filter((value) => !!actor[value]);
	const close = () => {
		setBusy(false);
		setEditing(false);
		setPassword("");
		setConfirmation("");
	};
	return (
		<section aria-label="密码" className="border-t border-hairline pt-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 className="text-small font-medium">登录密码</h3>
					<p className="mt-1 text-caption text-muted">使用已验证的手机号或邮箱确认身份。</p>
				</div>
				<Button
					size="sm"
					disabled={busy || !kinds.length}
					onClick={() => {
						if (editing) close();
						else {
							setDone(false);
							setEditing(true);
						}
					}}
				>
					{editing ? "取消" : "重置密码"}
				</Button>
			</div>
			{!kinds.length && <p className="mt-3 text-caption text-muted">请先绑定并验证手机号或邮箱，再设置或重置密码。</p>}
			{actor.code && <p className="mt-3 text-caption text-muted">账号 ID：{actor.code}</p>}
			{done && (
				<p role="status" className="mt-3 text-small">
					密码已重置，其他网页登录已退出。当前登录与设备连接保留。
				</p>
			)}
			{editing && !!kinds.length && (
				<div className="mt-4 flex flex-col gap-4">
					{kinds.length > 1 && (
						<fieldset className="flex gap-2" aria-label="验证身份方式">
							{kinds.map((value) => (
								<Button
									key={value}
									size="sm"
									variant={value === kind ? "primary" : "secondary"}
									disabled={busy}
									onClick={() => setKind(value)}
								>
									{value === "phone" ? "手机号" : "邮箱"} {maskTarget(value, actor[value])}
								</Button>
							))}
						</fieldset>
					)}
					<CodeForm
						key={kind}
						onBusyChange={setBusy}
						kinds={[kind]}
						fixedTarget={{ kind, target: actor[kind] ?? "" }}
						send={() =>
							passwordApi.sendResetCode(kind).catch((error) => {
								throw readableError(error);
							})
						}
						confirm={({ code }) => {
							const invalid = validateNewPassword(password, confirmation);
							if (invalid) throw new Error(invalid);
							return passwordApi.reset(kind, code, password).catch((error) => {
								throw readableError(error);
							});
						}}
						onSuccess={(session) => {
							$session.set(session);
							qc.setQueryData(["session", session.actor.id], session);
							close();
							setDone(true);
						}}
						submitLabel="验证并重置密码"
						doneHint="验证码已发送至已验证的绑定联系方式。"
					>
						<Field
							label="新密码"
							type="password"
							passwordToggle
							autoComplete="new-password"
							minLength={8}
							maxLength={128}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="8–128 位"
							required
						/>
						<Field
							label="确认新密码"
							type="password"
							passwordToggle
							autoComplete="new-password"
							minLength={8}
							maxLength={128}
							value={confirmation}
							onChange={(e) => setConfirmation(e.target.value)}
							required
						/>
					</CodeForm>
				</div>
			)}
		</section>
	);
}
