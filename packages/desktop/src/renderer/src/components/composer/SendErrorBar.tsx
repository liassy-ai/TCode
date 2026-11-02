import type { UiError } from "@tcode/shared";
import { type MessageKey, useT } from "../../i18n";
import { ErrorCircleIcon, RefreshIcon } from "../icons";

export function SendErrorBar({ error, onRetry }: { error: UiError; onRetry: () => void }) {
	const t = useT();
	return (
		<div data-floor-ignore="" className="send-error mb-1.5" role="alert">
			<span className="se-glyph">
				<ErrorCircleIcon />
			</span>
			<div className="min-w-0">
				<div className="se-title truncate">{t(error.titleKey as MessageKey, error.titleParams)}</div>
				{error.detail && <div className="se-sub truncate">{error.detail}</div>}
			</div>
			{error.actions.includes("retry") && (
				<button type="button" className="se-retry" onClick={onRetry}>
					<RefreshIcon />
					{t("error.action.retry")}
				</button>
			)}
		</div>
	);
}
