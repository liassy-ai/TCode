export function resolveDroppedFilePaths(
	files: ArrayLike<unknown>,
	getPathForFile: (file: unknown) => string,
): string[] {
	const paths = new Set<string>();
	for (const file of Array.from(files)) {
		try {
			const path = getPathForFile(file);
			if (path.length > 0) paths.add(path);
		} catch {}
	}
	return [...paths];
}
