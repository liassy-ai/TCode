import type { SubagentInfo } from "@tcode/shared";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../../stores/settings";
import { type AtToken, extractAtToken } from "./at-files";

export interface UseAtCompletionOptions {
	cwd: string | null;
	text: string;
	attachments: string[];
	slashOpen: boolean;
	setText: (updater: string | ((prev: string) => string)) => void;
	setAttachments: (updater: string[] | ((prev: string[]) => string[])) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
}

function filterAgents(agents: SubagentInfo[], query: string): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return agents.map((agent) => agent.name);
	const byName: string[] = [];
	const byDescription: string[] = [];
	for (const agent of agents) {
		if (agent.name.toLowerCase().includes(q)) byName.push(agent.name);
		else if (agent.description.toLowerCase().includes(q)) byDescription.push(agent.name);
	}
	return [...byName, ...byDescription];
}

export function useAtCompletion(options: UseAtCompletionOptions) {
	const { text, slashOpen, attachments } = options;

	const agents = useSettingsStore((s) => s.subagents);
	const [atToken, setAtToken] = useState<AtToken | null>(null);
	const [atSelected, setAtSelected] = useState(0);
	const [atDismissed, setAtDismissed] = useState(false);

	const atOpen =
		atToken !== null &&
		text.slice(atToken.start, atToken.end) === `@${atToken.query}` &&
		!atDismissed &&
		!slashOpen;
	const atFiltered = atOpen && atToken ? filterAgents(agents, atToken.query) : [];

	const lastRefreshRef = useRef(0);
	const menuOpen = atToken !== null;
	useEffect(() => {
		if (!menuOpen) return;
		const now = Date.now();
		if (now - lastRefreshRef.current < 3000) return;
		lastRefreshRef.current = now;
		void useSettingsStore
			.getState()
			.refreshSubagents()
			.catch(() => {});
	}, [menuOpen]);

	useEffect(() => {
		setAtSelected(0);
	}, [atToken?.query]);

	const updateToken = (value: string, cursor: number) => {
		setAtToken(extractAtToken(value, cursor));
	};

	const handleAtPick = (name: string) => {
		if (!atToken) return;
		const before = text.slice(0, atToken.start);
		const after = text.slice(atToken.end);
		const insert = `@${name} `;

		const joined =
			insert.endsWith(" ") && after.startsWith(" ")
				? before + insert + after.slice(1)
				: before + insert + after;
		options.setText(joined);
		setAtToken(null);
		const cursor = before.length + insert.length;
		requestAnimationFrame(() => {
			const el = options.textareaRef.current;
			if (el) {
				el.focus();
				el.setSelectionRange(cursor, cursor);
			}
		});
	};

	const handleAttachmentRemove = (index: number) => {
		const path = attachments[index];
		if (!path) return;
		options.setAttachments((prev) => prev.filter((_, i) => i !== index));
		options.setText((prev) => (prev ? `${prev} @${path} ` : `@${path} `));
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
		if (!atOpen || !atToken) return false;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setAtSelected((s) => s + 1);
			return true;
		}
		if (e.key === "ArrowUp") {
			e.preventDefault();
			setAtSelected((s) => s - 1);
			return true;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			setAtDismissed(true);
			return true;
		}
		if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing)) {
			e.preventDefault();
			const name = atFiltered[Math.min(atSelected, atFiltered.length - 1)];
			if (name) handleAtPick(name);
			return true;
		}
		return false;
	};

	return {
		atToken,
		atOpen,
		atFiltered,
		atSelected,
		setAtSelected,
		setAtDismissed,
		updateToken,
		handleAtPick,
		handleAttachmentRemove,
		handleKeyDown,
	};
}
