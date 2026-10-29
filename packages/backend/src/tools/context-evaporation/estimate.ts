export const IMAGE_FULL_TOKENS = 1000;
export const IMAGE_STUB_TOKENS = 25;

export function isCJKCode(cp: number): boolean {
	return (
		(cp >= 0x1100 && cp <= 0x11ff) ||
		(cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xa960 && cp <= 0xa97f) ||
		(cp >= 0xac00 && cp <= 0xd7ff) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xfffd)
	);
}

export function estTokens(s: string): number {
	if (!s) return 0;
	let cjk = 0;
	for (let i = 0; i < s.length; i++) {
		if (isCJKCode(s.charCodeAt(i))) cjk++;
	}
	return Math.ceil(cjk * 1.7 + (s.length - cjk) / 4);
}
