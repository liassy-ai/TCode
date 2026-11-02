import type { SessionMeta } from "@tcode/shared";
import { useState } from "react";
import { useT } from "../../i18n";
import { isDailyCwd } from "../../lib/daily";
import { useListShift } from "../../lib/use-list-shift";
import { useWorkspaceRemoval } from "../../lib/workspace-actions";
import { useProjectsStore } from "../../stores/projects";
import { resolveWorkspaceSessions, useSessionWorkspaceStore } from "../../stores/session-workspace";
import { useSessionsStore } from "../../stores/sessions";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { CloseIcon, CoffeeIcon, PinIcon } from "../icons";
import {
	type SessionStatus,
	sessionLetter,
	sessionProjectDir,
	sessionTitle,
	useSessionStatus,
} from "./session-status";

export function SessionRail() {
	const enabled = useUiPreferencesStore((s) => s.sessionRailEnabled);
	const members = useSessionWorkspaceStore((s) => s.members);
	const sessions = useSessionsStore((s) => s.sessions);
	const allSessions = useProjectsStore((s) => s.allSessions);
	if (!enabled || members.length === 0) return null;
	return <SessionRailInner members={members} sessions={sessions} allSessions={allSessions} />;
}

function railItemElement(sessionId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-rail-session-id="${sessionId}"]`);
}

function SessionRailInner({
	members,
	sessions,
	allSessions,
}: {
	members: ReturnType<typeof useSessionWorkspaceStore.getState>["members"];
	sessions: readonly SessionMeta[];
	allSessions: readonly SessionMeta[];
}) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);
	const openSession = useProjectsStore((s) => s.openSession);
	const removeFromWorkspace = useWorkspaceRemoval();
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const listShiftRef = useListShift();

	const items = resolveWorkspaceSessions(members, sessions, allSessions);
	const expandedIndex = items.findIndex((s) => s.sessionId === expandedId);

	const removeAt = (session: SessionMeta, index: number) => {
		const member = members.find((m) => m.sessionId === session.sessionId);
		if (!member) return;
		const remaining = items.filter((s) => s.sessionId !== session.sessionId);
		const focusIndex = Math.max(0, Math.min(index, remaining.length - 1));
		const nextId = remaining[focusIndex]?.sessionId ?? null;
		removeFromWorkspace(member);
		if (nextId) requestAnimationFrame(() => railItemElement(nextId)?.focus());
	};

	return (
		<nav className="pointer-events-none absolute inset-y-0 left-0 z-30" aria-label={t("rail.ariaLabel")}>
			<div ref={listShiftRef} className="h-full w-[288px] overflow-y-auto overflow-x-hidden">
				<div className="flex min-h-full flex-col justify-center py-6">
					{items.map((session, index) => (
						<RailItem
							key={session.sessionId}
							session={session}
							isActive={session.sessionId === activeSessionId}
							distance={expandedIndex === -1 ? null : Math.abs(index - expandedIndex)}
							onExpand={() => setExpandedId(session.sessionId)}
							onCollapse={() => setExpandedId((prev) => (prev === session.sessionId ? null : prev))}
							onSelect={() => void openSession(session)}
							onRemove={() => removeAt(session, index)}
							onMoveFocus={(delta) => {
								const next = items[Math.min(items.length - 1, Math.max(0, index + delta))]?.sessionId;
								if (next) railItemElement(next)?.focus();
							}}
						/>
					))}
				</div>
			</div>
		</nav>
	);
}

function RailItem({
	session,
	isActive,
	distance,
	onExpand,
	onCollapse,
	onSelect,
	onRemove,
	onMoveFocus,
}: {
	session: SessionMeta;
	isActive: boolean;

	distance: number | null;
	onExpand: () => void;
	onCollapse: () => void;
	onSelect: () => void;
	onRemove: () => void;

	onMoveFocus: (delta: 1 | -1) => void;
}) {
	const t = useT();
	const status = useSessionStatus(session.sessionId);

	const pinned = useUiPreferencesStore((s) => s.pinnedSessions.includes(session.sessionId));
	const title = sessionTitle(session, t("tabbar.untitled"), t("projects.daily"));
	const dir = sessionProjectDir(session);

	const daily = isDailyCwd(session.cwd);
	const stateClass =
		distance === 0 ? "is-expanded" : distance === 1 ? "is-near-1" : distance === 2 ? "is-near-2" : "";
	return (
		<button
			type="button"
			data-rail-session-id={session.sessionId}
			data-shift-key={session.sessionId}
			className={`session-rail-item pointer-events-auto relative h-4 w-6 shrink-0 outline-none ${stateClass}`}
			onMouseEnter={onExpand}
			onMouseLeave={onCollapse}
			onFocus={onExpand}
			onBlur={onCollapse}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					onMoveFocus(e.key === "ArrowDown" ? 1 : -1);
					return;
				}
				if (e.key !== "Delete" && e.key !== "Backspace") return;
				e.preventDefault();
				e.stopPropagation();
				onRemove();
			}}
			aria-keyshortcuts="ArrowUp ArrowDown Delete Backspace"
			aria-label={dir && dir !== title ? `${title}（${dir}）` : title}
			aria-pressed={isActive}
		>
			<span className={`rail-capsule h-[2px] ${railLineClass(status, isActive)}`} aria-hidden="true">
				<span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
					{pinned && (
						<span className="flex shrink-0 text-ink-faint" aria-hidden="true">
							<PinIcon size={11} />
						</span>
					)}
					<span
						className={`relative flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${
							daily && status !== "attention" && status !== "working"
								? "border border-border-strong bg-canvas text-ink"
								: railAvatarClass(status, isActive)
						}`}
					>
						{daily ? <CoffeeIcon size={10} /> : sessionLetter(session).toUpperCase()}
						{status === "done" && (
							<span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-green-500 ring-1 ring-surface" />
						)}
					</span>
					<span className="min-w-0 flex-1 truncate text-left text-sm text-ink">{title}</span>

					<span
						className="rail-close flex h-4 shrink-0 items-center justify-center overflow-hidden rounded text-ink-dim hover:text-ink"
						aria-hidden="true"
						title={t("tabbar.removeFromWorkspace")}
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
					>
						<CloseIcon />
					</span>
				</span>
			</span>
		</button>
	);
}

function railLineClass(status: SessionStatus, isActive: boolean): string {
	if (status === "attention") return "w-4 bg-amber-500";
	if (status === "working") return "w-4 bg-ink rail-working";
	if (status === "done") return "w-4 bg-green-500";
	return isActive ? "w-5 bg-ink" : "w-3 bg-ink-faint";
}

function railAvatarClass(status: SessionStatus, isActive: boolean): string {
	if (status === "attention") return "bg-amber-500 text-on-ink";
	if (status === "working") return "bg-ink text-on-ink tab-avatar-working";
	return isActive ? "bg-ink text-on-ink" : "bg-ink-faint text-on-ink";
}
