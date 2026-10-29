import type { TurnFileChange } from "@tcode/shared";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { MoreIcon } from "../icons";
import { FilePathMenu } from "../ui/FilePathMenu";
import { anchorOfElement, type MenuAnchor } from "../ui/place-menu";
import { DIFF_COLLAPSE_LINES, DiffLine, PatchView } from "./PatchView";

function WriteView({ content }: { content: string }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const lines = useMemo(() => content.split("\n"), [content]);
	const overflow = lines.length - DIFF_COLLAPSE_LINES;
	const visible = !expanded && overflow > 0 ? lines.slice(0, DIFF_COLLAPSE_LINES) : lines;
	return (
		<>
			<div className="diff-table" data-gutters="new">
				{visible.map((text, i) => (
					<DiffLine key={i} oldNo={null} newNo={i + 1} kind="add" text={text} index={i} />
				))}
			</div>
			{!expanded && overflow > 0 && (
				<button type="button" className="diff-more" onClick={() => setExpanded(true)}>
					{t("diff.expandMore", { lines: overflow })}
				</button>
			)}
		</>
	);
}

export function DiffFileCard({
	file,
	defaultOpen,
	cwd,
}: {
	file: TurnFileChange;
	defaultOpen: boolean;

	cwd: string | null;
}) {
	const ref = useRef<HTMLDetailsElement>(null);
	const [openCount, setOpenCount] = useState(0);

	const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);

	useEffect(() => {
		if (defaultOpen && ref.current) ref.current.open = true;
	}, []);

	return (
		<details
			ref={ref}
			className="diff-file-card drawer-details"
			data-section-key={file.sections[0]?.toolCallKey}
			onToggle={(e) => {
				if (e.currentTarget.open) setOpenCount((c) => c + 1);
			}}
		>
			<summary
				className="diff-file-head [&::-webkit-details-marker]:hidden"
				onContextMenu={(e) => {
					e.preventDefault();
					setMenuAnchor(anchorOfElement(e.currentTarget));
				}}
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					className="diff-file-icon"
					aria-hidden="true"
				>
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
					<path d="M14 2v6h6" />
				</svg>
				<span className="diff-file-path" title={file.path}>
					{`\u200e${file.path}`}
				</span>
				<span className="turn-diff-stat">
					<span className="turn-diff-added">+{file.added}</span>{" "}
					<span className="turn-diff-removed">−{file.removed}</span>
				</span>

				<span
					className="diff-file-more"
					aria-hidden="true"
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						setMenuAnchor(anchorOfElement(e.currentTarget));
					}}
				>
					<MoreIcon />
				</span>
				<span className="diff-file-chev" aria-hidden="true">
					<svg
						width="11"
						height="11"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="m9 6 6 6-6 6" />
					</svg>
				</span>
			</summary>
			<div className="drawer-body">
				<div className="diff-card-body" key={openCount}>
					{file.sections.map((sec, i) => (
						<Fragment key={sec.toolCallKey}>
							{i > 0 && <div className="diff-section-sep" aria-hidden="true" />}
							{sec.kind === "edit" && sec.patch ? (
								<PatchView patch={sec.patch} />
							) : (
								<WriteView content={sec.content ?? ""} />
							)}
						</Fragment>
					))}
				</div>
			</div>
			{menuAnchor && (
				<FilePathMenu target={file.path} cwd={cwd} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />
			)}
		</details>
	);
}
