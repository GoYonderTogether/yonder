import { type ReactNode, useEffect, useId, useReducer, useState } from "react";
import { api } from "../api";
import type { CodeSent, Session, VerifyKind } from "../api/types";
import {
	canSendCode,
	canVerifyCode,
	initialVerifyForm,
	maskTarget,
	normalizeTarget,
	resendLabel,
	validateCode,
	validateTarget,
	verifyReducer,
} from "../lib/verify";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Window } from "../ui/Window";

const TABS: { kind: VerifyKind; label: string }[] = [
	{ kind: "phone", label: "手机号" },
	{ kind: "email", label: "邮箱" },
];

export interface CodeFormValue {
	kind: VerifyKind;
	target: string;
	code: string;
}

/**
 * 验证码表单本体：选手机或邮箱 → 发码（按服务端 retryAfter 倒计时）→ 填 6 位码 → 提交。
 * 登录、访客额度弹窗和账号绑定共用；发码与校验的具体接口由调用方传入，表单只管流程与校验。
 */
export function CodeForm<Result>({
	kinds = ["phone", "email"],
	children,
	fixedTarget,
	onBusyChange,
	send,
	confirm,
	onSuccess,
	submitLabel = "登录 / 注册",
	doneHint = "验证码已发送，首次登录会自动创建账号",
}: {
	kinds?: VerifyKind[];
	children?: ReactNode;
	fixedTarget?: { kind: VerifyKind; target: string };
	onBusyChange?(busy: boolean): void;
	send(input: { kind: VerifyKind; target: string }): Promise<CodeSent>;
	confirm(input: CodeFormValue): Promise<Result>;
	onSuccess(result: Result): void;
	submitLabel?: string;
	doneHint?: string;
}) {
	const [kind, setKind] = useState<VerifyKind>(fixedTarget?.kind ?? kinds[0] ?? "phone");
	const [target, setTarget] = useState(fixedTarget?.target ?? "");
	const [code, setCode] = useState("");
	const [state, dispatch] = useReducer(verifyReducer, initialVerifyForm);
	const [fieldErrors, setFieldErrors] = useState<{ target?: string; code?: string }>({});
	const targetError = useId();
	const codeError = useId();
	const errorId = useId();
	const counting = state.seconds > 0;
	const busy = state.phase === "sending" || state.phase === "verifying";
	useEffect(() => {
		onBusyChange?.(busy);
	}, [onBusyChange, busy]);

	useEffect(() => {
		if (!counting) return;
		const timer = setInterval(() => dispatch({ type: "tick" }), 1000);
		return () => clearInterval(timer);
	}, [counting]);

	function switchKind(next: VerifyKind) {
		if (next === kind) return;
		setKind(next);
		setTarget("");
		setCode("");
		setFieldErrors({});
		dispatch({ type: "reset" });
	}

	async function sendCode() {
		const invalid = validateTarget(kind, target);
		if (invalid) {
			setFieldErrors({ ...fieldErrors, target: invalid });
			return;
		}
		if (!canSendCode(state)) return;
		setFieldErrors({ ...fieldErrors, target: undefined });
		dispatch({ type: "send" });
		try {
			const sent = await send({ kind, target: normalizeTarget(kind, target) });
			dispatch({ type: "sent", retryAfter: sent?.retryAfter });
		} catch (error) {
			dispatch({ type: "send_failed", error });
		}
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		// 还没发码时，回车等同于“发送验证码”；已经发过码才走校验。
		if (!state.sent) {
			if (state.phase === "sending") return;
			await sendCode();
			return;
		}
		if (!canVerifyCode(state)) return;
		const errors = {
			target: validateTarget(kind, target),
			code: validateCode(code) ?? (code.trim() ? undefined : "请输入验证码"),
		};
		if (Object.values(errors).some(Boolean)) {
			setFieldErrors(errors);
			return;
		}
		setFieldErrors({});
		dispatch({ type: "verify" });
		try {
			onSuccess(await confirm({ kind, target: normalizeTarget(kind, target), code: code.trim() }));
		} catch (error) {
			dispatch({ type: "verify_failed", error });
		}
	}

	const targetLabel = kind === "phone" ? "手机号" : "邮箱";
	return (
		<form onSubmit={submit} className="flex flex-col gap-4" noValidate>
			<fieldset disabled={busy} className="contents">
				{kinds.length > 1 && (
					<div role="tablist" aria-label="登录方式" className="flex gap-1 rounded-full bg-tone p-1">
						{TABS.filter((tab) => kinds.includes(tab.kind)).map(({ kind: value, label }) => (
							<button
								key={value}
								type="button"
								role="tab"
								aria-selected={kind === value}
								disabled={state.phase === "verifying"}
								onClick={() => switchKind(value)}
								className={`press flex-1 rounded-full py-1.5 text-small ${
									kind === value ? "bg-raised font-medium text-ink" : "text-muted hover:text-ink"
								}`}
							>
								{label}
							</button>
						))}
					</div>
				)}
				<div className="flex flex-col gap-1">
					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1">
							<Field
								label={targetLabel}
								type={kind === "phone" ? "tel" : "email"}
								inputMode={kind === "phone" ? "numeric" : "email"}
								autoComplete={kind === "phone" ? "tel" : "email"}
								placeholder={kind === "phone" ? "11 位手机号" : "name@example.com"}
								value={fixedTarget ? (maskTarget(kind, target) ?? "") : target}
								readOnly={!!fixedTarget}
								onChange={(e) => {
									setTarget(e.target.value);
									if (fieldErrors.target) setFieldErrors({ ...fieldErrors, target: undefined });
								}}
								disabled={state.phase === "verifying"}
								aria-invalid={!!fieldErrors.target}
								aria-describedby={fieldErrors.target ? targetError : undefined}
							/>
						</div>
						<Button
							type="button"
							className="h-11 shrink-0"
							disabled={!canSendCode(state)}
							onClick={() => void sendCode()}
						>
							{state.phase === "sending"
								? "发送中…"
								: state.sent || state.seconds > 0
									? resendLabel(state.seconds)
									: "发送验证码"}
						</Button>
					</div>
					{fieldErrors.target && (
						<p id={targetError} className="text-small text-danger">
							{fieldErrors.target}
						</p>
					)}
				</div>
				<div className="flex flex-col gap-1">
					<Field
						label="验证码"
						type="text"
						inputMode="numeric"
						autoComplete="one-time-code"
						placeholder="6 位数字"
						maxLength={6}
						value={code}
						onChange={(e) => {
							setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
							if (fieldErrors.code) setFieldErrors({ ...fieldErrors, code: undefined });
						}}
						disabled={state.phase === "verifying"}
						aria-invalid={!!fieldErrors.code}
						aria-describedby={fieldErrors.code ? codeError : undefined}
					/>
					{fieldErrors.code && (
						<p id={codeError} className="text-small text-danger">
							{fieldErrors.code}
						</p>
					)}
					{state.sent && !state.error && <p className="text-caption text-muted">{doneHint}</p>}
				</div>
				{children}
				{state.error && (
					<p id={errorId} role="alert" className="text-small text-danger">
						{state.error}
					</p>
				)}
				<Button variant="primary" className="h-11" disabled={!state.sent || state.phase === "verifying"} type="submit">
					{state.phase === "verifying" ? "验证中…" : submitLabel}
				</Button>
			</fieldset>
		</form>
	);
}

