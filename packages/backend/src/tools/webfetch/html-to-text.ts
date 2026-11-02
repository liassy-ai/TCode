function pickMainRegion(html: string): string {
	let best = "";
	for (const re of [/<main\b[^>]*>[\s\S]*?<\/main>/gi, /<article\b[^>]*>[\s\S]*?<\/article>/gi]) {
		for (const m of html.matchAll(re)) {
			if (m[0].length > best.length) best = m[0];
		}
	}
	return best.length >= 200 ? best : html;
}

export function htmlToText(html: string): string {
	let s = pickMainRegion(html)
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, "")
		.replace(/<(nav|aside|footer|form)[\s\S]*?<\/\1>/gi, "")
		.replace(/<a[^>]*>\s*skip to (?:content|main)[^<]*<\/a>/gi, "")
		.replace(/<pre[\s\S]*?<\/pre>/gi, (block) => {
			const code = block.replace(/<[^>]*>/g, "").trim();
			return code ? `\n\`\`\`\n${code}\n\`\`\`\n` : "";
		})
		.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code: string) => `\`${code.replace(/<[^>]*>/g, "")}\``)
		.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
			const label = text.replace(/<[^>]*>/g, "").trim();
			return label ? `[${label}](${href})` : "";
		})
		.replace(/<h([1-6])[^>]*>/gi, (_, level: string) => `\n${"#".repeat(Number(level))} `)
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(
			/<br\s*\/?>|<hr\s*\/?>|<\/(p|div|li|ul|ol|h[1-6]|table|blockquote|section|article|header|footer|form|dl|dt|dd|details|summary)>/gi,
			"\n",
		)
		.replace(/<[^>]*>/g, "")
		.replace(
			/&lt;|&gt;|&quot;|&apos;|&#(\d+);|&#x([0-9a-f]+);|&amp;|&nbsp;/gi,
			(match, dec: string, hex: string) => {
				switch (match) {
					case "&lt;":
						return "<";
					case "&gt;":
						return ">";
					case "&quot;":
						return '"';
					case "&apos;":
						return "'";
					case "&amp;":
						return "&";
					case "&nbsp;":
						return " ";
					default:
						if (dec) return String.fromCodePoint(Number(dec));
						if (hex) return String.fromCodePoint(parseInt(hex, 16));
						return match;
				}
			},
		);
	s = s
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{2,}/g, "\n")
		.replace(/ {2,}/g, " ")
		.trim();
	return s;
}
