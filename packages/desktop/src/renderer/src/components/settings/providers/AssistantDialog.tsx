import { SUBAGENT_TOOL_NAMES, type SubagentInfo, THINKING_LEVELS } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type MessageKey, useT } from "../../../i18n";
import { errText } from "../../../lib/error-text";
import { useSessionsStore } from "../../../stores/sessions";
import { useSettingsStore } from "../../../stores/settings";
import { useToastsStore } from "../../../stores/toasts";
import { CloseIcon } from "../../icons";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";

const inputClass =
	"w-full rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-ink-faint";
const SELECT_CLASS =
	"w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-ink-faint";
const LABEL_CLASS = "text-[12px] font-medium text-ink-2";

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;

const DEFAULT_TOOLS = ["read", "grep", "find", "ls"];

export function AssistantDialog({ agent, onClose }: { agent: SubagentInfo | null; onClose: () => void }) {
	const t = useT();

	const toolLabel = (name: string) => {
		const key = `tool.names.${name}` as MessageKey;
		const label = t(key);
		return !label || label === key ? name : label;
	};
	const prefs = useSettingsStore((s) => s.modelPrefs);
	const models = useSessionsStore((s) => s.models);
	const saveSubagent = useSettingsStore((s) => s.saveSubagent);
	const deleteSubagent = useSettingsStore((s) => s.deleteSubagent);
	const setSubagentModel = useSettingsStore((s) => s.setSubagentModel);
	const setSubagentThinking = useSettingsStore((s) => s.setSubagentThinking);
	const builtin = agent?.source === "builtin";
	const [name, setName] = useState(agent?.name ?? "");
	const [description, setDescription] = useState(agent?.description ?? "");
	const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
	const [tools, setTools] = useState<string[]>(agent ? agent.tools : DEFAULT_TOOLS);
	const [model, setModel] = useState(agent ? (prefs?.subagentModels[agent.name] ?? "") : "");
	const [thinking, setThinking] = useState(agent ? (prefs?.subagentThinking?.[agent.name] ?? "") : "");
	const [saving, setSaving] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!agent) nameRef.current?.focus();
	}, [agent]);

	useEffect(() => {
		if (confirming) return;
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			onClose();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose, confirming]);

	const trimmedName = name.trim();
	const nameInvalid = trimmedName.length > 0 && !NAME_PATTERN.test(trimmedName);
	const promptMissing = systemPrompt.trim().length === 0;
	const canSave =
		!saving &&
		trimmedName.length > 0 &&
		!nameInvalid &&
		(!builtin || trimmedName === agent?.name) &&
		(builtin || !promptMissing);

	const toggleTool = (tool: string) => {
		const next = new Set(tools);
		if (next.has(tool)) next.delete(tool);
		else next.add(tool);

		const known = SUBAGENT_TOOL_NAMES.filter((item) => next.has(item));
		const extra = tools.filter((item) => next.has(item) && !SUBAGENT_TOOL_NAMES.includes(item));
		setTools([...known, ...extra]);
	};

	const save = async () => {
		if (!canSave) return;
		setSaving(true);
		try {
			if (!builtin) {
				await saveSubagent({
					name: trimmedName,
					...(agent ? { originalName: agent.name } : {}),
					description: description.trim(),
					systemPrompt,
					tools,
				});
			}

			await setSubagentModel(trimmedName, model || null);
			await setSubagentThinking(trimmedName, thinking || null);
			useToastsStore.getState().push("info", "settings.models.assistantSaved", trimmedName);
			onClose();
		} catch (error) {
			useToastsStore.getState().push("error", "settings.models.assistantSaveFailed", errText(error));
			setSaving(false);
		}
	};

	const doDelete = async () => {
		if (!agent) return;
		setConfirming(false);
		setDeleting(true);
		try {
			await deleteSubagent(agent.name);
			useToastsStore.getState().push("info", "settings.models.assistantDeleted", agent.name);
			onClose();
		} catch (error) {
			useToastsStore.getState().push("error", "settings.models.assistantDeleteFailed", errText(error));
			setDeleting(false);
		}
	};

	return createPortal(
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20" role="presentation">
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-label={agent ? agent.name : t("settings.models.assistantCreateTitle")}
				className="relative flex max-h-[80vh] w-[520px] flex-col rounded-2xl border border-border bg-surface px-[22px] pt-5 pb-4 shadow-dialog"
			>
				<div className="flex items-center gap-2">
					<h2 className="min-w-0 flex-1 truncate text-[17px] font-bold tracking-[-0.01em] text-ink">
						{agent ? t("settings.models.assistantEditTitle") : t("settings.models.assistantCreateTitle")}
					</h2>
					<button
						type="button"
						className="flex shrink-0 text-ink-faint transition-colors hover:text-ink-2"
						onClick={onClose}
						aria-label={t("common.close")}
					>
						<CloseIcon size={14} />
					</button>
				</div>
				<div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
					<label className="block">
						<span className={LABEL_CLASS}>{t("settings.models.assistantName")}</span>
						<input
							ref={nameRef}
							className={inputClass + " mt-1 disabled:opacity-60"}
							value={name}
							disabled={builtin}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("settings.models.assistantNamePlaceholder")}
							spellCheck={false}
						/>
						<span className="mt-1 block text-[11px] text-ink-faint">
							{nameInvalid ? (
								<span className="text-red-500">{t("settings.models.assistantNameInvalid")}</span>
							) : (
								t("settings.models.assistantNameHint")
							)}
						</span>
					</label>
					<label className="block">
						<span className={LABEL_CLASS}>{t("settings.models.assistantDescription")}</span>
						<input
							className={inputClass + " mt-1 disabled:opacity-60"}
							value={description}
							disabled={builtin}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t("settings.models.assistantDescriptionPlaceholder")}
						/>
						<span className="mt-1 block text-[11px] text-ink-faint">
							{t("settings.models.assistantDescriptionHint")}
						</span>
					</label>
					<label className="block">
						<span className={LABEL_CLASS}>{t("settings.models.assistantPrompt")}</span>
						<textarea
							className={inputClass + " mt-1 h-36 resize-none font-mono disabled:opacity-60"}
							value={systemPrompt}
							disabled={builtin}
							onChange={(e) => setSystemPrompt(e.target.value)}
							placeholder={t("settings.models.assistantPromptPlaceholder")}
							spellCheck={false}
						/>
						<span className="mt-1 block text-[11px] text-ink-faint">
							{!builtin && promptMissing ? (
								<span className="text-red-500">{t("settings.models.assistantPromptRequired")}</span>
							) : (
								t("settings.models.assistantPromptHint")
							)}
						</span>
					</label>
					<div>
						<span className={LABEL_CLASS}>{t("settings.models.assistantTools")}</span>
						<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
							{SUBAGENT_TOOL_NAMES.map((tool) => (
								<label key={tool} className="flex items-center gap-1.5 text-[12px] text-ink-2">
									<input
										type="checkbox"
										className="accent-ink"
										checked={tools.includes(tool)}
										disabled={builtin}
										onChange={() => toggleTool(tool)}
									/>
									<span className="font-mono">{toolLabel(tool)}</span>
								</label>
							))}
						</div>
						<span className="mt-1 block text-[11px] text-ink-faint">
							{t("settings.models.assistantToolsHint")}
						</span>
						{agent?.path && (
							<span className="mt-1 block truncate font-mono text-[10px] text-ink-faint">{agent.path}</span>
						)}
					</div>
					<div className="grid grid-cols-2 gap-2">
						<label className="block">
							<span className={LABEL_CLASS}>{t("settings.models.assistantModel")}</span>
							<select
								className={SELECT_CLASS + " mt-1"}
								value={model}
								onChange={(e) => setModel(e.target.value)}
							>
								<option value="">{t("settings.models.inherit")}</option>
								{model && !models.some((m) => m.provider + "/" + m.id === model) && (
									<option value={model}>{model}</option>
								)}
								{models.map((m) => (
									<option key={m.provider + "/" + m.id} value={m.provider + "/" + m.id}>
										{m.providerName} · {m.label}
									</option>
								))}
							</select>
						</label>
						<label className="block">
							<span className={LABEL_CLASS}>{t("settings.models.assistantThinking")}</span>
							<select
								className={SELECT_CLASS + " mt-1"}
								value={thinking}
								onChange={(e) => setThinking(e.target.value)}
							>
								<option value="">
									{agent?.thinking
										? t("settings.models.subagentThinkingInheritWith", {
												level: t(("thinkingLevels." + agent.thinking) as MessageKey),
											})
										: t("settings.models.subagentThinkingInherit")}
								</option>
								{THINKING_LEVELS.map((level) => (
									<option key={level} value={level}>
										{t(("thinkingLevels." + level) as MessageKey)}
									</option>
								))}
							</select>
						</label>
					</div>
					<p className="text-[11px] leading-relaxed text-ink-faint">
						{builtin ? t("settings.models.assistantBuiltinHint") : t("settings.models.subagentHint")}
					</p>
				</div>
				<div className="mt-[18px] flex items-center justify-between">
					<div>
						{agent && !builtin && (
							<Button
								tone="danger"
								variant="ghost"
								disabled={deleting || saving}
								onClick={() => setConfirming(true)}
							>
								{t("common.delete")}
							</Button>
						)}
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							className="flex h-8 items-center rounded-[9px] px-3.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
							onClick={onClose}
						>
							{t("common.cancel")}
						</button>
						<Button variant="primary" disabled={!canSave} onClick={() => void save()}>
							{saving ? t("settings.models.assistantSaving") : t("common.save")}
						</Button>
					</div>
				</div>
			</div>
			{confirming && agent && (
				<ConfirmDialog
					title={t("settings.models.assistantDeleteTitle")}
					description={t("settings.models.assistantDeleteDesc", { name: agent.name })}
					confirmLabel={t("common.delete")}
					cancelLabel={t("common.cancel")}
					danger
					onConfirm={() => void doDelete()}
					onCancel={() => setConfirming(false)}
				/>
			)}
		</div>,
		document.body,
	);
}
