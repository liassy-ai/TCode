export function buildQuoteBlock(quotes: string[]): string {
	return quotes
		.map((quote) =>
			quote
				.split("\n")
				.map((line) => (line.trim() ? `> ${line}` : ">"))
				.join("\n"),
		)
		.join("\n\n");
}

export function quoteSummary(quote: string, max = 160): string {
	const flat = quote.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
