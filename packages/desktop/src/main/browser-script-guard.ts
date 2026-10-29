const SCRIPT_POINTER_PATTERNS: Array<{ re: RegExp; instead: string }> = [
	{ re: /\.click\s*\(/, instead: "click（selector，命中多个时用 index）" },
	{ re: /\.(?:requestSubmit|submit)\s*\(/, instead: "click 点提交按钮，或 type 带 submit: true" },
	{ re: /dispatchEvent\s*\(/, instead: "click / type / keys" },
	{ re: /new\s+(?:Mouse|Pointer|Wheel|Keyboard|Input)Event/, instead: "click / hover / keys" },
	{ re: /scrollIntoView\s*\(|scrollTo\s*\(|scrollBy\s*\(|scrollTop\s*=/, instead: "scroll（dx / dy）" },
	{ re: /\.value\s*=[^=]/, instead: "type（selector + text）" },
];

export interface ScriptPointerViolation {
	found: string;

	instead: string;
}

export function findScriptPointerViolation(code: string): ScriptPointerViolation | null {
	for (const { re, instead } of SCRIPT_POINTER_PATTERNS) {
		const found = code.match(re)?.[0];
		if (found) return { found, instead };
	}
	return null;
}

export function scriptPointerRejection(violation: ScriptPointerViolation): string {
	return [
		`script 被拒绝：脚本中出现「${violation.found}」，属于页面操作而非读取。`,
		`请改用内置 action：${violation.instead}。`,
		"script 仅用于读取 / 测量页面状态（取值、量尺寸、读样式）。",
	].join("");
}
