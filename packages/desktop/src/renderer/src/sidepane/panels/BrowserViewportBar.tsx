import { Check, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Dropdown } from "../../components/ui/Dropdown";
import type { Translate } from "../../i18n";
import { resetBrowserViewport, setBrowserViewport, setDesktopViewport } from "../browser-control-bridge";
import {
	type BrowserViewportOverride,
	DEFAULT_ZOOM_VALUES,
	DESKTOP_FRAME,
	DESKTOP_SIZE_LABEL,
	useBrowserViewportStore,
	type ViewportFrame,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_STEP,
	zoomValueFor,
} from "../browser-viewport";
import { formatPercent, resolveViewportSize, type ViewportSizeDraft } from "../viewport-input";

const INPUT_CLASS =
	"h-6 min-w-0 rounded-md border border-border bg-surface px-1 text-center font-mono text-[14px] tabular-nums text-ink outline-none focus:border-border-strong";

const TRIGGER_CLASS =
	"flex h-6 items-center gap-0.5 rounded-md border border-border bg-surface px-1.5 font-mono text-[14px] tabular-nums text-ink transition-colors hover:border-border-strong";

export function BrowserViewportBar({
	tabId,
	override,
	size,
	setError,
	t,
}: {
	tabId: string;

	override: BrowserViewportOverride | undefined;

	size: { width: number; height: number };

	setError: (message: string) => void;
	t: Translate;
}) {
	const [draft, setDraft] = useState<ViewportSizeDraft | null>(null);

	const [zoomDraft, setZoomDraft] = useState<string | null>(null);
	const frame = useBrowserViewportStore((s) => s.frames[tabId] ?? "auto");
	const zoomValues = useBrowserViewportStore((s) => s.zoomValues[tabId] ?? DEFAULT_ZOOM_VALUES);

	const zoom = zoomValueFor("manual", frame, zoomValues);

	const sizeEditable = frame === DESKTOP_FRAME;

	const shown: ViewportSizeDraft = draft ?? {
		width: size.width > 0 ? String(size.width) : "",
		height: size.height > 0 ? String(size.height) : "",
	};

	const apply = () => {
		if (!draft || !sizeEditable) return;
		setDraft(null);
		setError("");
		const res = setBrowserViewport(tabId, resolveViewportSize(draft, size));
		if (!res.ok) setError(res.error ?? "");
	};

	const reset = () => {
		setDraft(null);
		setError("");

		const res = resetBrowserViewport(tabId);
		if (!res.ok) setError(res.error ?? "");
	};

	const pickDesktopSize = () => {
		setDraft(null);
		setError("");
		const res = setDesktopViewport(tabId);
		if (!res.ok) setError(res.error ?? "");
	};

	const setFrame = (next: ViewportFrame) => {
		useBrowserViewportStore.getState().setFrame(tabId, next);
	};

	const setZoom = (next: number) => {
		setZoomDraft(null);
		useBrowserViewportStore.getState().setZoomValue(tabId, frame, next);
	};

	const pendingZoomPercent = (): number | null => {
		if (zoomDraft === null) return null;
		const percent = Number.parseFloat(zoomDraft.replace(/[%\s]/g, ""));
		return Number.isFinite(percent) ? percent : null;
	};

	const stepZoom = (deltaPercent: number) => {
		const current = pendingZoomPercent() ?? Math.round(zoom * 100);
		setZoom((current + deltaPercent) / 100);
	};

	const commitZoomDraft = () => {
		const percent = pendingZoomPercent();
		if (percent === null) {
			setZoomDraft(null);
			return;
		}
		setZoom(percent / 100);
	};

	const frameLabel = (value: ViewportFrame) =>
		value === "auto" ? t("sidepane.browser.zoomAuto") : t("sidepane.browser.zoomDesktop");

	return (
		<form
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void apply();
					return;
				}
				if (event.key === "Escape") setDraft(null);
			}}
			onSubmit={(event) => {
				event.preventDefault();
				void apply();
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void apply();
			}}
			className="flex items-center gap-1 border-b border-border bg-canvas px-3 py-1 text-[11px] text-ink-dim"
		>
			<span className="flex-none">{t("sidepane.browser.vpLabel")}</span>
			<input
				value={shown.width}
				aria-label={t("sidepane.browser.vpWidth")}
				title={t(sizeEditable ? "sidepane.browser.vpWidth" : "sidepane.browser.vpSizeLocked")}
				inputMode="numeric"
				spellCheck={false}
				readOnly={!sizeEditable}
				className={`${INPUT_CLASS} w-[52px] ${sizeEditable ? "" : "cursor-default opacity-60"}`}
				onChange={(event) => setDraft({ ...shown, width: event.target.value })}
			/>
			<span className="flex-none text-ink-faint">×</span>
			<input
				value={shown.height}
				aria-label={t("sidepane.browser.vpHeight")}
				title={t(sizeEditable ? "sidepane.browser.vpHeight" : "sidepane.browser.vpSizeLocked")}
				inputMode="numeric"
				spellCheck={false}
				readOnly={!sizeEditable}
				className={`${INPUT_CLASS} w-[52px] ${sizeEditable ? "" : "cursor-default opacity-60"}`}
				onChange={(event) => setDraft({ ...shown, height: event.target.value })}
			/>

			<Dropdown
				direction="down"
				align="end"
				menuClassName="w-48"
				triggerClassName={TRIGGER_CLASS}
				trigger={
					<span title={t("sidepane.browser.vpZoom")}>
						{frameLabel(frame)} · {formatPercent(zoom)}%
					</span>
				}
			>
				{(close) => (
					<>
						{(["auto", DESKTOP_FRAME] as ViewportFrame[]).map((value) => {
							const desktop = value === DESKTOP_FRAME;
							return (
								<button
									key={value}
									type="button"
									onClick={() => {
										if (desktop) pickDesktopSize();
										else setFrame(value);
										close();
									}}
									title={
										desktop ? t("sidepane.browser.zoomDesktopHint", { size: DESKTOP_SIZE_LABEL }) : undefined
									}
									className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${
										value === frame ? "text-ink" : "text-ink-2"
									}`}
								>
									<span className="truncate">{frameLabel(value)}</span>
									{desktop && (
										<span className="ml-auto shrink-0 font-mono text-[12px] tabular-nums text-ink-faint">
											{DESKTOP_SIZE_LABEL}
										</span>
									)}
									{value === frame && <Check size={13} className={`shrink-0 ${desktop ? "" : "ml-auto"}`} />}
								</button>
							);
						})}

						<div className="mt-1 flex items-center gap-1 border-t border-border px-2 pt-1.5">
							<span className="flex-none text-[13px] text-ink-2">{t("sidepane.browser.vpZoomLabel")}</span>
							<div className="ml-auto flex items-center gap-1">
								<button
									type="button"
									aria-label={t("sidepane.browser.vpZoomOut")}
									title={t("sidepane.browser.vpZoomOut")}
									disabled={zoom <= ZOOM_MIN}
									onClick={() => stepZoom(-Math.round(ZOOM_STEP * 100))}
									className="rounded-md p-1 text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
								>
									<Minus size={13} />
								</button>

								<span className="flex items-center">
									<input
										value={zoomDraft ?? String(Math.round(zoom * 100))}
										aria-label={t("sidepane.browser.vpZoomInput")}
										title={t("sidepane.browser.vpZoomRange", {
											min: Math.round(ZOOM_MIN * 100),
											max: Math.round(ZOOM_MAX * 100),
										})}
										inputMode="numeric"
										spellCheck={false}
										onFocus={(event) => event.currentTarget.select()}
										onKeyDown={(event) => {
											if (event.key !== "Enter" && event.key !== "Escape") return;
											event.preventDefault();
											event.stopPropagation();
											if (event.key === "Enter") commitZoomDraft();
											else setZoomDraft(null);
										}}
										onChange={(event) => setZoomDraft(event.target.value)}
										onBlur={commitZoomDraft}
										className={`${INPUT_CLASS} w-[52px]`}
									/>
									<span className="flex-none text-ink-faint">%</span>
								</span>
								<button
									type="button"
									aria-label={t("sidepane.browser.vpZoomIn")}
									title={t("sidepane.browser.vpZoomIn")}
									disabled={zoom >= ZOOM_MAX}
									onClick={() => stepZoom(Math.round(ZOOM_STEP * 100))}
									className="rounded-md p-1 text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
								>
									<Plus size={13} />
								</button>
							</div>
						</div>
					</>
				)}
			</Dropdown>

			{override && sizeEditable && (
				<>
					<span className="min-w-0 flex-1 truncate text-right">
						{override.source === "user"
							? t("sidepane.browser.viewportUser")
							: t("sidepane.browser.viewportOverride")}
					</span>
					<button
						type="button"
						onClick={reset}
						title={t("sidepane.browser.viewportResetHint")}
						className="flex-none rounded-md border border-border px-1.5 py-0.5 text-ink hover:border-border-strong"
					>
						{t("sidepane.browser.viewportReset")}
					</button>
				</>
			)}
		</form>
	);
}
