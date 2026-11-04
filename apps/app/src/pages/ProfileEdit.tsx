import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Navigate } from "react-router";
import { api } from "../api";
import type { Actor, Card, CardProfile, CardVisibility, Profile, ProfileUpdateInput, ProfileUpdateResult } from "../api/types";
import { AppBar } from "../components/AppBar";
import { CardCover } from "../components/card/CardCover";
import { PhotoPicker, type PhotoPickerHandle } from "../components/PhotoPicker";
import { saveLegacyProfile } from "../lib/legacyProfile";
import { usePersonalMarketBack } from "../lib/navigation";
import { profileError, profileSaveError, profileTextError } from "../lib/profileEditor";
import { uploadMarketImage, validateMarketImage } from "../lib/uploadImage";
import { $session } from "../store";
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

const MAX_FACTS = 6;
const MAX_TAGS = 3;

/** 表单里的资料块：CardProfile 的必填化版本，保存时把空串/空数组的字段剥掉。 */
interface CardFormProfile {
	title: string;
	alias: string;
	facts: { k: string; v: string }[];
	seeking: string;
	intro: string;
}

interface CardForm {
	name: string;
	tagline: string;
	avatarUrl: string | null;
	coverUrl: string | null;
	markdown: string;
	tags: string[];
	visibility: CardVisibility;
	profile: CardFormProfile;
}

/** 名片表单：正面（照片、名字、头衔、一句话、标签）+ 背面（事实、在找）+ 详情（介绍）。 */
function cardForm(actor: Actor, card?: Card): CardForm {
	const profile = card?.face?.profile ?? {};
	return {
		name: actor.name,
		tagline: card?.tagline ?? "",
		avatarUrl: actor.avatarUrl && actor.avatarUrl.startsWith("https://") ? actor.avatarUrl : null,
		coverUrl: card?.face?.coverUrl && card.face.coverUrl.startsWith("https://") ? card.face.coverUrl : null,
		markdown: card?.markdown ?? "",
		tags: card?.face?.tags?.length ? [...card.face.tags] : [],
		visibility: { signature: true, code: true, greeting: true, shop: true, ...(card?.face?.visibility ?? {}) },
		profile: {
			title: profile.title ?? "",
			alias: profile.alias ?? "",
			facts: profile.facts?.length ? profile.facts : [],
			seeking: profile.seeking ?? "",
			intro: profile.intro ?? "",
		},
	};
}

/** 空字段不下发：后端 profile 只承载真实内容。 */
const formProfile = (profile: CardFormProfile): CardProfile => ({
	...(profile.title.trim() ? { title: profile.title.trim() } : {}),
	...(profile.alias.trim() ? { alias: profile.alias.trim() } : {}),
	...(profile.facts.filter((f) => f.k.trim() && f.v.trim()).length
		? { facts: profile.facts.filter((f) => f.k.trim() && f.v.trim()) }
		: {}),
	...(profile.seeking.trim() ? { seeking: profile.seeking.trim() } : {}),
	...(profile.intro.trim() ? { intro: profile.intro.trim() } : {}),
});

/** 校验用输入：带上照片与展示开关，profile/tags 先不计入。 */
const cardFormInput = (form: CardForm): ProfileUpdateInput => ({
	name: form.name.trim(),
	tagline: form.tagline.trim(),
	avatarUrl: form.avatarUrl,
	coverUrl: form.coverUrl,
	markdown: form.markdown,
	visibility: form.visibility,
});

/** 名片资料文案校验：头衔/别名/在找/介绍字数，k/v 行数与每行字数。 */
function cardFormError(form: CardForm): string | undefined {
	const title = form.profile.title.trim().length;
	if (title > 60) return "头衔最多 60 个字";
	if (form.profile.alias.trim().length > 40) return "别名最多 40 个字";
	if (form.profile.facts.length > MAX_FACTS) return `背面信息最多 ${MAX_FACTS} 行`;
	for (const fact of form.profile.facts) {
		if (!fact.k.trim() || !fact.v.trim()) return "背面信息每行都要填 key 和 value";
		if ([...fact.k].length > 12) return "背面信息的 key 最多 12 个字";
		if ([...fact.v].length > 60) return "背面信息的 value 最多 60 个字";
	}
	if (form.profile.seeking.trim().length > 60) return "「在找」最多 60 个字";
	if (form.profile.intro.trim().length > 500) return "介绍最多 500 个字";
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
	const capabilities = useQuery({
		queryKey: ["market-capabilities"],
		queryFn: api.marketCapabilities,
		retry: false,
		refetchOnWindowFocus: false,
	});
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
			capabilities={capabilities.isSuccess && !capabilities.isFetching ? capabilities.data : undefined}
			capabilityError={capabilities.isError}
			checking={capabilities.isFetching}
			retryCapabilities={() => void capabilities.refetch()}
			card={query.data.find((item) => item.mine && item.ownerId === actor.id && item.kind === "default")}
		/>
	);
}

