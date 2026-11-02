import { type MessageKey, useT } from "../i18n";
import { useToastsStore } from "../stores/toasts";
import { CloseIcon, ErrorCircleIcon, InfoIcon, WarningIcon } from "./icons";

function SeverityGlyph({ severity }: { severity: "error" | "warning" | "info" }) {
	if (severity === "warning") {
		return (
			<span className="t-glyph text-warn">
				<WarningIcon />
			</span>
		);
	}
	if (severity === "info") {
		return (
			<span className="t-glyph text-info">
				<InfoIcon />
			</span>
		);
	}
	return (
		<span className="t-glyph text-err">
			<ErrorCircleIcon />
		</span>
	);
}

export function Toaster() {
	const t = useT();
	const toasts = useToastsStore((s) => s.toasts);
	const overflowCount = useToastsStore((s) => s.overflowCount);
	const dismiss = useToastsStore((s) => s.dismiss);

	if (toasts.length === 0 && overflowCount === 0) return null;
	return (
		<div className="pointer-events-none fixed right-4 top-14 z-50 flex w-[330px] flex-col gap-2.5">
			{toasts.map((toast) => (
				<div key={toast.id} className="toast">
					<SeverityGlyph severity={toast.severity} />
					<div className="min-w-0">
						<div className="t-title">
							{toast.titleText !== undefined ? toast.titleText : t(toast.titleKey as MessageKey)}
						</div>
						{toast.detail && <div className="t-sub truncate">{toast.detail}</div>}
					</div>
					<button
						type="button"
						className="t-x"
						aria-label={t("common.close")}
						onClick={() => dismiss(toast.id)}
					>
						<CloseIcon />
					</button>
				</div>
			))}
			{overflowCount > 0 && (
				<div className="toast-overflow">
					<InfoIcon size={11} />
					{t("toast.overflowCollapsed", { count: overflowCount })}
				</div>
			)}
		</div>
	);
}
