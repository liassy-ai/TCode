import { createPortal } from "react-dom";
import { useUpdateStore } from "../stores/update";

export function ServiceNotice() {
	const required = useUpdateStore((s) => s.required);
	const maintenance = useUpdateStore((s) => s.maintenance);
	const note = useUpdateStore((s) => s.maintenanceNote);
	const version = useUpdateStore((s) => s.version);
	const status = useUpdateStore((s) => s.status);
	const percent = useUpdateStore((s) => s.percent);
	const error = useUpdateStore((s) => s.error);
	const download = useUpdateStore((s) => s.download);
	const install = useUpdateStore((s) => s.install);

	if (!maintenance && !required) return null;

	const title = maintenance ? "服务维护中" : "需要升级";
	const body = maintenance
		? note || "服务正在维护，请稍后再试。"
		: `当前客户端版本低于最低要求，请升级到 ${version || "最新版本"} 后继续使用。`;

	return createPortal(
		<div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/6" role="presentation">
			<div className="relative w-[420px] rounded-2xl border border-border bg-surface px-6 py-5 shadow-dialog">
				<h2 className="text-[15px] font-semibold text-ink">{title}</h2>
				<p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{body}</p>
				{error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}
				{required && !maintenance ? (
					<div className="mt-5 flex justify-end gap-2">
						{status === "downloaded" ? (
							<button
								type="button"
								className="flex h-8 items-center rounded-[9px] bg-ink px-3.5 text-[13px] font-medium text-on-ink transition-colors hover:bg-ink-2"
								onClick={() => void install()}
							>
								立即安装
							</button>
						) : (
							<button
								type="button"
								className="flex h-8 items-center rounded-[9px] bg-ink px-3.5 text-[13px] font-medium text-on-ink transition-colors hover:bg-ink-2"
								onClick={() => void download()}
							>
								{status === "downloading" ? `下载中 ${percent}%` : "下载更新"}
							</button>
						)}
					</div>
				) : null}
			</div>
		</div>,
		document.body,
	);
}
