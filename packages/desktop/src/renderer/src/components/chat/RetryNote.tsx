import type { RetryInfo } from "@tcode/shared";
import { useT } from "../../i18n";
import { RefreshIcon } from "../icons";

export function RetryNote({ info }: { info: RetryInfo }) {
	const t = useT();
	return (
		<div className="retry-note" role="status">
			<RefreshIcon />
			<span>
				{t("error.retrying", {
					attempt: info.attempt,
					maxAttempts: info.maxAttempts,
					delay: Math.ceil(info.delayMs / 1000),
				})}
			</span>
		</div>
	);
}
