import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import { errText } from "../../lib/error-text";
import { useSettingsStore } from "../../stores/settings";
import { useToastsStore } from "../../stores/toasts";
import { CloseIcon } from "../icons";
import { Button } from "../ui/Button";

const inputClass =
	"w-full rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-ink-faint";

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function AddSkillDialog({ onDone }: { onDone: () => void }) {
	const t = useT();
	const createUserSkill = useSettingsStore((s) => s.createUserSkill);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [content, setContent] = useState("");
	const [creating, setCreating] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current?.contains(e.target as Node)) return;
			onDone();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onDone();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [onDone]);

	const trimmedName = name.trim();
	const nameInvalid = trimmedName.length > 0 && !NAME_PATTERN.test(trimmedName);
	const canCreate = trimmedName.length > 0 && !nameInvalid && description.trim().length > 0 && !creating;

	const create = async () => {
		if (!canCreate) return;
		setCreating(true);
		try {
			const path = await createUserSkill({ name: trimmedName, description, content });
			useToastsStore.getState().push("info", "settings.skills.added", path);
			onDone();
		} catch (error) {
			useToastsStore.getState().push("error", "settings.skills.addFailed", errText(error));
			setCreating(false);
		}
	};

	return createPortal(
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20" role="presentation">
			<div
				ref={ref}
				role="dialog"
				aria-modal="true"
				aria-label={t("settings.skills.addTitle")}
				className="relative w-[440px] rounded-2xl border border-border bg-surface px-[22px] pt-5 pb-4 shadow-dialog"
			>
				<h2 className="pr-6 text-[19px] font-bold tracking-[-0.01em] text-ink">
					{t("settings.skills.addTitle")}
				</h2>
				<button
					type="button"
					className="absolute top-4 right-4 flex text-ink-faint transition-colors hover:text-ink-2"
					onClick={onDone}
					aria-label={t("common.close")}
				>
					<CloseIcon size={14} />
				</button>
				<div className="mt-4 space-y-3">
					<label className="block">
						<span className="text-[12px] font-medium text-ink-2">{t("settings.skills.nameLabel")}</span>
						<input
							ref={nameRef}
							className={`${inputClass} mt-1`}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("settings.skills.namePlaceholder")}
							spellCheck={false}
						/>
						{nameInvalid && (
							<span className="mt-1 block text-[11px] text-red-500">{t("settings.skills.nameInvalid")}</span>
						)}
					</label>
					<label className="block">
						<span className="text-[12px] font-medium text-ink-2">
							{t("settings.skills.descriptionLabel")}
						</span>
						<input
							className={`${inputClass} mt-1`}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={t("settings.skills.descriptionPlaceholder")}
						/>
					</label>
					<label className="block">
						<span className="text-[12px] font-medium text-ink-2">{t("settings.skills.contentLabel")}</span>
						<textarea
							className={`${inputClass} mt-1 h-28 resize-none font-mono`}
							value={content}
							onChange={(e) => setContent(e.target.value)}
							placeholder={t("settings.skills.contentPlaceholder")}
							spellCheck={false}
						/>
					</label>
				</div>
				<div className="mt-[18px] flex justify-end gap-2">
					<button
						type="button"
						className="flex h-8 items-center rounded-[9px] px-3.5 text-[13px] text-ink-dim transition-colors hover:bg-hover hover:text-ink"
						onClick={onDone}
					>
						{t("common.cancel")}
					</button>
					<Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
						{creating ? t("settings.skills.creating") : t("settings.skills.create")}
					</Button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
