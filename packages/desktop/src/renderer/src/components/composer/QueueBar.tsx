import { useT } from "../../i18n";
import { UndoIcon, WandIcon } from "../icons";
import { queuedIsAnnotation, queuedPreview } from "./queued-text";

export function QueueBar({ raw, onRestore }: { raw: string; onRestore: () => void }) {
	const t = useT();
	return (
		<div
			data-floor-ignore=""
			className="group/queue relative mb-1.5 flex items-center gap-2 overflow-hidden rounded-xl bg-surface px-3 py-1.5 shadow-soft"
		>
			<span className="shrink-0 text-[12px] text-ink-faint">{t("composer.queueTitle")}</span>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-ink-2">
				{queuedIsAnnotation(raw) && <WandIcon size={13} className="shrink-0" />}
				<span className="min-w-0 truncate">{queuedPreview(raw, t("composer.annotationChip"))}</span>
			</span>

			<div className="pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end pr-2.5 opacity-0 transition-opacity group-hover/queue:opacity-100">
				<span
					className="absolute inset-0 bg-gradient-to-l from-surface/60 to-transparent backdrop-blur-[3px] [mask-image:linear-gradient(to_left,black_45%,transparent)]"
					aria-hidden="true"
				/>
				<button
					type="button"
					className="pointer-events-auto relative flex items-center justify-center text-ink-faint transition-colors hover:text-ink-2"
					aria-label={t("composer.queueRestore")}
					onClick={onRestore}
				>
					<UndoIcon size={14} />
				</button>
			</div>
		</div>
	);
}