/**
 * 登录用的验证码表单：手机 / 邮箱两个 tab，发码 → 填 6 位码 → 登录。
 * 首次验证即注册，没有密码框。登录页和访客额度弹窗共用。
 */
export function VerifyCodeForm({
	shareToken,
	onSuccess,
	submitLabel = "登录 / 注册",
	onBusyChange,
}: {
	shareToken?: string;
	onBusyChange?(busy: boolean): void;
	onSuccess(session: Session): void;
	submitLabel?: string;
}) {
	return (
		<CodeForm
			send={(input) => api.sendCode({ ...input, ...(shareToken ? { shareToken } : {}) })}
			confirm={(input) => api.verifyCode({ ...input, ...(shareToken ? { shareToken } : {}) })}
			onSuccess={onSuccess}
			onBusyChange={onBusyChange}
			submitLabel={submitLabel}
		/>
	);
}

/**
 * 访客消息额度用完时弹出的登录窗：不跳登录页，直接在当前会话上完成验证，
 * 成功后关闭并由调用方继续发送。shareToken 从分享链接进来时一并带上。
 */
export function VerifySheet({
	open,
	onOpenChange,
	shareToken,
	onSuccess,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	shareToken?: string;
	onSuccess(session: Session): void;
}) {
	// 关闭时整块不挂载：表单的倒计时与已填内容不留在后台。
	if (!open) return null;
	return (
		<Window open onOpenChange={onOpenChange} title="登录后继续聊天">
			<div className="flex flex-col gap-4 p-5">
				<p className="text-small text-muted">访客可以免费聊几句，用完需要登录。验证码登录，首次验证即注册。</p>
				<VerifyCodeForm
					shareToken={shareToken}
					onSuccess={(session) => {
						onOpenChange(false);
						onSuccess(session);
					}}
				/>
			</div>
		</Window>
	);
}
