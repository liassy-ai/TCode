import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { CloseIcon } from "../icons";
import { Tooltip } from "../ui/Tooltip";

export function AttachmentChip({ path, onRemove }: { path: string; onRemove: () => void }) {
	const t = useT();
	const pathRef = useRef<HTMLSpanElement>(null);
	const [truncated, setTruncated] = useState(false);

	useEffect(() => {
		const el = pathRef.current;
		if (!el) return;
		const check = () => setTruncated(el.scrollWidth > el.clientWidth);
		check();
		const ro = new ResizeObserver(check);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const chip = (
		<span className="mt-0.5 flex max-w-[150px] select-none items-center gap-1 rounded-md bg-surface px-2 py-0.5 font-mono text-[12px] leading-5 text-blue-700 shadow-pop dark:text-blue-300">
			<span aria-hidden="true">@</span>
			<span ref={pathRef} className="min-w-0 truncate" style={{ direction: "rtl", textAlign: "left" }}>
				{path}
			</span>
			<button
				type="button"
				aria-label={t("composer.removeAttachment")}
				onClick={onRemove}
				className="shrink-0 text-blue-400 transition-colors hover:text-blue-600 dark:hover:text-blue-200"
			>
				<CloseIcon size={8} />
			</button>
		</span>
	);
	return truncated ? <Tooltip label={path}>{chip}</Tooltip> : chip;
}
