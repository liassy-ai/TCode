export const NPM_NOT_FOUND_SENTINEL = "TCODE_NPM_NOT_FOUND";

export type CatalogPackageType = "extension" | "skill" | "prompt" | "theme";

export interface CatalogPackage {
	name: string;
	description: string;
	author: string;

	types: string[];

	downloads: number;

	updatedAt: number;

	installSource: string;
}

export function isSubagentPackage(pkg: Pick<CatalogPackage, "name" | "description">): boolean {
	return /sub-?agent/i.test(`${pkg.name} ${pkg.description}`);
}

export interface CatalogSearchResult {
	packages: CatalogPackage[];

	total: number;
	page: number;
	pageSize: number;
}

export interface ConfiguredPackageInfo {
	source: string;
	scope: "user" | "project";
}
