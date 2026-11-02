import type {
	McpConfigListResult,
	McpExposure,
	McpServerView,
	McpToolView,
	McpUpsertInput,
} from "@tcode/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { pushToast } from "../../stores/toasts";
import { ChevronDownIcon, ChevronRightIcon } from "../icons";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Switch } from "../ui/Switch";

const EXPOSURES: McpExposure[] = ["codemode", "direct", "deferred", "hidden"];

const EMPTY: McpUpsertInput = {
	scope: "user",
	name: "",
	transport: "stdio",
	command: "",
	args: [],
	enabled: true,
	exposure: "codemode",
	toolExposure: {},
};

const FIELD =
	"mt-1 w-full rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors hover:border-border-strong focus:border-border-strong";

function Select(props: {
	value: string;
	onChange: (value: string) => void;
	options: { value: string; label: string }[];
	className?: string;
	label?: string;
	align?: "left" | "right";
}) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const current = props.options.find((option) => option.value === props.value) ?? props.options[0];

	const close = (): void => setOpen(false);
	const openList = () => {
		const index = props.options.findIndex((option) => option.value === props.value);
		setActive(index >= 0 ? index : 0);
		setOpen(true);
	};
	const choose = (index: number) => {
		const option = props.options[index];
		if (!option) return;
		props.onChange(option.value);
		close();
	};

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open]);

	return (
		<div ref={rootRef} className="relative inline-flex">
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={props.label}
				className={`flex items-center gap-1.5 rounded-lg border border-border py-1 pl-2 pr-1.5 text-[12px] text-ink-2 transition-colors hover:border-border-strong ${open ? "border-border-strong" : ""} ${props.className ?? ""}`}
				onClick={() => (open ? close() : openList())}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						if (!open) {
							openList();
							return;
						}
						const delta = event.key === "ArrowDown" ? 1 : -1;
						setActive((index) => (index + delta + props.options.length) % props.options.length);
						return;
					}
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						if (open) choose(active);
						else openList();
						return;
					}
					if (event.key === "Escape") close();
				}}
			>
				<span className="truncate">{current?.label ?? props.value}</span>
				<ChevronDownIcon
					size={12}
					className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && (
				<div
					role="listbox"
					className={`absolute top-full z-30 mt-1 min-w-full rounded-xl border border-border bg-surface p-1 shadow-soft ${props.align === "left" ? "left-0" : "right-0"}`}
					onKeyDown={(event) => {
						if (event.key === "Escape") close();
					}}
				>
					{props.options.map((option, index) => (
						<button
							key={option.value}
							type="button"
							role="option"
							aria-selected={option.value === props.value}
							className={`flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
								index === active || option.value === props.value
									? "bg-hover text-ink"
									: "text-ink-2 hover:bg-hover hover:text-ink"
							}`}
							onMouseEnter={() => setActive(index)}
							onClick={() => choose(index)}
						>
							{option.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function transportText(server: McpServerView): string {
	if (server.transport.kind === "url") return server.transport.url;
	if (server.transport.kind === "stdio") {
		return [server.transport.command, ...(server.transport.args ?? [])].join(" ");
	}
	return "";
}

function ServerRow(props: {
	server: McpServerView;
	busy: boolean;
	onToggle: (server: McpServerView, enabled: boolean) => void;
	onEdit: (server: McpServerView) => void;
	onDelete: (name: string) => void;
}) {
	const t = useT();
	const { server, busy } = props;
	const [open, setOpen] = useState(false);
	const connected = server.tools.length > 0;
	const detail = transportText(server);

	return (
		<li className="rounded-xl border border-border px-3 py-2">
			<div className="flex items-center gap-2">
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-ink-faint/60"}`}
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="truncate text-[13px] text-ink-2">{server.name}</span>
						{server.overrideOnly && (
							<span className="shrink-0 rounded bg-hover px-1 text-[10px] text-ink-faint">
								{t("settings.mcp.overrideTag")}
							</span>
						)}
						<span className="shrink-0 text-[11px] text-ink-faint">
							{connected
								? t("settings.mcp.toolCount", { count: server.tools.length })
								: t("settings.mcp.disconnected")}
						</span>
					</div>
					<div className="truncate font-mono text-[11px] text-ink-faint">{detail}</div>
				</div>
				{server.tools.length > 0 && (
					<button
						type="button"
						className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
						aria-expanded={open}
						aria-label={t("settings.mcp.tools")}
						onClick={() => setOpen((v) => !v)}
					>
						<ChevronRightIcon
							size={14}
							className={open ? "rotate-90 transition-transform" : "transition-transform"}
						/>
					</button>
				)}
				<Switch
					checked={server.enabled}
					onCheckedChange={(next) => props.onToggle(server, next)}
					aria-label={t("settings.mcp.enabled")}
				/>
				<button
					type="button"
					className="flex h-8 shrink-0 items-center rounded-[9px] px-2.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
					disabled={busy}
					onClick={() => props.onEdit(server)}
				>
					{t("settings.mcp.edit")}
				</button>
				<button
					type="button"
					className="flex h-8 shrink-0 items-center rounded-[9px] bg-red-600/12 px-2.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-600/20 disabled:opacity-40"
					disabled={busy}
					onClick={() => props.onDelete(server.name)}
				>
					{t("settings.mcp.delete")}
				</button>
			</div>
			{server.needsAuth && (
				<div className="mt-1.5 flex items-center gap-2">
					<span className="text-[11px] text-amber-600">{t("settings.mcp.needsAuth")}</span>
					{server.authUrl && (
						<button
							type="button"
							className="flex h-7 items-center rounded-[7px] bg-ink px-2 text-[11px] font-medium text-on-ink transition-opacity hover:opacity-90"
							onClick={() => void getPi().openExternal({ url: server.authUrl ?? "" })}
						>
							{t("settings.mcp.signIn")}
						</button>
					)}
				</div>
			)}
			{server.error && !server.needsAuth && <p className="mt-1.5 text-[11px] text-red-600">{server.error}</p>}
			{open && server.tools.length > 0 && (
				<ul className="mt-1.5 flex flex-col gap-0.5 border-t border-border pt-1.5">
					{server.tools.map((tool) => (
						<li key={tool.name} className="truncate font-mono text-[11px] text-ink-faint">
							{tool.name}
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

export function McpPanel() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const [config, setConfig] = useState<McpConfigListResult | null>(null);
	const [editing, setEditing] = useState<McpUpsertInput | null>(null);
	const [pendingDelete, setPendingDelete] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [jsonMode, setJsonMode] = useState(false);
	const [rawText, setRawText] = useState("");
	const [rawPath, setRawPath] = useState("");
	const [rawError, setRawError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setConfig(await getPi().getMcpConfig({ cwd: cwd ?? undefined }));
	}, [cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const off = getPi().onMcpServersChanged(() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => void load(), 200);
		});
		return () => {
			off();
			if (timer) clearTimeout(timer);
		};
	}, [load]);

	const reportReload = (reload: { reloaded: number; skipped: unknown[] }) => {
		if (reload.skipped.length > 0) pushToast("warning", "toast.mcpBusySessions");
		else if (reload.reloaded > 0) pushToast("info", "toast.mcpReloaded");
	};

	const applyResult = async (result: Awaited<ReturnType<ReturnType<typeof getPi>["upsertMcpServer"]>>) => {
		setConfig(result.config);
		reportReload(result.reload);
	};

	const save = async () => {
		if (!editing) return;
		const name = editing.name.trim();
		if (!name) {
			pushToast("warning", "toast.mcpNameRequired");
			return;
		}
		setBusy(true);
		try {
			await applyResult(
				await getPi().upsertMcpServer({
					...editing,
					name,
					cwd: editing.scope === "project" ? (cwd ?? undefined) : undefined,
					args: editing.args ?? [],
				}),
			);
			setEditing(null);
			pushToast("info", "toast.mcpSaved");
		} catch (error) {
			pushToast("warning", "toast.mcpSaveFailed");
			console.error("保存 MCP 服务器失败", error);
		} finally {
			setBusy(false);
		}
	};

	const remove = async (name: string) => {
		setBusy(true);
		try {
			await applyResult(await getPi().removeMcpServer({ scope: "user", cwd: cwd ?? undefined, name }));
			pushToast("info", "toast.mcpRemoved");
		} finally {
			setBusy(false);
		}
	};

	const toggle = async (server: McpServerView, enabled: boolean) => {
		setBusy(true);
		try {
			await applyResult(
				await getPi().upsertMcpServer({
					scope: server.scope === "project" ? "project" : "user",
					cwd: cwd ?? undefined,
					name: server.name,
					transport: server.transport.kind === "url" ? "http" : "stdio",
					command: server.transport.kind === "stdio" ? server.transport.command : undefined,
					args: server.transport.kind === "stdio" ? server.transport.args : undefined,
					url: server.transport.kind === "url" ? server.transport.url : undefined,
					headers: server.headers,
					description: server.description,
					exposure: server.exposureRaw,
					enabled,
				}),
			);
		} finally {
			setBusy(false);
		}
	};

	const openJson = async () => {
		try {
			const raw = await getPi().getMcpRawConfig({ scope: "user", cwd: cwd ?? undefined });
			setRawText(raw.text);
			setRawPath(raw.path);
			setRawError(null);
			setJsonMode(true);
		} catch (error) {
			pushToast("warning", "toast.mcpSaveFailed");
			console.error("读取 mcp.json 失败", error);
		}
	};

	const saveJson = async () => {
		setBusy(true);
		try {
			await applyResult(
				await getPi().saveMcpRawConfig({ scope: "user", cwd: cwd ?? undefined, text: rawText }),
			);
			setRawError(null);
			setJsonMode(false);
			pushToast("info", "toast.mcpSaved");
		} catch (error) {
			setRawError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	const reload = async () => {
		setBusy(true);
		try {
			await applyResult(await getPi().reloadMcpServers({ cwd: cwd ?? undefined }));
		} finally {
			setBusy(false);
		}
	};

	const startAdd = (scope: "user" | "project") => setEditing({ ...EMPTY, scope });

	const startEdit = (server: McpServerView) =>
		setEditing({
			scope: server.scope,
			name: server.name,
			transport: server.transport.kind === "url" ? "http" : "stdio",
			command: server.transport.kind === "stdio" ? server.transport.command : "",
			args: server.transport.kind === "stdio" ? (server.transport.args ?? []) : [],
			url: server.transport.kind === "url" ? server.transport.url : "",
			headers: server.headers,
			description: server.description,
			exposure: server.exposureRaw,
			toolExposure: server.toolExposure,
			enabled: server.enabled,
		});

	const editingTools: McpToolView[] = editing
		? ([...(config?.global ?? []), ...(config?.project ?? [])].find((s) => s.name === editing.name)?.tools ??
			[])
		: [];

	const sections: { scope: "user" | "project"; title: string; servers: McpServerView[] }[] = config
		? [
				{ scope: "user", title: t("settings.mcp.scopeUser"), servers: config.global },
				{ scope: "project", title: t("settings.mcp.scopeProject"), servers: config.project },
			]
		: [];

	return (
		<section className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-[13px] font-semibold text-ink">{t("settings.mcp.title")}</h3>
				<button
					type="button"
					className="flex h-7 shrink-0 items-center rounded-[9px] px-2.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
					disabled={busy}
					onClick={() => void reload()}
				>
					{t("settings.mcp.reconnect")}
				</button>
			</div>
			<div className="flex items-baseline justify-between gap-3">
				<p className="text-[11px] leading-relaxed text-ink-faint">{t("settings.mcp.hint")}</p>
				<button
					type="button"
					className="flex h-7 shrink-0 items-center rounded-[9px] px-2 text-[12px] text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
					disabled={busy}
					onClick={() => (jsonMode ? setJsonMode(false) : void openJson())}
				>
					{jsonMode ? t("settings.mcp.formMode") : t("settings.mcp.jsonMode")}
				</button>
			</div>

			{jsonMode && (
				<div className="flex flex-col gap-2 rounded-xl border border-border px-3 py-3">
					<div className="flex items-baseline justify-between gap-3">
						<span className="text-[12px] font-medium text-ink">{t("settings.mcp.jsonTitle")}</span>
						<span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">{rawPath}</span>
					</div>
					<textarea
						className="min-h-[240px] w-full resize-y rounded-lg border border-border bg-transparent px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-border-strong"
						spellCheck={false}
						value={rawText}
						onChange={(e) => setRawText(e.target.value)}
					/>
					{rawError && <p className="text-[11px] text-red-600">{rawError}</p>}
					<div className="flex justify-end gap-2">
						<button
							type="button"
							className="flex h-8 items-center rounded-[9px] px-3 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
							onClick={() => setJsonMode(false)}
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							className="flex h-8 items-center rounded-[9px] bg-ink px-3 text-[13px] font-medium text-on-ink transition-opacity hover:opacity-90 disabled:opacity-40"
							disabled={busy}
							onClick={() => void saveJson()}
						>
							{t("settings.mcp.save")}
						</button>
					</div>
				</div>
			)}

			{editing && (
				<div className="flex flex-col gap-2 rounded-xl border border-border px-3 py-3">
					<div className="flex items-center justify-between gap-3">
						<span className="text-[12px] font-medium text-ink">
							{editing.scope === "project" ? t("settings.mcp.scopeProject") : t("settings.mcp.scopeUser")}
						</span>
						<div className="flex items-center gap-1.5">
							<Select
								label={t("settings.mcp.transport")}
								value={editing.transport}
								onChange={(value) =>
									setEditing({ ...editing, transport: value as McpUpsertInput["transport"] })
								}
								options={[
									{ value: "stdio", label: "stdio" },
									{ value: "http", label: "http" },
								]}
							/>
							<Select
								align="right"
								label={t("settings.mcp.exposure")}
								className="max-w-[190px]"
								value={editing.exposure ?? "codemode"}
								onChange={(value) => setEditing({ ...editing, exposure: value as McpExposure })}
								options={EXPOSURES.map((value) => ({
									value,
									label: t(`settings.mcp.exposure_${value}`),
								}))}
							/>
						</div>
					</div>
					<label className="text-[12px] text-ink-2">
						{t("settings.mcp.name")}
						<input
							className={FIELD}
							value={editing.name}
							onChange={(e) => setEditing({ ...editing, name: e.target.value })}
						/>
					</label>
					{editing.transport === "stdio" ? (
						<>
							<label className="text-[12px] text-ink-2">
								{t("settings.mcp.command")}
								<input
									className={FIELD}
									value={editing.command ?? ""}
									onChange={(e) => setEditing({ ...editing, command: e.target.value })}
								/>
							</label>
							<label className="text-[12px] text-ink-2">
								{t("settings.mcp.args")}
								<input
									className={FIELD}
									value={(editing.args ?? []).join(" ")}
									onChange={(e) =>
										setEditing({ ...editing, args: e.target.value.split(/\s+/).filter(Boolean) })
									}
								/>
							</label>
						</>
					) : (
						<label className="text-[12px] text-ink-2">
							{t("settings.mcp.url")}
							<input
								className={FIELD}
								value={editing.url ?? ""}
								onChange={(e) => setEditing({ ...editing, url: e.target.value })}
							/>
						</label>
					)}
					{editingTools.length > 0 && (
						<div className="mt-1 flex flex-col gap-1 border-t border-border pt-2">
							<span className="text-[12px] font-medium text-ink-dim">{t("settings.mcp.toolExposure")}</span>
							{editingTools.map((tool) => (
								<div key={tool.name} className="flex items-center justify-between gap-2">
									<span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">{tool.name}</span>
									<Select
										className="shrink-0 py-0.5 pl-1.5 pr-5 text-[11px]"
										value={editing.toolExposure?.[tool.name] ?? ""}
										onChange={(value) => {
											const next = { ...(editing.toolExposure ?? {}) };
											if (value === "") delete next[tool.name];
											else next[tool.name] = value as McpExposure;
											setEditing({ ...editing, toolExposure: next });
										}}
										options={[
											{ value: "", label: t("settings.mcp.toolExposureDefault") },
											...EXPOSURES.map((value) => ({
												value,
												label: t(`settings.mcp.exposure_${value}`),
											})),
										]}
									/>
								</div>
							))}
						</div>
					)}
					<div className="mt-1 flex justify-end gap-2">
						<button
							type="button"
							className="flex h-8 items-center rounded-[9px] px-3 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
							onClick={() => setEditing(null)}
						>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							className="flex h-8 items-center rounded-[9px] bg-ink px-3 text-[13px] font-medium text-on-ink transition-opacity hover:opacity-90 disabled:opacity-40"
							disabled={busy}
							onClick={() => void save()}
						>
							{t("settings.mcp.save")}
						</button>
					</div>
				</div>
			)}

			{sections.map((section) => (
				<div key={section.scope} className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3">
						<h4 className="text-[12px] font-medium text-ink-dim">{section.title}</h4>
						<button
							type="button"
							className="flex h-7 shrink-0 items-center rounded-[9px] bg-ink px-2.5 text-[12px] font-medium text-on-ink transition-opacity hover:opacity-90 disabled:opacity-40"
							disabled={busy || editing !== null || (section.scope === "project" && !config?.projectTrusted)}
							title={
								section.scope === "project" && !config?.projectTrusted
									? t("settings.mcp.projectNeedsTrust")
									: undefined
							}
							onClick={() => startAdd(section.scope)}
						>
							{t("settings.mcp.add")}
						</button>
					</div>
					{section.scope === "project" && !config?.projectTrusted && (
						<p className="text-[11px] text-ink-faint">{t("settings.mcp.projectNeedsTrust")}</p>
					)}
					{section.servers.length === 0 ? (
						<p className="rounded-xl border border-border px-3 py-6 text-center text-[12px] text-ink-faint">
							{t("settings.mcp.empty")}
						</p>
					) : (
						<ul className="flex flex-col gap-1.5">
							{section.servers.map((server) => (
								<ServerRow
									key={`${section.scope}:${server.name}`}
									server={server}
									busy={busy}
									onToggle={(s, next) => void toggle(s, next)}
									onEdit={startEdit}
									onDelete={setPendingDelete}
								/>
							))}
						</ul>
					)}
				</div>
			))}

			{config?.errors.map((error) => (
				<p key={error} className="text-[11px] text-red-600">
					{error}
				</p>
			))}

			{pendingDelete && (
				<ConfirmDialog
					title={t("settings.mcp.deleteTitle")}
					description={t("settings.mcp.deleteDesc")}
					confirmLabel={t("settings.mcp.delete")}
					cancelLabel={t("common.cancel")}
					onConfirm={async () => {
						const name = pendingDelete;
						setPendingDelete(null);
						await remove(name);
					}}
					onCancel={() => setPendingDelete(null)}
				/>
			)}
		</section>
	);
}
