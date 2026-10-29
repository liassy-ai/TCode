import { type CustomProviderInput, KNOWN_APIS, type ProviderInfo } from "@tcode/shared";
import { useState } from "react";
import { useT } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings";
import { Tooltip } from "../../ui/Tooltip";
import { ModelRowsEditor } from "./ModelRowsEditor";
import { type ModelRow, modelsToRows, newModelRow, rowsToModelInputs, rowsValid } from "./model-rows";

interface ProviderFormState {
	id: string;
	name: string;
	baseUrl: string;
	api: string;

	models: ModelRow[];
	apiKey: string;
}

const EMPTY_FORM: ProviderFormState = {
	id: "",
	name: "",
	baseUrl: "",
	api: "openai-completions",
	models: [newModelRow()],
	apiKey: "",
};

function toInput(form: ProviderFormState): CustomProviderInput {
	return {
		id: form.id,
		name: form.name || undefined,
		baseUrl: form.baseUrl,
		api: form.api,
		models: rowsToModelInputs(form.models),
		apiKey: form.apiKey || undefined,
	};
}

const inputClass =
	"w-full rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-ink-faint disabled:cursor-not-allowed disabled:text-ink-faint";

function ProviderConfigForm({
	title,
	initial,
	lockId,
	onSubmit,
	onCancel,
}: {
	title: string;
	initial: ProviderFormState;

	lockId?: boolean;
	onSubmit: (form: ProviderFormState) => Promise<void>;
	onCancel: () => void;
}) {
	const t = useT();
	const [form, setForm] = useState(initial);
	const [submitting, setSubmitting] = useState(false);

	const set = (field: keyof ProviderFormState) => (e: { target: { value: string } }) =>
		setForm((f) => ({ ...f, [field]: e.target.value }));

	const submit = async () => {
		setSubmitting(true);
		try {
			await onSubmit(form);
		} catch {
		} finally {
			setSubmitting(false);
		}
	};

	const apiOptions = (KNOWN_APIS as readonly string[]).includes(form.api)
		? KNOWN_APIS
		: [form.api, ...KNOWN_APIS];

	const idInput = (
		<input
			className={inputClass}
			placeholder={t("settings.providers.customId")}
			value={form.id}
			onChange={set("id")}
			disabled={lockId}
		/>
	);

	return (
		<div className="rounded-xl border border-border p-3">
			<h3 className="text-[13px] font-medium text-ink">{title}</h3>
			<div className="mt-2 grid grid-cols-2 gap-2">
				{lockId ? (
					<Tooltip label={t("settings.providers.customIdLocked")} className="w-full">
						{idInput}
					</Tooltip>
				) : (
					idInput
				)}
				<input
					className={inputClass}
					placeholder={t("settings.providers.customName")}
					value={form.name}
					onChange={set("name")}
				/>
				<input
					className={`${inputClass} col-span-2`}
					placeholder={t("settings.providers.customBaseUrl")}
					value={form.baseUrl}
					onChange={set("baseUrl")}
				/>
				<select className={inputClass} value={form.api} onChange={set("api")}>
					{apiOptions.map((api) => (
						<option key={api} value={api}>
							{api}
						</option>
					))}
				</select>
				<input
					className={inputClass}
					placeholder={lockId ? t("settings.providers.customKeyKeep") : t("settings.providers.customKey")}
					type="password"
					value={form.apiKey}
					onChange={set("apiKey")}
				/>
				<ModelRowsEditor rows={form.models} onChange={(models) => setForm((f) => ({ ...f, models }))} />
			</div>
			<div className="mt-2 flex justify-end gap-2">
				<button
					type="button"
					className="rounded-lg px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:bg-hover"
					onClick={onCancel}
				>
					{t("common.cancel")}
				</button>
				<button
					type="button"
					className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40"
					onClick={() => void submit()}
					disabled={submitting || !form.id.trim() || !form.baseUrl.trim() || !rowsValid(form.models)}
				>
					{submitting ? t("settings.providers.submitting") : t("common.save")}
				</button>
			</div>
		</div>
	);
}

export function CustomProviderForm() {
	const t = useT();
	const addCustom = useSettingsStore((s) => s.addCustom);
	const [show, setShow] = useState(false);

	if (!show) {
		return (
			<button
				type="button"
				className="mt-3 w-full rounded-lg border border-dashed border-border py-2 text-[13px] text-ink-dim transition-colors hover:border-border-strong hover:bg-hover"
				onClick={() => setShow(true)}
			>
				{t("settings.providers.addCustom")}
			</button>
		);
	}

	return (
		<div className="mt-3">
			<ProviderConfigForm
				title={t("settings.providers.customTitle")}
				initial={EMPTY_FORM}
				onSubmit={async (form) => {
					await addCustom(toInput(form));
					setShow(false);
				}}
				onCancel={() => setShow(false)}
			/>
		</div>
	);
}

export function CustomProviderEditForm({ provider, onDone }: { provider: ProviderInfo; onDone: () => void }) {
	const t = useT();
	const updateCustom = useSettingsStore((s) => s.updateCustom);

	return (
		<ProviderConfigForm
			title={t("settings.providers.editCustomTitle")}
			initial={{
				...EMPTY_FORM,
				id: provider.id,

				name: provider.name !== provider.id ? provider.name : "",
				baseUrl: provider.baseUrl ?? "",
				api: provider.api ?? "openai-completions",

				models: modelsToRows(provider.customModels ?? []),
			}}
			lockId
			onSubmit={async (form) => {
				await updateCustom(toInput(form));
				onDone();
			}}
			onCancel={onDone}
		/>
	);
}
