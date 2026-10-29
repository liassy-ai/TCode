export type MarkdownLink =
	| { kind: "external"; url: string }
	| { kind: "file"; target: string }
	| { kind: "anchor" }
	| { kind: "unsupported" };

export function classifyMarkdownLink(href: string): MarkdownLink {
	const target = href.trim();
	if (!target) return { kind: "unsupported" };
	if (target.startsWith("#")) return { kind: "anchor" };
	if (/^https?:\/\//i.test(target)) return { kind: "external", url: target };

	if (target.startsWith("//") || (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^file:\/\//i.test(target))) {
		return { kind: "unsupported" };
	}
	return { kind: "file", target };
}
