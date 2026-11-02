import type { PermissionMode } from "@tcode/shared";
import { useEffect, useRef, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import { useSessionsStore } from "../../stores/sessions";
import { useSettingsStore } from "../../stores/settings";
import { CheckIcon, EyeIcon, ShieldIcon, WarningIcon } from "../icons";
import { Tooltip } from "../ui/Tooltip";

const MODES: PermissionMode[] = ["viewOnly", "default", "fullAccess"];

const MODE_META: Record<
	PermissionMode,
	{ chip: MessageKey; title: MessageKey; desc: MessageKey; Icon: typeof ShieldIcon }
> = {
	default: {
		chip: "composer.permissionDefault",
		title: "composer.permissionDefaultTitle",
		desc: "composer.permissionDefaultDesc",
		Icon: ShieldIcon,
	},
	viewOnly: {
		chip: "composer.permissionViewOnly",
		title: "composer.permissionViewOnlyTitle",
		desc: "composer.permissionViewOnlyDesc",
		Icon: EyeIcon,
	},
	fullAccess: {
		chip: "composer.permissionFullAccess",
		title: "composer.permissionFullAccessTitle",
		desc: "composer.permissionFullAccessDesc",
		Icon: WarningIcon,
	},
};

export function PermissionPicker({ compact = false }: { compact?: boolean }) {
	const t = useT();
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);

	const mode = useSessionsStore((s) =>
		s.activeSessionId === null
			? (s.newSessionDraft?.permissionMode ?? "default")
			: (s.permissionModes[s.activeSessionId] ?? "default"),
	);
	const setSessionPermissionMode = useSessionsStore((s) => s.setSessionPermissionMode);
	const setDraftPermissionMode = useSessionsStore((s) => s.setDraftPermissionMode);
	const gateOff = useSettingsStore((s) => s.permissionGateOff);
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const ChipIcon = MODE_META[mode].Icon;
	const chip = (
		<button
			type="button"
			className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors hover:bg-hover ${
				mode === "fullAccess" ? "text-warn hover:text-warn" : "text-ink-dim hover:text-ink"
			} ${gateOff ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
			aria-label={t("composer.permissionMode")}
			disabled={gateOff === true}
			onClick={() => setOpen((v) => !v)}
		>
			{ChipIcon ? <ChipIcon size={12} /> : null}
			<span data-compact-piece="perm" className={compact ? "absolute invisible" : undefined}>
				{t(MODE_META[mode].chip)}
			</span>
		</button>
	);

	return (
		<div ref={ref} className="relative">
			{gateOff === true ? (
				<Tooltip label={t("composer.permissionGateOff")} align="end">
					{chip}
				</Tooltip>
			) : (
				chip
			)}
			{open && !gateOff && (
				<div
					data-composer-overlay=""
					className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-xl bg-surface p-1 shadow-pop"
				>
					{MODES.map((m) => {
						const selected = mode === m;
						const ItemIcon = MODE_META[m].Icon;
						return (
							<button
								key={m}
								type="button"
								className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
									selected ? "text-ink" : "text-ink-2 hover:bg-hover"
								}`}
								onClick={() => {
									if (activeSessionId) void setSessionPermissionMode(activeSessionId, m);
									else setDraftPermissionMode(m);
									setOpen(false);
								}}
							>
								{ItemIcon ? (
									<ItemIcon
										size={13}
										className={`mt-0.5 shrink-0 ${m === "fullAccess" ? "text-warn" : "text-ink-dim"}`}
									/>
								) : null}
								<span className="min-w-0 flex-1">
									<span className="block text-xs font-medium">{t(MODE_META[m].title)}</span>
									<span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
										{t(MODE_META[m].desc)}
									</span>
								</span>
								{selected && <CheckIcon size={12} className="mt-1 shrink-0" />}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
