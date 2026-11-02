import { type ReactNode, useEffect, useState } from "react";
import { getPi } from "../api";
import { usePluginNotifyStore } from "../stores/plugin-notify";
import { CloseIcon } from "./icons";

export function PluginGiftHost(): ReactNode {
	const gift = usePluginNotifyStore((s) => s.gift);
	const dismiss = usePluginNotifyStore((s) => s.dismissGift);
	const [busy, setBusy] = useState("");

	useEffect(() => {
		void gift;
		setBusy("");
	}, [gift]);

	if (!gift || gift.length === 0) return null;

	const heading = gift.length === 1 ? gift[0]?.title || "赠送活动" : "赠送活动";
	const single = gift.length === 1;

	const claim = (id: string) => {
		if (busy || !id) return;
		setBusy(id);
		void getPi()
			.pluginCommand({ cmd: `gift-claim:${id}` })
			.catch(() => undefined);

		window.setTimeout(() => setBusy((b) => (b === id ? "" : b)), 8000);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30" role="dialog" aria-modal>
			<div className="relative flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-dialog">
				<button
					type="button"
					aria-label="关闭"
					onClick={dismiss}
					className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink"
				>
					<CloseIcon size={11} />
				</button>
				<div className="pr-8 text-[15px] font-semibold text-ink">{heading}</div>
				<div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
					{gift.map((g) => (
						<div key={g.id} className="flex flex-col gap-1.5">
							{single ? null : (
								<div className="text-[14px] font-medium text-ink">{g.title || "赠送活动"}</div>
							)}
							{g.content ? (
								<div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{g.content}</div>
							) : null}
							<div className="flex items-center justify-between gap-3">
								{g.meta ? <span className="text-[12px] text-ink-faint">{g.meta}</span> : null}
								<button
									type="button"
									onClick={() => claim(g.id)}
									disabled={busy === g.id}
									className="rounded-lg bg-ink px-4 py-1.5 text-[13px] text-surface disabled:opacity-60"
								>
									{busy === g.id ? "领取中…" : "领取"}
								</button>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
