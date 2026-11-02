import type { ReactNode } from "react";

function inline(text: string, keyPrefix: string): ReactNode[] {
	const out: ReactNode[] = [];
	const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
	let last = 0;
	let match = pattern.exec(text);
	let index = 0;
	while (match) {
		if (match.index > last) out.push(text.slice(last, match.index));
		if (match[1]) {
			out.push(
				<strong key={`${keyPrefix}-b${index}`} className="font-medium text-ink">
					{match[1]}
				</strong>,
			);
		} else if (match[2]) {
			out.push(
				<code key={`${keyPrefix}-c${index}`} className="rounded bg-hover px-1 py-[1px] font-mono text-[12px]">
					{match[2]}
				</code>,
			);
		}
		last = match.index + match[0].length;
		match = pattern.exec(text);
		index += 1;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

export function ReleaseNotes({ text }: { text: string }) {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const blocks: ReactNode[] = [];
	let bullets: string[] = [];
	let key = 0;

	const flushBullets = () => {
		if (bullets.length === 0) return;
		const items = bullets;
		bullets = [];
		key += 1;
		blocks.push(
			<ul key={`ul${key}`} className="my-1.5 flex flex-col gap-1">
				{items.map((item, i) => (
					<li key={`li${key}-${item}`} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
						<span aria-hidden="true" className="mt-[8px] size-[3px] shrink-0 rounded-full bg-ink-faint" />
						<span className="min-w-0 flex-1">{inline(item, `li${key}-${i}`)}</span>
					</li>
				))}
			</ul>,
		);
	};

	for (const raw of lines) {
		const line = raw.trimEnd();
		const trimmed = line.trim();
		if (!trimmed) {
			flushBullets();
			continue;
		}
		const heading = trimmed.match(/^#{1,6}\s+(.*)$/);
		if (heading) {
			flushBullets();
			key += 1;
			blocks.push(
				<div key={`h${key}`} className="mt-3.5 mb-1.5 text-[14px] font-semibold text-ink first:mt-0">
					{inline(heading[1] ?? "", `h${key}`)}
				</div>,
			);
			continue;
		}
		const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
		if (bullet) {
			bullets.push(bullet[1] ?? "");
			continue;
		}
		flushBullets();
		key += 1;
		blocks.push(
			<p key={`p${key}`} className="my-1.5 text-[13px] leading-relaxed text-ink-2">
				{inline(trimmed, `p${key}`)}
			</p>,
		);
	}
	flushBullets();

	return <div className="whitespace-pre-wrap">{blocks}</div>;
}
