import { formatSkillCommand, parseExpandedSkillInvocation } from "@tcode/shared";
import { parseAnnotationCommand, splitAnnotationMessage } from "../../sidepane/panels/browserAnnotate";

export function collapsedQueuedText(raw: string): string {
	const invocation = parseExpandedSkillInvocation(raw);
	return invocation ? formatSkillCommand(invocation) : raw;
}

export function queuedPreview(raw: string, annotationLabel: string): string {
	const command = collapsedQueuedText(raw);
	const annotation = parseAnnotationCommand(command);
	if (annotation) return annotation.note ? `${annotationLabel} · ${annotation.note}` : annotationLabel;
	return command;
}

export function queuedIsAnnotation(raw: string): boolean {
	return parseAnnotationCommand(collapsedQueuedText(raw)) !== null;
}

export function splitQueuedForDraft(raws: string[]): { text: string; commands: string[] } {
	const commands: string[] = [];
	const texts: string[] = [];
	for (const raw of raws) {
		for (const segment of splitAnnotationMessage(collapsedQueuedText(raw))) {
			if (segment.kind === "card") commands.push(segment.command);
			else if (segment.text.trim()) texts.push(segment.text.trim());
		}
	}
	return { text: texts.join("\n"), commands };
}
