type SdkThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export function toSdkThinkingLevel(level: string | undefined): SdkThinkingLevel | undefined {
	if (!level) return undefined;
	return (level === "none" ? "off" : level) as SdkThinkingLevel;
}
