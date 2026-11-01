import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, ImagePlus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Navigate } from "react-router";
import { api } from "../api";
import type { Actor, Card, Profile, ProfileUpdateInput } from "../api/types";
import { AppBar } from "../components/AppBar";
import { CardCover } from "../components/card/CardCover";
import { usePersonalMarketBack } from "../lib/navigation";
import { profileError, profileForm, profileSaveError } from "../lib/profileEditor";
import { uploadMarketImage, validateMarketImage } from "../market/uploadImage";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";

function useImagePreview(file: File | null) {
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		if (!file) {
			setUrl(undefined);
			return;
		}
		const next = URL.createObjectURL(file);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [file]);
	return url;
}

export function ProfileEdit() {
	const session = useStore($session);
	if (session === undefined) return null;
	if (!session || session.actor.anonymous) return <Navigate to="/login" state={{ next: "/me/edit" }} replace />;
	if (session.actor.kind !== "human") return <Navigate to="/me" replace />;
	return <ProfileLoader key={session.actor.id} actor={session.actor} />;
}

function ProfileLoader({ actor }: { actor: Actor }) {
	const back = usePersonalMarketBack();
	const query = useQuery({ queryKey: ["cards"], queryFn: api.cards });
	if (!query.data)
		return (
			<div className="flex h-full flex-col bg-ground">
				<AppBar
					title="编辑个人资料"
					left={
						<Button type="button" size="icon" variant="ghost" aria-label="返回我的" onClick={back}>
							<ArrowLeft size={20} />
						</Button>
					}
				/>
				<div className="m-auto flex flex-col items-center gap-3 p-5">
					<p role={query.isError ? "alert" : "status"} className="text-small text-muted">
						{query.isError ? "个人资料加载失败" : "正在加载个人资料…"}
					</p>
					{query.isError && <Button onClick={() => void query.refetch()}>重试</Button>}
				</div>
			</div>
		);
	return (
		<ProfileForm
			actor={actor}
			card={query.data.find((item) => item.mine && item.ownerId === actor.id && item.kind === "default")}
		/>
	);
}

