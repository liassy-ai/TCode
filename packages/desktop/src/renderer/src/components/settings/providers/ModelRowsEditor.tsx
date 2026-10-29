import { CUSTOM_THINKING_LEVELS, type CustomThinkingLevel } from "@tcode/shared";
import { useT } from "../../../i18n";
import { thinkingLevelKey } from "../../../lib/thinking";
import { CloseIcon } from "../../icons";
import { Tooltip } from "../../ui/Tooltip";
import { type ModelRow, newModelRow, parseTokenCount, splitPastedModelIds } from "./model-rows";

const inputClass =
	"w-full rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-ink-faint disabled:cursor-not-allowed disabled:text-ink-faint";

export function ModelRowsEditor({
	rows,
	onChange,
}: {
	rows: ModelRow[];
	onChange: (rows: ModelRow[]) => void;
}) {
	const t = useT();

	const setRow = (index: number, patch: Partial<ModelRow>) =>
		onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

	const removeRow = (index: number) => {
		const next = rows.filter((_, i) => i !== index);
		onChange(next.length > 0 ? next : [newModelRow()]);
	};

	const onIdPaste = (index: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
		const ids = splitPastedModelIds(e.clipboardData.getData("text"));
		if (!ids) return;
		e.preventDefault();
		const next = [...rows];
		const current = next[index];
		if (!current) return;
		if (current.id.trim()) {
			next.splice(index + 1, 0, ...ids.map((id) => newModelRow({ id })));
		} else {
			next[index] = { ...current, id: ids[0] };
			next.splice(index + 1, 0, ...ids.slice(1).map((id) => newModelRow({ id })));
		}
		onChange(next);
	};

	const numberField = (value: string, placeholder: string, onValue: (v: string) => void, tooltip: string) => {
		const invalid = value.trim() !== "" && parseTokenCount(value) === null;
		return (
			<Tooltip label={tooltip} className="w-[4.5rem] shrink-0">
				<input
					className={`${inputClass} text-center ${invalid ? "border-red-400" : ""}`}
					placeholder={placeholder}
					value={value}
					onChange={(e) => onValue(e.target.value)}
				/>
			</Tooltip>
		);
	};

	const levelField = (value: string, level: CustomThinkingLevel, onValue: (v: string) => void) => (
		<label key={level} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-0.5">
			<span className="text-[10px] leading-none text-ink-faint">{t(thinkingLevelKey(level))}</span>
			<Tooltip label={t("settings.providers.customModelLevel", { level })} className="w-full">
				<input
					className={`${inputClass} py-1 text-center`}
					placeholder={t("settings.providers.customModelLevelHidden")}
					value={value}
					onChange={(e) => onValue(e.target.value)}
				/>
			</Tooltip>
		</label>
	);

	const toggle = (active: boolean, label: string, onToggle: () => void) => (
		<button
			type="button"
			aria-pressed={active}
			className={`shrink-0 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
				active ? "border-ink-faint bg-hover text-ink" : "border-border text-ink-faint hover:text-ink-dim"
			}`}
			onClick={onToggle}
		>
			{label}
		</button>
	);

	return (
		<div className="col-span-2">
			{rows.map((row, i) => (
				<div key={i} className="mb-1.5">
					<div className="flex items-center gap-1.5">
						<input
							className={`${inputClass} min-w-0 flex-1`}
							placeholder={t("settings.providers.customModelId")}
							value={row.id}
							onChange={(e) => setRow(i, { id: e.target.value })}
							onPaste={onIdPaste(i)}
						/>
						{numberField(
							row.contextWindow,
							"ctx 128k",
							(v) => setRow(i, { contextWindow: v }),
							t("settings.providers.customModelCtx"),
						)}
						{numberField(
							row.maxTokens,
							"out 16k",
							(v) => setRow(i, { maxTokens: v }),
							t("settings.providers.customModelOut"),
						)}
						{toggle(row.reasoning, t("settings.providers.customModelReasoning"), () =>
							setRow(i, { reasoning: !row.reasoning }),
						)}
						{toggle(row.imageInput, t("settings.providers.customModelImage"), () =>
							setRow(i, { imageInput: !row.imageInput }),
						)}
						<button
							type="button"
							aria-label={t("settings.providers.removeModelRow")}
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-hover hover:text-ink-dim"
							onClick={() => removeRow(i)}
						>
							<CloseIcon size={9} />
						</button>
					</div>

					{row.reasoning && (
						<div className="mt-1 flex flex-wrap items-start gap-1.5 pl-1">
							<span className="shrink-0 pt-px text-[10px] leading-none text-ink-faint">
								{t("settings.providers.customModelLevels")}
							</span>
							{CUSTOM_THINKING_LEVELS.map((level) =>
								levelField(row.levels[level], level, (v) =>
									setRow(i, { levels: { ...row.levels, [level]: v } }),
								),
							)}
						</div>
					)}
				</div>
			))}
			<div className="flex items-center gap-3">
				<button
					type="button"
					className="rounded-md px-1.5 py-1 text-[11px] text-ink-dim transition-colors hover:bg-hover"
					onClick={() => onChange([...rows, newModelRow()])}
				>
					{t("settings.providers.addModelRow")}
				</button>
			</div>
			<p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
				{t("settings.providers.customModelsHint")}
			</p>
			{rows.every((row) => !row.id.trim()) && (
				<p className="mt-1 text-[10px] leading-relaxed text-ink-dim">
					{t("settings.providers.customModelsEmptyHint")}
				</p>
			)}
		</div>
	);
}
