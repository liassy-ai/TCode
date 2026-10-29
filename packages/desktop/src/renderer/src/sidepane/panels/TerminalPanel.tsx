import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { getPi } from "../../api";
import { errText } from "../../lib/error-text";
import { useThemeStore } from "../../stores/theme";
import type { SidePanePanelProps } from "../panelProps";

const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

interface TerminalTheme {
	background: string;
	foreground: string;
	cursor: string;
	cursorAccent: string;
	selectionBackground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

function readTerminalTheme(dark: boolean): TerminalTheme {
	const styles = getComputedStyle(document.documentElement);
	const token = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
	const bg = token("--color-canvas", dark ? "#0a0a0a" : "#ffffff");
	const fg = token("--color-ink", dark ? "#e4e4e7" : "#18181b");
	const red = token("--color-err", "#dc2626");
	const green = token("--color-ok", "#16a34a");
	const yellow = token("--color-warn", "#ca8a04");
	const blue = "#2563eb";
	const magenta = token("--color-accent", "#7c3aed");
	const cyan = "#0891b2";
	const gray = token("--color-ink-faint", dark ? "#71717a" : "#a1a1aa");
	return {
		background: bg,
		foreground: fg,
		cursor: fg,
		cursorAccent: bg,
		selectionBackground: dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)",
		black: token("--color-ink-2", "#3f3f46"),
		red,
		green,
		yellow,
		blue,
		magenta,
		cyan,
		white: fg,
		brightBlack: gray,
		brightRed: red,
		brightGreen: green,
		brightYellow: yellow,
		brightBlue: blue,
		brightMagenta: magenta,
		brightCyan: cyan,
		brightWhite: token("--color-ink-2", "#e4e4e7"),
	};
}

export function TerminalPanel({ cwd, t }: SidePanePanelProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const ptyIdRef = useRef<string | null>(null);
	const [status, setStatus] = useState<"creating" | "ready" | "closed" | "error">("creating");
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const isDark = useThemeStore((s) => s.resolved === "dark");

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let disposed = false;
		let unsubscribeData = () => {};
		let unsubscribeExit = () => {};

		const terminal = new Terminal({
			theme: readTerminalTheme(useThemeStore.getState().resolved === "dark"),
			fontFamily: MONO_STACK,
			fontSize: 12,
			lineHeight: 1.35,
			cursorBlink: true,
			scrollback: 5000,
		});
		terminalRef.current = terminal;
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(container);
		fit.fit();
		const { cols, rows } = terminal;

		unsubscribeData = getPi().onPtyData((event) => {
			if (event.id === ptyIdRef.current && !disposed) terminal.write(event.data);
		});
		unsubscribeExit = getPi().onPtyExit((event) => {
			if (event.id === ptyIdRef.current && !disposed) {
				setStatus("closed");
			}
		});
		const inputSubscription = terminal.onData((data) => {
			const id = ptyIdRef.current;
			if (id) void getPi().ptyWrite({ id, data });
		});

		const resizeObserver = new ResizeObserver(() => {
			fit.fit();
			const id = ptyIdRef.current;
			if (id) void getPi().ptyResize({ id, cols: terminal.cols, rows: terminal.rows });
		});
		resizeObserver.observe(container);

		void getPi()
			.ptyCreate({ cwd, cols, rows })
			.then(({ id }) => {
				if (disposed) {
					void getPi().ptyKill({ id });
					return;
				}
				ptyIdRef.current = id;
				setStatus("ready");
			})
			.catch((error) => {
				if (disposed) return;
				setStatus("error");
				setErrorMsg(errText(error) ?? "unknown");
			});

		return () => {
			disposed = true;
			inputSubscription.dispose();
			unsubscribeData();
			unsubscribeExit();
			resizeObserver.disconnect();
			const id = ptyIdRef.current;
			if (id) void getPi().ptyKill({ id });
			ptyIdRef.current = null;
			terminal.dispose();
			terminalRef.current = null;
		};
	}, [cwd]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (terminal) terminal.options.theme = readTerminalTheme(isDark);
	}, [isDark]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-canvas">
			<div ref={containerRef} className="sidepane-terminal min-h-0 flex-1 overflow-hidden" />
			{(status === "closed" || status === "error") && (
				<div className="border-t border-border px-3 py-1.5 text-[11px] text-ink-faint">
					{status === "error"
						? `${t("sidepane.terminal.openFailed")} ${errorMsg ?? ""}`
						: t("sidepane.terminal.closed")}
				</div>
			)}
		</div>
	);
}
