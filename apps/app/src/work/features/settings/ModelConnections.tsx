import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { request } from "../../../api/http";

interface CloudModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: string[];
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<string, string | null>;
}
export interface Connection {
	id: string;
	name: string;
	provider: string;
	api: string;
	baseUrl: string;
	models: CloudModel[];
	enabled: boolean;
	credentialConfigured: boolean;
}
const inputStyle = "field mt-1 w-full rounded-control border border-hairline bg-ground px-3 py-2 text-small";
const efforts = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
type DraftModel = CloudModel & { rowId: string };
const emptyModel = (): DraftModel => ({
	rowId: crypto.randomUUID(),
	id: "",
	name: "",
	reasoning: false,
	input: ["text"],
	contextWindow: 0,
	maxTokens: 0,
});

function ConnectionForm({ connection, onDone }: { connection?: Connection; onDone(): void }) {
	const [name, setName] = useState(connection?.name ?? "");
	const [provider, setProvider] = useState(connection?.provider ?? "");
	const [api, setApi] = useState(connection?.api ?? "openai-completions");
	const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");
	const [key, setKey] = useState("");
	const [models, setModels] = useState<DraftModel[]>(
		() => connection?.models.map((model) => ({ ...model, rowId: crypto.randomUUID() })) ?? [emptyModel()],
	);
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const updateModel = (index: number, patch: Partial<CloudModel>) =>
		setModels((all) => all.map((model, i) => (i === index ? { ...model, ...patch } : model)));
	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		setSaving(true);
		setError("");
		try {
			await request(`/model-connections${connection ? `/${encodeURIComponent(connection.id)}` : ""}`, {
				method: connection ? "PUT" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					provider,
					api,
					baseUrl,
					models: models.map(({ rowId: _rowId, ...model }) => model),
					enabled: connection?.enabled ?? true,
					...(key ? { apiKey: key } : {}),
				}),
			});
			setKey("");
			onDone();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "保存失败");
		} finally {
			setSaving(false);
		}
	};
	return (
		<form
			onSubmit={(event) => void save(event)}
			className="mt-4 space-y-3"
			aria-label={connection ? "编辑云端模型连接" : "添加云端模型连接"}
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="text-small">
					连接名称
					<input required className={inputStyle} value={name} onChange={(event) => setName(event.target.value)} />
				</label>
				<label className="text-small">
					供应商标识
					<input
						required
						className={inputStyle}
						value={provider}
						onChange={(event) => setProvider(event.target.value)}
					/>
				</label>
			</div>
			<label className="block text-small">
				API 类型
				<select className={inputStyle} value={api} onChange={(event) => setApi(event.target.value)}>
					<option value="openai-completions">OpenAI Chat Completions 兼容</option>
					<option value="openai-responses">OpenAI Responses</option>
					<option value="anthropic-messages">Anthropic Messages</option>
				</select>
			</label>
			<label className="block text-small">
				服务地址
				<input
					required
					type="url"
					className={inputStyle}
					value={baseUrl}
					onChange={(event) => setBaseUrl(event.target.value)}
					autoComplete="off"
				/>
			</label>
			<label className="block text-small">
				API 密钥{connection && <span className="text-caption text-muted"> · 留空保留现有密钥</span>}
				<input
					required={!connection}
					type="password"
					className={inputStyle}
					value={key}
					onChange={(event) => setKey(event.target.value)}
					autoComplete="new-password"
				/>
			</label>
			<p className="text-caption text-muted">密钥加密保存在云端，仅由云端模型服务使用；不会回传到浏览器或本机。</p>
			<fieldset className="space-y-3">
				<legend className="text-small font-medium">可用模型</legend>
				{models.map((model, index) => (
					<div key={model.rowId} className="rounded-control border border-hairline p-3">
						<div className="grid gap-2 sm:grid-cols-2">
							<label className="text-caption">
								模型 ID
								<input
									required
									className={inputStyle}
									value={model.id}
									onChange={(event) => updateModel(index, { id: event.target.value })}
								/>
							</label>
							<label className="text-caption">
								显示名称
								<input
									required
									className={inputStyle}
									value={model.name}
									onChange={(event) => updateModel(index, { name: event.target.value })}
								/>
							</label>
							<label className="text-caption">
								上下文长度
								<input
									required
									min={1}
									type="number"
									className={inputStyle}
									value={model.contextWindow || ""}
									onChange={(event) => updateModel(index, { contextWindow: Number(event.target.value) })}
								/>
							</label>
							<label className="text-caption">
								最大输出 token
								<input
									required
									min={1}
									type="number"
									className={inputStyle}
									value={model.maxTokens || ""}
									onChange={(event) => updateModel(index, { maxTokens: Number(event.target.value) })}
								/>
							</label>
						</div>
						<div className="mt-2 flex flex-wrap items-center gap-4 text-small">
							<label className="flex min-h-10 items-center gap-2">
								<input
									type="checkbox"
									checked={model.reasoning}
									onChange={(event) => updateModel(index, { reasoning: event.target.checked })}
								/>
								支持思考
							</label>
							<label className="flex min-h-10 items-center gap-2">
								<input
									type="checkbox"
									checked={model.input.includes("image")}
									onChange={(event) =>
										updateModel(index, { input: event.target.checked ? ["text", "image"] : ["text"] })
									}
								/>
								支持图片
							</label>
							<button
								type="button"
								disabled={models.length === 1}
								onClick={() => setModels((all) => all.filter((_, i) => i !== index))}
								className="press ml-auto min-h-10 rounded-control px-2 text-danger disabled:opacity-30"
								aria-label={`移除模型 ${index + 1}`}
							>
								<Trash2 size={16} />
							</button>
						</div>
						{model.reasoning && (
							<fieldset className="mt-2 border-t border-hairline pt-2">
								<legend className="text-caption text-muted">供应商支持的思考档位</legend>
								<p className="mb-2 text-caption text-faint">只勾选实际支持的档位，右侧填写供应商接受的参数值。</p>
								{efforts.map((level) => {
									const selected = typeof model.thinkingLevelMap?.[level] === "string";
									return (
										<div key={level} className="flex min-h-10 items-center gap-3">
											<label className="flex w-24 items-center gap-2 text-small">
												<input
													type="checkbox"
													checked={selected}
													onChange={(event) =>
														updateModel(index, {
															thinkingLevelMap: {
																...Object.fromEntries(efforts.map((key) => [key, null])),
																...model.thinkingLevelMap,
																[level]: event.target.checked ? level : null,
															},
														})
													}
												/>
												{level}
											</label>
											{selected && (
												<input
													required
													className="field min-w-0 flex-1 rounded-control bg-ground px-2 py-1 text-small"
													aria-label={`${level} 的供应商参数`}
													value={model.thinkingLevelMap?.[level] ?? ""}
													onChange={(event) =>
														updateModel(index, {
															thinkingLevelMap: { ...model.thinkingLevelMap, [level]: event.target.value },
														})
													}
												/>
											)}
										</div>
									);
								})}
							</fieldset>
						)}
					</div>
				))}
				<button
					type="button"
					className="press flex min-h-11 items-center gap-1 text-small text-accent-ink"
					onClick={() => setModels((all) => [...all, emptyModel()])}
				>
					<Plus size={16} />
					添加模型
				</button>
			</fieldset>
			{error && (
				<p role="alert" className="text-small text-danger">
					{error}
				</p>
			)}
			<div className="flex gap-2">
				<button
					type="submit"
					disabled={saving}
					className="press min-h-11 rounded-control bg-accent px-4 text-small text-on-accent disabled:opacity-40"
				>
					{saving ? "保存中…" : "保存连接"}
				</button>
				<button
					type="button"
					disabled={saving}
					className="press min-h-11 rounded-control bg-tone px-4 text-small"
					onClick={onDone}
				>
					取消
				</button>
			</div>
		</form>
	);
}

