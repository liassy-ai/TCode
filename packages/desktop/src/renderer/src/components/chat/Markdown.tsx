import MarkdownRender, { type SmoothMarkdownStreamOptions } from "markstream-react";
import "markstream-react/index.css";

import "katex/dist/katex.min.css";
import { type MouseEvent, useRef } from "react";
import { getPi } from "../../api";
import { errText } from "../../lib/error-text";
import { randomUid } from "../../lib/uid";
import { useSidePaneStore } from "../../sidepane/store";
import { useSessionsStore } from "../../stores/sessions";
import { useThemeStore } from "../../stores/theme";
import { pushToast } from "../../stores/toasts";
import { classifyMarkdownLink } from "./markdown-link";

import "./MermaidBlock";

const SMOOTH_OPTIONS: SmoothMarkdownStreamOptions = {
	minCharsPerSecond: 80,

	maxCommitFps: 240,
	maxCharsPerSecond: 240,
	maxCharsPerCommit: 6,
	catchUpThreshold: 1200,
};

const CODE_BLOCK_PROPS = {
	showFontSizeButtons: false,
	showExpandButton: false,
	showPreviewButton: false,
	showCollapseButton: false,
} as const;

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
	const isDark = useThemeStore((s) => s.resolved === "dark");
	const cwd = useSessionsStore((s) => s.cwd);
	const openSidePaneTab = useSidePaneStore((s) => s.openTab);
	const sidePaneReady = useSidePaneStore((s) => s.cwd !== null);
	const onLinkClick = (event: MouseEvent<HTMLDivElement>) => {
		const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (!anchor || !event.currentTarget.contains(anchor)) return;
		const href = anchor.getAttribute("href");
		if (!href) return;
		const link = classifyMarkdownLink(href);
		if (link.kind === "anchor") return;

		event.preventDefault();
		if (link.kind === "unsupported") return;

		if (link.kind === "external" && /^https?:\/\//i.test(link.url) && sidePaneReady) {
			let host = link.url;
			try {
				host = new URL(link.url).hostname;
			} catch {}
			openSidePaneTab({
				kind: "browser",
				discriminator: randomUid(),
				title: host,
				payload: { url: link.url },
			});
			return;
		}
		const operation =
			link.kind === "external"
				? getPi().openExternal({ url: link.url })
				: cwd || link.target.startsWith("/") || link.target.startsWith("~") || /^file:\/\//i.test(link.target)
					? getPi().openPath({ target: link.target, cwd })
					: Promise.reject(new Error("No session working directory for relative link"));
		void operation.catch((error: unknown) => {
			pushToast("error", "toast.pathOpenFailed", errText(error));
		});
	};

	const smoothableRef = useRef<boolean>(Boolean(streaming));
	return (
		<div className="markdown-body text-[15px] leading-[1.75] text-ink select-text" onClick={onLinkClick}>
			<MarkdownRender
				content={text}
				final={!streaming}
				fade={false}
				smoothStreaming={smoothableRef.current}
				smoothStreamingOptions={SMOOTH_OPTIONS}
				isDark={isDark}
				codeBlockLightTheme="vitesse-light"
				codeBlockDarkTheme="vitesse-dark"
				codeBlockProps={CODE_BLOCK_PROPS}
				deferNodesUntilVisible={false}
			/>
		</div>
	);
}
