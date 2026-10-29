import { useT } from "../../i18n";
import { ChevronRightIcon, CloseIcon, WandIcon } from "../icons";

export function AnnotationBar({
	count,
	open,
	onToggle,
	opensAbove,
}: {
	count: number;
	open: boolean;
	onToggle: () => void;

	opensAbove: boolean;
}) {
	const t = useT();

	const arrowRotate = open ? (opensAbove ? "-rotate-90" : "rotate-90") : "";
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			aria-label={t("composer.annotationChip")}
			className="flex h-[50px] cursor-pointer select-none items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] leading-5 text-ink"
		>
			<WandIcon size={14} />
			<span className="font-semibold">{t("composer.annotationChip")}</span>
			<span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-on-ink">
				{count}
			</span>
			<span className={`transition-transform motion-reduce:transition-none ${arrowRotate}`}>
				<ChevronRightIcon size={13} />
			</span>
		</button>
	);
}

export function AnnotationChip({
	label,
	number,
	elementLabel,
	note,
	onClick,
	onRemove,
}: {
	label: string;

	number?: number;

	elementLabel: string;

	note: string;

	onClick?: () => void;

	onRemove?: () => void;
}) {
	const t = useT();
	return (
		<div
			role={onClick ? "button" : undefined}
			tabIndex={onClick ? 0 : undefined}
			onClick={onClick}
			onKeyDown={(event) => {
				if (onClick && (event.key === "Enter" || event.key === " ")) {
					event.preventDefault();
					onClick();
				}
			}}
			title={onClick ? t("composer.editAnnotation") : undefined}
			className={`flex w-full min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-ink ${
				onClick ? "cursor-pointer transition-colors hover:bg-hover motion-reduce:transition-none" : ""
			}`}
		>
			<div className="flex items-center gap-1.5">
				<WandIcon size={13} className="shrink-0" />
				<span className="shrink-0 text-[13px] leading-5 font-semibold">{label}</span>
				{number !== undefined && (
					<span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-on-ink">
						{number}
					</span>
				)}
				<span className="ml-auto min-w-0 break-words text-[11px] text-ink-faint" title={elementLabel}>
					{elementLabel}
				</span>
				{onRemove && (
					<button
						type="button"
						aria-label={t("composer.removeAnnotation")}
						onClick={(event) => {
							event.stopPropagation();
							onRemove();
						}}
						className="shrink-0 text-ink-faint transition-colors hover:text-ink"
					>
						<CloseIcon size={9} />
					</button>
				)}
			</div>
			<div className="truncate text-[12px] leading-4 text-ink-2" title={note}>
				{note}
			</div>
		</div>
	);
}
