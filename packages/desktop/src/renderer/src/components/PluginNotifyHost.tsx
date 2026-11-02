import { type ReactNode, useEffect } from "react";
import { usePluginNotifyStore } from "../stores/plugin-notify";
import { useUpdateStore } from "../stores/update";
import { CloseIcon } from "./icons";

export function PluginNotifyHost(): ReactNode {
	const announce = usePluginNotifyStore((s) => s.announce);
	const dismissAnnounce = usePluginNotifyStore((s) => s.dismissAnnounce);

	useEffect(() => {
		void useUpdateStore.getState().init();
		return usePluginNotifyStore.getState().start();
	}, []);

	if (!announce) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30" role="dialog" aria-modal>
			<div className="relative flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-dialog">
				<button
					type="button"
					aria-label="关闭"
					onClick={dismissAnnounce}
					className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink"
				>
					<CloseIcon size={11} />
				</button>
				<div className="pr-8 text-[15px] font-semibold text-ink">{announce.title || "公告"}</div>
				<div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-[13px] text-ink-2">
					{announce.content}
				</div>
				{announce.signature ? (
					<div className="flex flex-col items-end text-[12px] text-ink-faint">
						{announce.signature.split("\n").map((line) => (
							<span key={line}>{line}</span>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}
