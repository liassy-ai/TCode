import type { PiBackend } from "@tcode/backend";
import { PACKAGES_CHANNELS } from "@tcode/shared";
import { registerInvokeHandlers } from "./invoke";

export function registerPackagesIpc(backend: PiBackend): void {
	registerInvokeHandlers(PACKAGES_CHANNELS, {
		searchCatalog: ({ query, type, page }) => backend.packages.searchPackages(query, type, page),
		installPackage: ({ name }) => backend.packages.installPackage(name),
		removePackage: ({ source, scope }) => backend.packages.removePackage(source, scope),
		listConfiguredPackages: () => backend.packages.listConfiguredPackages(),
	});
}
