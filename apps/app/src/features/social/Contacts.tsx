import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus, Wallet } from "lucide-react";
import { useState } from "react";
import { qk } from "../../api/keys";
import { httpApi } from "../../api/social";
import { href } from "../../shell/routes";
import { ContactList } from "./ContactList";
import { socialLoadError, socialUnavailable } from "./lib/socialError";

export function Contacts() {
	const [q, setQ] = useState("");
	const contacts = useQuery({ queryKey: ["contacts"], queryFn: httpApi.contacts });
	const devices = useQuery({ queryKey: ["devices"], queryFn: httpApi.devices });
	const session = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session });
	return (
		<div className="flex h-full min-h-0 flex-col bg-ground">
			<header className="flex items-center justify-between px-4 py-4">
				<h1 className="text-[20px] font-semibold">通讯录</h1>
				<a
					href={href({ tab: "contacts", page: "friends/add" })}
					aria-label="添加朋友"
					className="press rounded-full p-2 hover:bg-tone"
				>
					<UserPlus size={21} />
				</a>
			</header>
			<div className="scroll-y min-h-0 flex-1 px-4 pb-6">
				{!session.data?.actor.anonymous && (
					<a
						href={href({ tab: "contacts", page: "cards" })}
						className="press mb-4 flex items-center gap-3 rounded-card bg-raised p-4 shadow-soft"
					>
						<Wallet size={20} />
						<span>我的名片</span>
					</a>
				)}
				<label className="field flex h-10 items-center gap-2 rounded-control bg-tone px-3 text-faint">
					<Search size={16} />
					<input
						aria-label="搜索联系人"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="搜索"
						className="min-w-0 flex-1 bg-transparent text-ink outline-none"
					/>
				</label>
				{contacts.isPending || devices.isPending ? (
					<p role="status" className="py-6 text-muted">
						正在加载联系人…
					</p>
				) : (contacts.isError && socialUnavailable(contacts.error)) ||
					(devices.isError && socialUnavailable(devices.error)) ? (
					// 网关 404（没有代理社交接口）或 fetch 直接失败：与「真的没有联系人」分开说。
					<div role="alert" className="py-6 text-muted" data-testid="contacts-unavailable">
						<p>{socialLoadError(contacts.error ?? devices.error, "加载联系人失败")}</p>
						<button
							type="button"
							onClick={() => {
								void contacts.refetch();
								void devices.refetch();
							}}
							className="mt-2 underline"
						>
							重试
						</button>
					</div>
				) : contacts.isError || devices.isError ? (
					<div role="alert" className="py-6 text-muted" data-testid="contacts-error">
						加载联系人失败：{socialLoadError(contacts.error ?? devices.error, "请求失败")}{" "}
						<button
							type="button"
							onClick={() => {
								void contacts.refetch();
								void devices.refetch();
							}}
							className="underline"
						>
							重试
						</button>
					</div>
				) : (
					<ContactList contacts={contacts.data} devices={devices.data} meId={session.data?.actor.id} q={q} />
				)}
			</div>
		</div>
	);
}