export function ModelConnections() {
	const qc = useQueryClient();
	const connections = useQuery({
		queryKey: ["cloud-model-connections"],
		queryFn: () => request<{ configured: boolean; connections: Connection[] }>("/model-connections"),
		retry: false,
	});
	const [editing, setEditing] = useState<Connection | "new">();
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const refresh = () => {
		setEditing(undefined);
		void qc.invalidateQueries({ queryKey: ["cloud-model-connections"] });
		void qc.invalidateQueries({ queryKey: ["models"] });
	};
	const mutate = async (connection: Connection, remove = false) => {
		setBusy(connection.id);
		setError("");
		try {
			await request(`/model-connections/${encodeURIComponent(connection.id)}`, {
				method: remove ? "DELETE" : "PUT",
				...(remove
					? {}
					: {
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								name: connection.name,
								provider: connection.provider,
								api: connection.api,
								baseUrl: connection.baseUrl,
								models: connection.models,
								enabled: !connection.enabled,
							}),
						}),
			});
			refresh();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "操作失败");
		} finally {
			setBusy("");
		}
	};
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4">
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-medium">云端模型连接</h2>
				{!editing && (
					<button
						type="button"
						disabled={!connections.data?.configured}
						onClick={() => setEditing("new")}
						className="press min-h-11 rounded-control bg-tone px-3 text-small disabled:opacity-40"
					>
						添加连接
					</button>
				)}
			</div>
			<p className="mt-1 text-caption text-muted">本机模型保留在运行宿主；这里管理账号的云端供应商和密钥。</p>
			{connections.isLoading && <p className="mt-3 text-small">读取连接…</p>}
			{connections.error && (
				<p role="alert" className="mt-3 text-small text-danger">
					{connections.error.message}
					<button type="button" className="ml-2 underline" onClick={() => void connections.refetch()}>
						重试
					</button>
				</p>
			)}
			{connections.data && !connections.data.configured && (
				<p className="mt-3 text-small text-muted">云端密钥存储尚未配置，请联系服务管理员。</p>
			)}
			{connections.data?.configured && !connections.data.connections.length && !editing && (
				<p className="mt-3 text-small text-muted">尚未添加云端模型连接。</p>
			)}
			{!editing &&
				connections.data?.connections.map((connection) => (
					<div key={connection.id} className="mt-3 border-t border-hairline pt-3">
						<p className="text-small font-medium">
							{connection.name}{" "}
							<span className="text-caption font-normal text-muted">{connection.enabled ? "已启用" : "已停用"}</span>
						</p>
						<p className="break-all text-caption text-faint">
							{connection.provider} · {connection.models.map((model) => model.name).join("、")}
						</p>
						<p className="mt-1 text-caption text-muted">
							{connection.credentialConfigured ? "密钥已配置" : "密钥未配置"}
						</p>
						<div className="mt-1 flex flex-wrap gap-3">
							<button
								type="button"
								className="press min-h-11 text-small text-accent-ink"
								disabled={!!busy}
								onClick={() => setEditing(connection)}
							>
								编辑
							</button>
							<button
								type="button"
								className="press min-h-11 text-small"
								disabled={!!busy}
								onClick={() => void mutate(connection)}
							>
								{connection.enabled ? "停用" : "启用"}
							</button>
							<button
								type="button"
								className="press min-h-11 text-small text-danger"
								disabled={!!busy}
								onClick={() => void mutate(connection, true)}
							>
								删除连接
							</button>
						</div>
					</div>
				))}
			{editing && (
				<ConnectionForm
					key={editing === "new" ? "new" : editing.id}
					connection={editing === "new" ? undefined : editing}
					onDone={refresh}
				/>
			)}
			{error && (
				<p role="alert" className="mt-2 text-small text-danger">
					{error}
				</p>
			)}
		</section>
	);
}
