import { type PatchHunk, parsePatch } from "@tcode/shared";
import { type CSSProperties, useMemo, useState } from "react";
import { useT } from "../../i18n";

export const DIFF_COLLAPSE_LINES = 120;

export function DiffLine({
	oldNo,
	newNo,
	kind,
	text,
	index,
}: {
	oldNo: number | null;
	newNo: number | null;
	kind: "ctx" | "add" | "del";
	text: string;
	index: number;
}) {
	const sign = kind === "add" ? "+" : kind === "del" ? "−" : " ";
	return (
		<div className={`diff-line diff-line-${kind}`} style={{ "--i": index } as CSSProperties}>
			<span className="diff-g">{oldNo ?? ""}</span>
			<span className="diff-g">{newNo ?? ""}</span>
			<span className="diff-code">
				{sign} {text}
			</span>
		</div>
	);
}

export function PatchView({ patch }: { patch: string }) {
	const t = useT();
	const hunks = useMemo(() => parsePatch(patch), [patch]);
	const [expanded, setExpanded] = useState(false);

	const flat = useMemo(() => {
		const out: ({ type: "hunk"; hunk: PatchHunk } | { type: "line"; hunk: PatchHunk; lineIndex: number })[] =
			[];
		for (const hunk of hunks) {
			out.push({ type: "hunk", hunk });
			hunk.lines.forEach((_, lineIndex) => {
				out.push({ type: "line", hunk, lineIndex });
			});
		}
		return out;
	}, [hunks]);

	const gutters = useMemo(() => {
		let hasOld = false;
		let hasNew = false;
		for (const hunk of hunks) {
			for (const ln of hunk.lines) {
				if (ln.kind !== "add") hasOld = true;
				if (ln.kind !== "del") hasNew = true;
			}
		}
		return hasOld && hasNew ? "both" : hasOld ? "old" : "new";
	}, [hunks]);

	if (hunks.length === 0) {
		return <pre className="diff-fallback">{patch}</pre>;
	}
	const overflow = flat.length - DIFF_COLLAPSE_LINES;
	const visible = !expanded && overflow > 0 ? flat.slice(0, DIFF_COLLAPSE_LINES) : flat;
	return (
		<>
			<div className="diff-table" data-gutters={gutters}>
				{visible.map((entry, i) =>
					entry.type === "hunk" ? (
						<div key={`h${entry.hunk.oldStart}`} className="diff-hunk" style={{ "--i": i } as CSSProperties}>
							{entry.hunk.header}
						</div>
					) : (
						(() => {
							const ln = entry.hunk.lines[entry.lineIndex];
							if (!ln) return null;
							return (
								<DiffLine
									key={`l${ln.oldNo ?? "a"}-${ln.newNo ?? "d"}`}
									oldNo={ln.oldNo}
									newNo={ln.newNo}
									kind={ln.kind}
									text={ln.text}
									index={i}
								/>
							);
						})()
					),
				)}
			</div>
			{!expanded && overflow > 0 && (
				<button type="button" className="diff-more" onClick={() => setExpanded(true)}>
					{t("diff.expandMore", { lines: overflow })}
				</button>
			)}
		</>
	);
}
