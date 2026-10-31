import { useStore } from "@nanostores/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserPlus } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { type FriendRequest, friendError, friendsApi } from "../api/friends";
import { AppBar } from "../components/AppBar";
import { entityRef } from "../lib/entityRef";
import { useFriendRequests } from "../lib/useFriendRequests";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";

export function PrivacySection() {
	const me = useStore($session)?.actor,
		qc = useQueryClient();
	const key = ["privacy", me?.id];
	const query = useQuery({ queryKey: key, queryFn: friendsApi.privacy, enabled: !!me && !me.anonymous, retry: false });
	const save = useMutation({
		mutationFn: friendsApi.updatePrivacy,
		onSuccess: (value) => {
			qc.setQueryData(key, value);
			toast("已保存");
		},
		onError: (error) => toast(friendError(error, "保存失败"), true),
	});
	if (!me || me.anonymous) return <p className="mx-4 mt-4 text-small text-muted">登录正式账号后可设置好友验证。</p>;
	return (
		<section className="mx-4 rounded-card bg-raised p-5">
			<h2 className="mb-4 font-medium">好友验证</h2>
			{query.isPending ? (
				<p role="status">正在加载…</p>
			) : query.isError ? (
				<div role="alert">
					<p className="mb-3 text-small text-muted">{friendError(query.error, "加载失败")}</p>
					<Button onClick={() => void query.refetch()}>重试</Button>
				</div>
			) : (
				<div className="flex items-center gap-5">
					<div className="flex-1">
						<p>加我为好友时需要验证</p>
						<p className="mt-2 text-small leading-relaxed text-muted">
							{query.data.friendVerification ? "开启后，新申请需要你同意。" : "关闭后，其他人可以直接添加你。"}
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-label="加我为好友时需要验证"
						aria-checked={query.data.friendVerification}
						disabled={save.isPending}
						onClick={() => save.mutate({ friendVerification: !query.data?.friendVerification })}
						className={
							"press relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 " +
							(query.data.friendVerification ? "bg-accent" : "bg-tone-2")
						}
					>
						<span
							className={
								"absolute top-1 left-1 size-5 rounded-full bg-raised shadow-sm transition-transform " +
								(query.data.friendVerification ? "translate-x-5" : "")
							}
						/>
					</button>
				</div>
			)}
			<p className="mt-4 text-caption leading-relaxed text-muted">
				已有好友不受影响。此前收到的申请仍需在「新的朋友」中处理。
			</p>
		</section>
	);
}
function RequestRow({ request }: { request: FriendRequest }) {
	const qc = useQueryClient();
	const response = useMutation({
		mutationFn: (action: "accept" | "reject") => friendsApi.respond(request.id, action),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["friend-requests"] });
			void qc.invalidateQueries({ queryKey: ["contacts"] });
		},
		onError: (error) => toast(friendError(error, "操作失败"), true),
	});
	const incoming = request.direction === "incoming" && request.status === "pending";
	return (
		<article className="flex gap-3 border-b border-hairline py-5 last:border-0">
			<Link to={`/p/${entityRef(request.actor)}`} aria-label={`查看${request.actor.name}的资料`}>
				<Avatar actor={request.actor} size={44} />
			</Link>
			<div className="min-w-0 flex-1">
				<Link to={`/p/${entityRef(request.actor)}`} className="font-medium">
					{request.actor.name}
				</Link>
				<p className="mt-1 break-words text-small leading-relaxed text-muted">{request.message || "请求添加好友"}</p>
				<p className="mt-2 text-caption text-faint">
					{request.direction === "outgoing" ? "我发出的申请 · " : ""}
					{new Date(request.createdAt).toLocaleDateString("zh-CN")}
				</p>
				{incoming && (
					<div className="mt-3 flex gap-2">
						<Button variant="primary" disabled={response.isPending} onClick={() => response.mutate("accept")}>
							接受
						</Button>
						<Button variant="ghost" disabled={response.isPending} onClick={() => response.mutate("reject")}>
							拒绝
						</Button>
					</div>
				)}
			</div>
			{!incoming && (
				<span className="shrink-0 text-small text-muted">
					{request.status === "accepted" ? "已添加" : request.status === "rejected" ? "未通过" : "等待验证"}
				</span>
			)}
		</article>
	);
}
export function NewFriends() {
	const me = useStore($session)?.actor,
		query = useFriendRequests();
	if (!me || me.anonymous) return <Navigate to="/contacts" replace />;
	const items = [...(query.data ?? [])].sort(
		(a, b) =>
			Number(b.status === "pending" && b.direction === "incoming") -
				Number(a.status === "pending" && a.direction === "incoming") || b.createdAt - a.createdAt,
	);
	return (
		<div className="flex h-full flex-col bg-ground">
			<AppBar
				title="新的朋友"
				left={
					<Link
						to="/contacts"
						aria-label="返回通讯录"
						className="press grid size-10 place-items-center rounded-full hover:bg-tone"
					>
						<ArrowLeft size={20} />
					</Link>
				}
			/>
			<div className="scroll-y flex-1 px-5 pb-12">
				<div className="mx-auto max-w-2xl">
					<Link to="/friends/add" className="press my-4 flex min-h-14 items-center gap-3 rounded-card bg-raised px-4">
						<UserPlus size={21} />
						添加朋友
					</Link>
					{query.isPending ? (
						<p role="status" className="py-12 text-center text-muted">
							正在加载…
						</p>
					) : query.isError ? (
						<div role="alert" className="py-8 text-center">
							<p className="mb-4 text-small text-muted">{friendError(query.error, "申请加载失败")}</p>
							<Button onClick={() => void query.refetch()}>重试</Button>
						</div>
					) : items.length ? (
						<section aria-label="好友申请">
							{items.map((request) => (
								<RequestRow key={request.id} request={request} />
							))}
						</section>
					) : (
						<div className="py-20 text-center">
							<UserPlus size={30} className="mx-auto mb-4 text-faint" />
							<p>暂无好友申请</p>
							<p className="mt-2 text-small text-muted">收到的验证消息会出现在这里。</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
export function AddFriendButton({ accountId }: { accountId: string }) {
	const me = useStore($session)?.actor,
		qc = useQueryClient();
	const [open, setOpen] = useState(false),
		[message, setMessage] = useState("");
	const add = useMutation({
		mutationFn: () => friendsApi.add(accountId, message),
		onSuccess: (result) => {
			setOpen(false);
			void qc.invalidateQueries({ queryKey: ["contacts"] });
			void qc.invalidateQueries({ queryKey: ["friend-requests"] });
			toast(result.status === "pending" ? "申请已发送，等待对方验证" : "已添加朋友");
		},
		onError: (error) => toast(friendError(error, "添加失败"), true),
	});
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(value) => {
				if (!add.isPending) setOpen(value);
			}}
		>
			<Button
				className="h-11"
				disabled={add.isPending || add.isSuccess}
				onClick={() => {
					if (!me || me.anonymous) {
						toast("注册后可加好友");
						return;
					}
					setOpen(true);
				}}
			>
				{add.data?.status === "accepted" ? "已添加" : add.data?.status === "pending" ? "等待验证" : "加好友"}
			</Button>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
				<Dialog.Content
					aria-describedby={undefined}
					className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-card bg-raised p-6 shadow-float"
				>
					<Dialog.Title className="text-title font-semibold">申请添加好友</Dialog.Title>
					<p className="mt-2 text-small text-muted">如果对方开启验证，以下消息将随申请发送。</p>
					<label className="mt-5 block text-small">
						验证消息
						<textarea
							className="mt-2 w-full rounded-control bg-tone p-3"
							rows={3}
							maxLength={200}
							value={message}
							placeholder={`我是${me?.name ?? ""}`}
							onChange={(e) => setMessage(e.target.value)}
						/>
					</label>
					<div className="mt-4 flex justify-end gap-2">
						<Dialog.Close asChild>
							<Button variant="ghost" disabled={add.isPending}>
								取消
							</Button>
						</Dialog.Close>
						<Button variant="primary" disabled={add.isPending} onClick={() => add.mutate()}>
							{add.isPending ? "发送中…" : "发送"}
						</Button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
