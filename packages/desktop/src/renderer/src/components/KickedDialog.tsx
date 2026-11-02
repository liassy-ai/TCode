import { createPortal } from "react-dom";
import { usePluginNotifyStore } from "../stores/plugin-notify";

export function KickedDialog() {
	const kicked = usePluginNotifyStore((s) => s.kicked);
	const dismiss = usePluginNotifyStore((s) => s.dismissKicked);

	if (kicked === null) return null;

	const body = kicked.trim();

	return createPortal(
		<div className="fixed inset-0 z-[85] flex items-center justify-center bg-ink/10" role="presentation">
			<div
				role="dialog"
				aria-modal="true"
				aria-label="连接已断开"
				className="relative w-[420px] max-w-[calc(100vw-48px)] rounded-2xl border border-border bg-surface px-6 py-5 shadow-dialog"
			>
				<h2 className="text-[15px] font-semibold text-ink">连接已断开</h2>
				{body ? <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{body}</p> : null}
				<div className="mt-5 flex justify-end">
					<button
						type="button"
						className="flex h-8 items-center rounded-[9px] bg-ink px-3.5 text-[13px] font-medium text-on-ink transition-colors hover:bg-ink-2"
						onClick={dismiss}
					>
						知道了
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
