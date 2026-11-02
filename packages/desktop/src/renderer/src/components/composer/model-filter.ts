import type { AvailableModel } from "@tcode/shared";

export interface ModelGroup {
	name: string;
	items: AvailableModel[];
}

function haystack(model: AvailableModel, groupName: string): string {
	return `${model.label} ${groupName} ${model.provider} ${model.id}`.toLowerCase();
}

export function filterModelGroups(groups: ModelGroup[], query: string): ModelGroup[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return groups;
	const result: ModelGroup[] = [];
	for (const group of groups) {
		const items = group.items.filter((model) => {
			const text = haystack(model, group.name);
			return terms.every((term) => text.includes(term));
		});
		if (items.length > 0) result.push({ name: group.name, items });
	}
	return result;
}
