import type { SlashCommandInfo } from "@tcode/shared";
import { type RefObject, useEffect, useState } from "react";
import { getPi } from "../../api";
import { useT } from "../../i18n";
import { extractSlashToken, filterCommands, removeSlashToken, type SlashToken } from "./slash-filter";

export interface UseSlashMenuOptions {
	activeSessionId: string | null;
	cwd: string | null;

	trustVersion: number;
	text: string;
	slashCommand: string | null;
	setText: (updater: string | ((prev: string) => string)) => void;
	setSlashCommand: (command: string | null) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	ensureSession: () => Promise<string | null>;
	runSlashCommand: (content: string, sessionId: string) => Promise<boolean>;
	handleSend: () => Promise<void>;
	showFeedback: (message: string, tone?: "info" | "warn") => void;
	setError: (error: string | null) => void;
}

export function useSlashMenu(options: UseSlashMenuOptions) {
	const t = useT();
	const [slashSelected, setSlashSelected] = useState(0);
	const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);

	const [slashDismissed, setSlashDismissed] = useState(false);

	const [slashToken, setSlashToken] = useState<SlashToken | null>(null);

	const { activeSessionId, cwd, trustVersion, text } = options;

	const updateToken = (value: string, cursor: number) => {
		setSlashToken(options.slashCommand ? null : extractSlashToken(value, cursor));
	};

	const slashOpen =
		slashToken !== null &&
		!options.slashCommand &&
		text.slice(slashToken.start, slashToken.end) === `/${slashToken.query}` &&
		!slashDismissed;
	const slashQuery = slashOpen ? slashToken.query : "";

	useEffect(() => {
		const request = activeSessionId
			? getPi().listSlashCommands({ sessionId: activeSessionId })
			: cwd
				? getPi().listSlashCommandsForCwd({ cwd })
				: null;
		if (!request) {
			setSlashCommands([]);
			return;
		}
		let cancelled = false;
		void request
			.then((list) => {
				if (!cancelled) setSlashCommands(list);
			})
			.catch(() => {
				if (!cancelled) setSlashCommands([]);
			});
		return () => {
			cancelled = true;
		};
	}, [activeSessionId, cwd, trustVersion]);

	useEffect(() => {
		setSlashSelected(0);
	}, [slashQuery]);

	const confirmCommand = async (command: SlashCommandInfo, { allowInline = true } = {}) => {
		if (!command.supported) return;
		const token = slashToken;
		const standaloneInline =
			allowInline &&
			token !== null &&
			token.start === 0 &&
			text.slice(token.end).trim() === "" &&
			command.source === "builtin" &&
			new Set(["compact", "settings"]).has(command.name);
		if (standaloneInline) {
			const sessionId = await options.ensureSession();
			if (!sessionId) {
				options.showFeedback(t("slash.feedback.noSession"), "warn");
				return;
			}
			options.setText("");
			setSlashToken(null);
			try {
				await options.runSlashCommand(`/${command.name}`, sessionId);
			} catch (err) {
				options.setError(err instanceof Error ? err.message : String(err));
			}
			return;
		}
		options.setSlashCommand(command.name);
		setSlashToken(null);
		if (token) options.setText(removeSlashToken(text, token));
		setSlashDismissed(true);
		requestAnimationFrame(() => {
			const el = options.textareaRef.current;
			if (el) {
				el.focus();
				const len = el.value.length;
				el.setSelectionRange(len, len);
			}
		});
	};

	const handleSlashPickByIndex = (index: number) => {
		const flat = filterCommands(slashCommands, slashQuery, t);
		const command = flat[Math.min(index, flat.length - 1)] ?? undefined;
		if (command) {
			void confirmCommand(command);
		} else {
			void options.handleSend();
		}
	};

	const handleSlashTabComplete = () => {
		const flat = filterCommands(slashCommands, slashQuery, t);
		const command = flat[Math.min(slashSelected, flat.length - 1)] ?? flat[0];
		if (!command) return;
		void confirmCommand(command, { allowInline: false });
	};

	const restoreSlashPill = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		e.preventDefault();
		const cmd = options.slashCommand;
		options.setSlashCommand(null);
		options.setText((prev) => (cmd ? (prev ? `/${cmd} ${prev}` : `/${cmd} `) : prev));
		setSlashToken(null);
		setSlashDismissed(true);
		requestAnimationFrame(() => {
			const el = options.textareaRef.current;
			if (el) {
				el.focus();
				const len = el.value.length;
				el.setSelectionRange(len, len);
			}
		});
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
		if (!slashOpen) return false;
		if (e.key === "Tab") {
			e.preventDefault();
			handleSlashTabComplete();
			return true;
		}
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSlashSelected((s) => s + 1);
			return true;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setSlashSelected((s) => s - 1);
			return true;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			setSlashDismissed(true);
			return true;
		}
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			handleSlashPickByIndex(slashSelected);
			return true;
		}
		return false;
	};

	return {
		slashCommands,
		slashSelected,
		setSlashSelected,
		slashOpen,
		slashQuery,
		slashDismissed,
		setSlashDismissed,
		updateToken,
		handleSlashPick: (command: SlashCommandInfo) => confirmCommand(command),
		handleSlashPickByIndex,
		restoreSlashPill,
		handleKeyDown,
	};
}
