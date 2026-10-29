import { useState } from "react";
import { type Actor, httpApi, type VerifyKind } from "../../api/social";
import { Button } from "../../ui/kit/Button";
import { maskTarget } from "./lib/session";
import { CodeForm } from "./VerifySheet";

const KINDS: { kind: VerifyKind; label: string }[] = [
	{ kind: "phone", label: "手机号" },
	{ kind: "email", label: "邮箱" },
];

/**
 * 账号与安全：显示已绑定的手机号 / 邮箱（脱敏），可绑定或换绑，各自 send-code + confirm。
 * 换绑成功后服务端撤销该账号的所有会话，所以这里只提示重新登录，不自行刷新登录态。
 */
export function AccountSecurity({ actor, onSignedOut }: { actor: Actor; onSignedOut?(): void }) {
	const [editing, setEditing] = useState<VerifyKind | undefined>();
	const [done, setDone] = useState("");
	if (done)
		return (
			<div className="flex flex-col gap-3">
				<p role="status" className="text-small">
					{done}
				</p>
				<p className="text-small text-muted">为了账号安全，已退出所有设备上的登录。</p>
				<Button variant="primary" onClick={onSignedOut}>
					去重新登录
				</Button>
			</div>
		);
	return (
		<div className="flex flex-col gap-4">
			{KINDS.map(({ kind, label }) => {
				const bound = maskTarget(kind, actor[kind]);
				if (editing === kind)
					return (
						<section key={kind} aria-label={`${label}验证`} className="flex flex-col gap-3">
							<div className="flex items-center justify-between">
								<h3 className="text-small font-medium">{bound ? `换绑${label}` : `绑定${label}`}</h3>
								<Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>
									取消
								</Button>
							</div>
							<CodeForm
								kinds={[kind]}
								send={(input) => httpApi.sendBindCode(input.kind, input.target)}
								confirm={(input) => httpApi.confirmBindCode(input.kind, input.target, input.code)}
								onSuccess={() => {
									setEditing(undefined);
									setDone(`${label}已${bound ? "更换" : "绑定"}`);
								}}
								submitLabel={bound ? "确认换绑" : "确认绑定"}
								doneHint="验证码已发送，验证成功后需要重新登录"
							/>
						</section>
					);
				return (
					<section key={kind} aria-label={label} className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<p className="text-small font-medium">{label}</p>
							<p className="text-caption text-muted">{bound ?? "未绑定"}</p>
						</div>
						<Button size="sm" onClick={() => setEditing(kind)}>
							{bound ? "换绑" : "绑定"}
						</Button>
					</section>
				);
			})}
			<p className="text-caption text-faint">登录只使用验证码，不设密码。换绑后所有设备需要重新登录。</p>
		</div>
	);
}
