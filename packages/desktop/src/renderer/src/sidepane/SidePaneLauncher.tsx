import type { SidePaneTabKind } from "@tcode/shared";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { ContextMenu, type ContextMenuItem } from "../components/ui/ContextMenu";
import type { MenuAnchor } from "../components/ui/place-menu";
import { anchorOfElement } from "../components/ui/place-menu";
import { Tooltip } from "../components/ui/Tooltip";
import { useT } from "../i18n";
import { SIDEPANE_OPENERS } from "./openers";
import { SIDEPANE_OPENABLE_KINDS, SIDEPANE_REGISTRY, SidePaneTabIcon } from "./registry";
import { useSidePaneStore } from "./store";

export function SidePaneLauncher({
	mode,
	cwd,
	sessionId,
}: {
	mode: "menu" | "empty";
	cwd: string;
	sessionId?: string | null;
}) {
	const t = useT();
	const openTab = useSidePaneStore((state) => state.openTab);
	const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

	const triggerRef = useRef<HTMLButtonElement | null>(null);

	const launch = (kind: SidePaneTabKind) => {
		const opener = SIDEPANE_OPENERS[kind];
		if (!opener) return;
		const request = opener({ kind, cwd, sessionId: sessionId ?? null, t });
		openTab({
			kind,
			discriminator: request.discriminator,
			title: request.title,
			payload: request.payload,
		});
	};

	const kindItems: ContextMenuItem[] = SIDEPANE_OPENABLE_KINDS.map((kind) => ({
		key: kind,
		label: t(SIDEPANE_REGISTRY[kind].labelKey),
		icon: <SidePaneTabIcon kind={kind} size={13} />,
		onSelect: () => launch(kind),
	}));

	if (mode === "empty") {
		return (
			<div className="sidepane-empty flex h-full min-w-0 overflow-hidden flex-col items-center justify-center gap-4 bg-surface px-6">
				<div className="text-center">
					<div className="text-[13px] font-medium text-ink-2">{t("sidepane.empty.title")}</div>
					<div className="mt-1 text-[12px] leading-relaxed text-ink-dim">{t("sidepane.empty.hint")}</div>
				</div>
				{SIDEPANE_OPENABLE_KINDS.length > 0 ? (
					<div className="grid w-full max-w-80 grid-cols-2 gap-2">
						{SIDEPANE_OPENABLE_KINDS.map((kind) => (
							<button
								key={kind}
								type="button"
								onClick={() => launch(kind)}
								className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-canvas px-3 py-4 text-[12px] text-ink-dim transition-colors hover:border-border-strong hover:bg-hover hover:text-ink motion-reduce:transition-none"
							>
								<SidePaneTabIcon kind={kind} size={16} />
								{t(SIDEPANE_REGISTRY[kind].labelKey)}
							</button>
						))}
					</div>
				) : (
					<div className="max-w-80 text-center text-[12px] leading-relaxed text-ink-faint">
						{t("sidepane.empty.noneAvailable")}
					</div>
				)}
			</div>
		);
	}

	if (SIDEPANE_OPENABLE_KINDS.length === 0) return null;

	return (
		<>
			<Tooltip label={t("sidepane.addTab")} align="center">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={t("sidepane.addTab")}
					onClick={(event) => {
						const el = event.currentTarget;
						triggerRef.current = el;

						setAnchor((prev) => (prev ? null : anchorOfElement(el)));
					}}
					className="no-drag !px-1.5"
				>
					<Plus size={14} />
				</Button>
			</Tooltip>
			{anchor && (
				<ContextMenu
					anchor={anchor}
					items={kindItems}
					ignorePointerDown={triggerRef.current}
					onClose={() => setAnchor(null)}
				/>
			)}
		</>
	);
}