function ProfileForm({
	actor,
	card,
	capabilities,
	capabilityError,
	checking,
	retryCapabilities,
}: {
	actor: Actor;
	card?: Card;
	capabilities?: { listingPolicy: boolean; sellerShops: boolean };
	capabilityError: boolean;
	checking: boolean;
	retryCapabilities(): void;
}) {
	const qc = useQueryClient();
	const back = usePersonalMarketBack();
	const formId = useId();
	const [form, setForm] = useState(() => cardForm(actor, card));
	const [avatarFile, setAvatarFile] = useState<File | null>(null);
	const [coverFile, setCoverFile] = useState<File | null>(null);
	const avatarPreview = useImagePreview(avatarFile);
	const coverPreview = useImagePreview(coverFile);
	const picker = useRef<PhotoPickerHandle>(null);
	const original = useRef(cardForm(actor, card));
	const baseline = useRef(JSON.stringify(cardForm(actor, card)));
	const legacyDraft = useRef<Card | undefined>(undefined);
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
	const ready = !!capabilities && !capabilityError && !checking;
	const advanced = ready && capabilities.listingPolicy && capabilities.sellerShops;
	const advancedChanged =
		!!avatarFile ||
		!!coverFile ||
		form.avatarUrl !== original.current.avatarUrl ||
		form.coverUrl !== original.current.coverUrl;
	const blocked = ready && !advanced && advancedChanged;
	const refresh = () =>
		$session.get()?.actor.id === actor.id
			? Promise.all(
					["cards", "card", "profile", "actors", "contacts"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
				)
			: Promise.resolve([]);
	const acknowledgeActor = (updated: Actor) => {
		const current = $session.get();
		if (current?.actor.id !== actor.id) return;
		$session.set({ ...current, actor: updated });
		qc.setQueriesData<Profile>({ queryKey: ["profile"] }, (old) =>
			old?.actor.id === actor.id ? { ...old, actor: updated } : old,
		);
		for (const key of ["actors", "contacts"])
			qc.setQueriesData<Actor[]>({ queryKey: [key] }, (old) =>
				old?.map((item) => (item.id === actor.id ? updated : item)),
			);
	};
	const acknowledgeDraft = (draft: Card) => {
		if ($session.get()?.actor.id !== actor.id) return;
		legacyDraft.current = draft;
		qc.setQueryData<Card[]>(["cards"], (old) => old?.map((item) => (item.id === draft.id ? draft : item)));
	};
	const select = (kind: "avatar" | "cover", file?: File) => {
		if (!file || pending.current || !advanced) return;
		try {
			validateMarketImage(file);
			(kind === "avatar" ? setAvatarFile : setCoverFile)(file);
			setError(undefined);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "图片无法使用");
		}
	};
	const restore = (kind: "avatar" | "cover") => {
		if (!advanced || pending.current) return;
		(kind === "avatar" ? setAvatarFile : setCoverFile)(null);
		setForm((old) => ({ ...old, [kind === "avatar" ? "avatarUrl" : "coverUrl"]: null }));
		setError(undefined);
	};
	// 背面事实行：k/v 两列 + 删除；最多 6 行
	const setFact = (index: number, patch: Partial<{ k: string; v: string }>) =>
		setForm((old) => ({
			...old,
			profile: {
				...old.profile,
				facts: old.profile.facts.map((fact, i) => (i === index ? { ...fact, ...patch } : fact)),
			},
		}));
	const addFact = () =>
		setForm((old) =>
			old.profile.facts.length >= MAX_FACTS
				? old
				: { ...old, profile: { ...old.profile, facts: [...old.profile.facts, { k: "", v: "" }] } },
		);
	const removeFact = (index: number) =>
		setForm((old) => ({
			...old,
			profile: { ...old.profile, facts: old.profile.facts.filter((_, i) => i !== index) },
		}));
	const save = async () => {
		if (pending.current || $session.get()?.actor.id !== actor.id || !ready || blocked) return;
		const invalid = advanced ? profileError(cardFormInput(form)) : profileTextError(form);
		const cardInvalid = cardFormError(form);
		const problem = invalid ?? cardInvalid;
		if (problem) {
			setError(problem);
			return;
		}
		pending.current = true;
		setBusy(true);
		setError(undefined);
		try {
			let result: ProfileUpdateResult;
			if (!advanced) {
				setStage("正在保存…");
				result = await saveLegacyProfile(
					api,
					actor,
					card,
					{ ...form, face: { profile: formProfile(form.profile), tags: form.tags.map((t) => t.trim()).filter(Boolean) } },
					{
						active: () => alive.current && $session.get()?.actor.id === actor.id,
						onActor: acknowledgeActor,
						onCard: acknowledgeDraft,
						pendingDraft: legacyDraft.current,
					},
				);
			} else {
				const image = async (file: File | null, original: string | null, label: string) => {
					if (!alive.current || $session.get()?.actor.id !== actor.id)
						throw new Error("账号已变化，请重新打开个人资料");
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
					name: form.name.trim(),
					tagline: form.tagline.trim(),
					avatarUrl,
					coverUrl,
					markdown: form.markdown,
					visibility: form.visibility,
					face: {
						profile: formProfile(form.profile),
						...(form.tags.map((t) => t.trim()).filter(Boolean).length
							? { tags: form.tags.map((t) => t.trim()).filter(Boolean) }
							: {}),
					},
				};
				const imageError = profileError(input);
				if (imageError) throw new Error(imageError);
				if (!alive.current || $session.get()?.actor.id !== actor.id) return;
				setStage("正在保存…");
				result = await api.saveProfile(input);
			}
			legacyDraft.current = undefined;
			const current = $session.get();
			if (current?.actor.id !== actor.id || result.actor.id !== actor.id) return;
			$session.set({ ...current, actor: result.actor });
			qc.setQueryData<Card[]>(["cards"], (old) =>
				old?.some((item) => item.id === result.card.id)
					? old.map((item) => (item.id === result.card.id ? result.card : item))
					: [result.card, ...(old ?? [])],
			);
			if (result.card.status === "published") qc.setQueryData(["card", result.card.id], result.card);
			qc.setQueriesData<Profile>({ queryKey: ["profile"] }, (old) =>
				old?.actor.id === actor.id
					? { ...old, actor: result.actor, ...(result.card.status === "published" ? { card: result.card } : {}) }
					: old,
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
			if (!advanced) await refresh();
			if (alive.current) setError(profileSaveError(failure));
		} finally {
			pending.current = false;
			if (alive.current) {
				setBusy(false);
				setStage("");
			}
		}
	};
	const invalid = advanced ? profileError({ ...form }) : profileTextError(form);
	const dirty = !!avatarFile || !!coverFile || JSON.stringify(form) !== baseline.current;
	const mayLeave = () => !dirty || window.confirm("有尚未保存的修改，确定离开吗？");
	return (
		<div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
			<AppBar
				title="编辑个人资料"
				left={
					<Button
						type="button"
						size="icon"
						variant="ghost"
						aria-label="返回我的"
						onClick={() => {
							if (mayLeave()) back();
						}}
						disabled={busy}
					>
						<ArrowLeft size={20} />
					</Button>
				}
				right={
					<Button type="submit" variant="primary" form={formId} disabled={busy || !!invalid || !ready || blocked}>
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
					<section aria-label="名片照片" className="overflow-hidden rounded-panel bg-raised shadow-soft">
						<div className="relative h-40 overflow-hidden bg-tone lg:h-48">
							<CardCover url={coverPreview ?? form.coverUrl} local={!!coverFile} />
							<div className="absolute right-3 bottom-3 flex gap-2">
								<Button
									type="button"
									className="bg-raised text-ink"
									disabled={busy || !advanced}
									onClick={() => picker.current?.open("cover")}
								>
									更换照片
								</Button>
								{(coverFile || form.coverUrl) && (
									<Button
										type="button"
										className="bg-raised text-ink"
										disabled={busy || !advanced}
										onClick={() => restore("cover")}
									>
										恢复默认
									</Button>
								)}
							</div>
						</div>
						<div className="relative flex items-center gap-4 px-5 pt-4 pb-5">
							<button
								type="button"
								disabled={busy || !advanced}
								aria-label="更换头像"
								onClick={() => picker.current?.open("avatar")}
								className="press relative -mt-9 shrink-0 rounded-full bg-raised p-1"
							>
								<span className="relative block size-20 overflow-hidden rounded-full">
									<CardCover
										url={avatarPreview ?? form.avatarUrl}
										local={!!avatarFile}
										className="h-full w-full object-cover"
									/>
									{!avatarPreview && !form.avatarUrl && (
										<span className="flex h-full w-full items-center justify-center bg-tone-2 text-title text-muted">
											{[...form.name.trim() || actor.name][0]}
										</span>
									)}
								</span>
								<span className="absolute right-0 bottom-0 rounded-full bg-accent p-1.5 text-on-accent">
									<Camera size={14} />
								</span>
							</button>
							<div className="min-w-0 flex-1">
								<p className="truncate font-semibold">{form.name.trim() || actor.name}</p>
								<p className="mt-1 text-caption text-muted">名片照片；没有照片时显示名字首字</p>
							</div>
							{(avatarFile || form.avatarUrl) && (
								<Button
									type="button"
									size="sm"
									variant="ghost"
									disabled={busy || !advanced}
									onClick={() => restore("avatar")}
								>
									恢复默认头像
								</Button>
							)}
						</div>
						<PhotoPicker ref={picker} disabled={busy || !advanced} onApply={select} onError={setError} />
					</section>
					<fieldset disabled={busy} className="flex flex-col gap-5">
						<Field
							label="名字（1–40 字）"
							value={form.name}
							required
							autoComplete="nickname"
							onChange={(event) => setForm({ ...form, name: event.target.value })}
						/>
						<Field
							label="头衔"
							value={form.profile.title}
							onChange={(event) => setForm({ ...form, profile: { ...form.profile, title: event.target.value } })}
						/>
						<Field
							label="别名（名字旁的小字）"
							value={form.profile.alias}
							onChange={(event) => setForm({ ...form, profile: { ...form.profile, alias: event.target.value } })}
						/>
						<Field
							label="一句话（最多 120 字）"
							value={form.tagline}
							onChange={(event) => setForm({ ...form, tagline: event.target.value })}
						/>
						<Field
							label="在找（背面的一行，最多 60 字）"
							value={form.profile.seeking}
							onChange={(event) => setForm({ ...form, profile: { ...form.profile, seeking: event.target.value } })}
						/>
					</fieldset>
					<fieldset disabled={busy} className="flex flex-col gap-3">
						<legend className="mb-2 text-small font-medium text-muted">标签（最多 3 个）</legend>
						{form.tags.map((tag, index) => (
							<div key={index} className="flex gap-2">
								<Field
									label={`标签 ${index + 1}`}
									value={tag}
									className="flex-1"
									onChange={(event) => {
										const tags = [...form.tags];
										tags[index] = event.target.value;
										setForm({ ...form, tags: tags.filter((t, i) => t.trim() || i === index) });
									}}
								/>
								<Button
									type="button"
									size="icon"
									variant="ghost"
									aria-label={`删除标签 ${index + 1}`}
									className="self-end"
									onClick={() => setForm({ ...form, tags: form.tags.filter((_, i) => i !== index) })}
								>
									<X size={16} />
								</Button>
							</div>
						))}
						{form.tags.length < MAX_TAGS && (
							<Button
								type="button"
								size="sm"
								className="self-start"
								onClick={() => setForm({ ...form, tags: [...form.tags, ""] })}
							>
								<Plus size={14} />
								添加标签
							</Button>
						)}
					</fieldset>
					<fieldset disabled={busy} className="flex flex-col gap-3">
						<legend className="mb-2 text-small font-medium text-muted">背面信息（最多 6 行）</legend>
						{form.profile.facts.map((fact, index) => (
							<div key={index} className="flex gap-2">
								<Field
									label={`名目 ${index + 1}`}
									value={fact.k}
									className="w-28 shrink-0"
									onChange={(event) => setFact(index, { k: event.target.value })}
								/>
								<Field
									label="内容"
									value={fact.v}
									className="flex-1"
									onChange={(event) => setFact(index, { v: event.target.value })}
								/>
								<Button
									type="button"
									size="icon"
									variant="ghost"
									aria-label={`删除第 ${index + 1} 行`}
									className="self-end"
									onClick={() => removeFact(index)}
								>
									<X size={16} />
								</Button>
							</div>
						))}
						{form.profile.facts.length < MAX_FACTS && (
							<Button type="button" size="sm" className="self-start" onClick={addFact}>
								<Plus size={14} />
								添加一行
							</Button>
						)}
					</fieldset>
					<fieldset disabled={busy} className="flex flex-col gap-1.5 text-small text-muted">
						<legend className="mb-2 text-small font-medium text-muted">详情介绍（最多 500 字）</legend>
						<textarea
							rows={5}
							className="field rounded-control bg-tone p-3.5 text-body text-ink outline-none"
							value={form.profile.intro}
							onChange={(event) => setForm({ ...form, profile: { ...form.profile, intro: event.target.value } })}
						/>
					</fieldset>
					{!ready ? (
						<div className="flex items-center justify-between gap-3 text-small text-muted">
							<p role={capabilityError ? "alert" : "status"}>
								{capabilityError ? "暂时无法确认资料服务，请重试" : "正在检查资料服务…"}
							</p>
							{capabilityError && (
								<Button type="button" size="sm" disabled={checking} onClick={retryCapabilities}>
									重试
								</Button>
							)}
						</div>
					) : !advanced ? (
						<p className="text-caption text-muted">照片将在服务更新后开放</p>
					) : null}
					{blocked && (
						<p role="alert" className="text-small text-danger">
							服务版本已变化，请刷新后再保存照片
						</p>
					)}
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
