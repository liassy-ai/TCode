import type { FileReadResult } from "@tcode/shared";
import { useEffect, useMemo, useState } from "react";
import { getPi } from "../../api";
import { errText } from "../../lib/error-text";
import type { SidePanePanelProps } from "../panelProps";

const MAX_RENDER_LINES = 5000;

export function CodeViewerPanel({ tab, cwd, t }: SidePanePanelProps) {
	const path = tab.payload.path ?? tab.id;
	const [result, setResult] = useState<FileReadResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setResult(null);
		setError(null);
		getPi()
			.readWorkspaceFile({ cwd, path })
			.then((read) => {
				if (!cancelled) setResult(read);
			})
			.catch((err) => {
				if (!cancelled) setError(errText(err) ?? "unknown");
			});
		return () => {
			cancelled = true;
		};
	}, [cwd, path]);

	const lines = useMemo(() => {
		if (!result?.content) return [];
		return result.content.split("\n");
	}, [result]);

	if (error) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-[12px] text-ink-dim">
				<div>{t("sidepane.viewer.loadFailed")}</div>
				<div className="text-ink-faint">{error}</div>
			</div>
		);
	}
	if (!result) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-ink-faint">
				{t("sidepane.viewer.loading")}
			</div>
		);
	}
	if (result.isDirectory) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-ink-dim">
				{t("sidepane.viewer.directory")}
			</div>
		);
	}
	if (result.binary) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-ink-dim">
				{t("sidepane.viewer.binary")}
			</div>
		);
	}
	if (result.content === null) {
		return (
			<div className="flex h-full items-center justify-center text-[12px] text-ink-dim">
				{t("sidepane.viewer.missing")}
			</div>
		);
	}

	const lineOverflow = lines.length > MAX_RENDER_LINES;
	const visible = lineOverflow ? lines.slice(0, MAX_RENDER_LINES) : lines;

	return (
		<div className="flex h-full min-h-0 flex-col bg-surface text-ink">
			<div className="flex min-h-9 items-center gap-2 border-b border-border px-2">
				<span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={path}>
					{`\u200e${path}`}
				</span>
				<span className="shrink-0 text-[11px] text-ink-faint">{t("sidepane.viewer.readOnly")}</span>
			</div>
			<div className="viewer-scroll min-h-0 flex-1 overflow-auto">
				<div className="viewer-table">
					{visible.map((line, index) => (
						<div key={index} className="viewer-line">
							<span className="viewer-no">{index + 1}</span>
							<span className="viewer-code">{line === "" ? " " : line}</span>
						</div>
					))}
				</div>
			</div>
			{(result.truncated || result.invalidUtf8 > 0 || lineOverflow) && (
				<div className="flex flex-col gap-0.5 border-t border-border px-2 py-1.5 text-[11px] text-ink-faint">
					{result.truncated && <span>{t("sidepane.viewer.truncated", { total: result.size })}</span>}
					{lineOverflow && <span>{t("sidepane.viewer.lineOverflow", { shown: MAX_RENDER_LINES })}</span>}
					{result.invalidUtf8 > 0 && <span>{t("sidepane.viewer.notUtf8")}</span>}
				</div>
			)}
		</div>
	);
}
