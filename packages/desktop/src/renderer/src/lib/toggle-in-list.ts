export function toggleInList(list: readonly string[], id: string): string[] {
	return list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];
}
