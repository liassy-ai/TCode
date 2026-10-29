import {
	MermaidBlockNode,
	type MermaidBlockNodeProps,
	setCustomComponents,
	setDefaultI18nMap,
} from "markstream-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { chatLanguage, type Language, translate, useI18nStore, useT } from "../../i18n";
import { ChevronRightIcon, CopyIcon, ErrorCircleIcon } from "../icons";
import { CodeBlockShiki } from "./CodeBlockShiki";

const MERMAID_PROPS = {
	isStrict: false,
	showHeader: true,
	showModeToggle: true,
	showCopyButton: true,
	showFullscreenButton: true,
	showCollapseButton: false,
	showExportButton: false,
	showZoomControls: false,
	enableWheelZoom: false,
} as const;

const VALIDATE_DELAY_MS = 400;

interface MermaidModule {
	parse?: (code: string) => Promise<unknown> | unknown;
}

function normalizeMermaidSource(code: string): string {
	return code.replace(/\]::([^:])/g, "]:::$1").replace(/:::subgraphNode$/gm, "::subgraphNode");
}

function firstLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return String((error as { message?: unknown })?.message ?? error);
}

async function validate(code: string): Promise<string | null> {
	try {
		const mod = (await import("mermaid")) as { default?: MermaidModule } & MermaidModule;
		const api = mod.default ?? mod;

		if (typeof api?.parse !== "function") return null;
		await api.parse(normalizeMermaidSource(code));
		return null;
	} catch (error) {
		return firstLine(errorText(error));
	}
}

function syncMarkstreamI18n(language: Language): void {
	const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
	setDefaultI18nMap({
		"common.copy": t("mermaid.copy"),
		"common.copied": t("mermaid.copied"),
		"common.preview": t("mermaid.preview"),
		"common.source": t("mermaid.source"),
		"common.export": t("mermaid.export"),
		"common.open": t("mermaid.open"),
		"common.close": t("mermaid.close"),
		"common.expand": t("mermaid.expand"),
		"common.collapse": t("mermaid.collapse"),
		"common.zoomIn": t("mermaid.zoomIn"),
		"common.zoomOut": t("mermaid.zoomOut"),
		"common.resetZoom": t("mermaid.resetZoom"),
		"common.increase": t("mermaid.increase"),
		"common.decrease": t("mermaid.decrease"),
		"common.reset": t("mermaid.reset"),
		"image.loading": t("mermaid.imageLoading"),
		"image.loadError": t("mermaid.imageLoadError"),
	});
}

export function MermaidBlock(props: MermaidBlockNodeProps) {
	const t = useT();
	const code = props.node.code ?? "";
	const streaming = Boolean(props.node.loading);
	const [failure, setFailure] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		setFailure(null);
		setCopied(false);
	}, [code]);

	const handleRenderError = useCallback((error: unknown) => {
		setFailure(firstLine(errorText(error)));
		return true;
	}, []);

	useEffect(() => {
		if (streaming || !code.trim()) return;
		let cancelled = false;
		const timer = window.setTimeout(async () => {
			const reason = await validate(code);
			if (!cancelled && reason) setFailure(reason);
		}, VALIDATE_DELAY_MS);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [code, streaming]);

	const copySource = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1800);
		} catch {}
	};

	return (
		<div
			className="md-mermaid"
			data-failed={failure ? "1" : undefined}
			style={{ "--md-mermaid-rendering": `"${t("mermaid.rendering")}"` } as CSSProperties}
		>
			<MermaidBlockNode {...props} {...MERMAID_PROPS} onRenderError={handleRenderError} />
			{failure && (
				<details className="error-note drawer-details md-mermaid-fail">
					<summary>
						<span className="error-note-sev text-err">
							<ErrorCircleIcon size={14} />
						</span>
						<span className="error-note-title truncate">{t("mermaid.renderFailed")}</span>
						<span className="error-note-meta">{failure}</span>
						<span className="error-note-chev">
							<ChevronRightIcon size={13} />
						</span>
					</summary>
					<div className="drawer-body">
						<div className="error-note-body">
							<pre className="error-note-detail md-mermaid-fail-code">{code}</pre>
							<div className="error-note-actions">
								<button type="button" className="error-note-act" onClick={copySource}>
									<CopyIcon size={12} />
									{t("mermaid.copy")}
								</button>
								<span className={`error-note-copied${copied ? " on" : ""}`}>{t("mermaid.copied")}</span>
							</div>
						</div>
					</div>
				</details>
			)}
		</div>
	);
}

setCustomComponents({ mermaid: MermaidBlock, code_block: CodeBlockShiki });

syncMarkstreamI18n(chatLanguage(useI18nStore.getState().language));
useI18nStore.subscribe((state, prev) => {
	if (state.language !== prev.language) syncMarkstreamI18n(chatLanguage(state.language));
});