function ProfileForm({ actor, card }: { actor: Actor; card?: Card }) {
	const qc = useQueryClient();
	const back = usePersonalMarketBack();
	const formId = useId();
	const [form, setForm] = useState(() => profileForm(actor, card));
	const [avatarFile, setAvatarFile] = useState<File | null>(null);
	const [coverFile, setCoverFile] = useState<File | null>(null);
	const avatarPreview = useImagePreview(avatarFile);
	const coverPreview = useImagePreview(coverFile);
	const avatarInput = useRef<HTMLInputElement>(null);
	const coverInput = useRef<HTMLInputElement>(null);
	const pending = useRef(false);
	const alive = useRef(true);
	const uploads = useRef(new Map<File, string>());
	const [busy, setBusy] = useState(false);
	const [stage, setStage] = useState("");
	const [error, setError] = useState<string>();
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const select = (kind: "avatar" | "cover", file?: File) => {
		if (!file || pending.current) return;
		try {
			validateMarketImage(file);
			(kind === "avatar" ? setAvatarFile : setCoverFile)(file);
			setError(undefined);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "图片无法使用");
		}
	};
	const restore = (kind: "avatar" | "cover") => {
		(kind === "avatar" ? setAvatarFile : setCoverFile)(null);
		setForm((old) => ({ ...old, [kind === "avatar" ? "avatarUrl" : "coverUrl"]: null }));
		setError(undefined);
	};
	const save = async () => {
		if (pending.current || $session.get()?.actor.id !== actor.id) return;
		const invalid = profileError(form);
		if (invalid) {
			setError(invalid);
			return;
		}
		pending.current = true;
		setBusy(true);
		setError(undefined);
		try {
			const image = async (file: File | null, original: string | null, label: string) => {
				if (!alive.current || $session.get()?.actor.id !== actor.id) throw new Error("账号已变化，请重新打开个人资料");
				if (!file) return original;
				const previous = uploads.current.get(file);
				if (previous) return previous;
				setStage(`正在上传${label}…`);
				const url = await uploadMarketImage(
					file,
					(progress) => alive.current && setStage(`正在上传${label} ${progress}%`),
				);
				uploads.current.set(file, url);
				return url;
			};
			const avatarUrl = await image(avatarFile, form.avatarUrl, "头像");
			const coverUrl = await image(coverFile, form.coverUrl, "背景");
			const input: ProfileUpdateInput = {
				...form,
				name: form.name.trim(),
				tagline: form.tagline.trim(),
				avatarUrl,
				coverUrl,
			};
			const imageError = profileError(input);
			if (imageError) throw new Error(imageError);
			if (!alive.current || $session.get()?.actor.id !== actor.id) return;
			setStage("正在保存…");
			const result = await api.saveProfile(input);
			const current = $session.get();
			if (current?.actor.id !== actor.id || result.actor.id !== actor.id) return;
			$session.set({ ...current, actor: result.actor });
			qc.setQueryData<Card[]>(["cards"], (old) =>
				old?.some((item) => item.id === result.card.id)
					? old.map((item) => (item.id === result.card.id ? result.card : item))
					: [result.card, ...(old ?? [])],
			);
			qc.setQueryData(["card", result.card.id], result.card);
			qc.setQueriesData<Profile>({ queryKey: ["profile"] }, (old) =>
				old?.actor.id === actor.id ? { ...old, actor: result.actor, card: result.card } : old,
			);
			for (const key of ["actors", "contacts"])
				qc.setQueriesData<Actor[]>({ queryKey: [key] }, (old) =>
					old?.map((item) => (item.id === actor.id ? result.actor : item)),
				);
			await Promise.all(
				["cards", "card", "profile", "actors", "contacts"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
			);
			if (alive.current) back();
		} catch (failure) {
			if (alive.current) setError(profileSaveError(failure));
		} finally {
			pending.current = false;
			if (alive.current) {
				setBusy(false);
				setStage("");
			}
		}
	};
	const invalid = profileError(form);
	return (
		<div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
			<AppBar
				title="编辑个人资料"
				left={
					<Button type="button" size="icon" variant="ghost" aria-label="返回我的" onClick={back} disabled={busy}>
						<ArrowLeft size={20} />
					</Button>
				}
				right={
					<Button type="submit" variant="primary" form={formId} disabled={busy || !!invalid}>
						{busy ? "保存中…" : "保存"}
					</Button>
				}
			/>
			<form
				id={formId}
				className="scroll-y min-h-0 flex-1"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-3 pb-12 lg:px-6">
					<section aria-label="头像与名片背景" className="overflow-hidden rounded-panel bg-raised shadow-soft">
						<div className="relative h-40 overflow-hidden bg-tone lg:h-48">
							<CardCover url={coverPreview ?? form.coverUrl} local={!!coverFile} />
							<div className="absolute right-3 bottom-3 flex gap-2">
								<Button
									type="button"
									className="bg-raised text-ink"
									disabled={busy}
									onClick={() => coverInput.current?.click()}
								>
									<ImagePlus size={16} />
									更换背景
								</Button>
								{(coverFile || form.coverUrl) && (
									<Button type="button" className="bg-raised text-ink" disabled={busy} onClick={() => restore("cover")}>
										恢复默认背景
									</Button>
								)}
							</div>
						</div>
						<div className="relative flex items-center gap-4 px-5 pt-4 pb-5">
							<button
								type="button"
								disabled={busy}
								aria-label="更换头像"
								onClick={() => avatarInput.current?.click()}
								className="press relative -mt-9 shrink-0 rounded-full bg-raised p-1"
							>
								<span className="relative block size-20 overflow-hidden rounded-full">
									<Avatar actor={{ ...actor, name: form.name || actor.name, avatarUrl: undefined }} size={80} />
									<CardCover
										url={avatarPreview ?? form.avatarUrl}
										local={!!avatarFile}
										className="absolute inset-0 h-full w-full object-cover"
									/>
								</span>
								<span className="absolute right-0 bottom-0 rounded-full bg-accent p-1.5 text-on-accent">
									<Camera size={14} />
								</span>
							</button>
							<div className="min-w-0 flex-1">
								<p className="truncate font-semibold">{form.name.trim() || actor.name}</p>
								<p className="mt-1 text-caption text-muted">头像与昵称始终展示</p>
							</div>
							{(avatarFile || form.avatarUrl) && (
								<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => restore("avatar")}>
									恢复默认头像
								</Button>
							)}
						</div>
						{(["avatar", "cover"] as const).map((kind) => (
							<input
								key={kind}
								type="file"
								hidden
								ref={kind === "avatar" ? avatarInput : coverInput}
								aria-label={kind === "avatar" ? "选择头像" : "选择背景"}
								accept="image/jpeg,image/png,image/webp"
								disabled={busy}
								onChange={(event) => {
									select(kind, event.target.files?.[0]);
									event.currentTarget.value = "";
								}}
							/>
						))}
					</section>
					<fieldset disabled={busy} className="flex flex-col gap-5">
						<Field
							label="昵称（1–40 字）"
							value={form.name}
							required
							autoComplete="nickname"
							onChange={(event) => setForm({ ...form, name: event.target.value })}
						/>
						<Field
							label="个性签名（最多 120 字）"
							value={form.tagline}
							onChange={(event) => setForm({ ...form, tagline: event.target.value })}
						/>
						<label className="flex flex-col gap-1.5 text-small text-muted">
							<span className="flex justify-between">
								<span>访客开场白</span>
								<span className="text-caption">{[...form.markdown].length}/2000</span>
							</span>
							<textarea
								rows={4}
								value={form.markdown}
								onChange={(event) => setForm({ ...form, markdown: event.target.value })}
								className="field w-full resize-y rounded-control bg-tone px-3.5 py-3 text-body text-ink outline-none"
							/>
						</label>
					</fieldset>
					<fieldset disabled={busy} className="rounded-card bg-raised">
						<legend className="mb-2 text-small font-medium text-muted">名片展示</legend>
						{(
							[
								{ key: "signature", label: "个性签名" },
								{ key: "code", label: "账号 ID" },
								{ key: "greeting", label: "访客开场白" },
							] as const
						).map(({ key, label }) => (
							<label
								key={key}
								className="relative flex min-h-14 cursor-pointer items-center justify-between gap-4 px-1 text-small"
							>
								<span>{label}</span>
								<input
									type="checkbox"
									role="switch"
									aria-checked={form.visibility[key]}
									aria-label={`展示${label}`}
									checked={form.visibility[key]}
									onChange={(event) =>
										setForm({ ...form, visibility: { ...form.visibility, [key]: event.target.checked } })
									}
									className="peer sr-only"
								/>
								<span
									aria-hidden
									className="pointer-events-none relative h-6 w-10 shrink-0 rounded-full bg-tone-2 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2"
								>
									<span
										className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow-soft transition-transform ${form.visibility[key] ? "translate-x-4" : ""}`}
									/>
								</span>
							</label>
						))}
					</fieldset>
					{(error || invalid) && (
						<p role="alert" className="text-small text-danger">
							{error ?? invalid}
						</p>
					)}
					{stage && (
						<p role="status" className="text-small text-muted">
							{stage}
						</p>
					)}
				</div>
			</form>
		</div>
	);
}
