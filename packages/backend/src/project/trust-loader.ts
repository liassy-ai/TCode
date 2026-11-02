import type { InlineExtension, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { DefaultResourceLoader, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../log";
import type { PermissionConfirm, PermissionModeRef } from "../permissions/extension";
import { resolveProjectTrust, type TrustOptionInternal } from "./trust";

const log = createLogger("backend");

export type ExtensionFactoryBuilder = (
	cwd: string,
	confirm: PermissionConfirm | undefined,
	modeRef?: PermissionModeRef,
) => InlineExtension[];

export class ProjectResourceLoader {
	constructor(
		private readonly deps: {
			trustStore: ProjectTrustStore;

			ask: (cwd: string, options: TrustOptionInternal[]) => Promise<number | undefined>;

			canAsk: () => boolean;

			buildExtensions: ExtensionFactoryBuilder;

			projectTrust?: boolean;

			desktopIntegration?: {
				appendSystemPrompt: string[] | (() => string[]);
				additionalSkillPaths: string[];
			};

			warmSkillPrefs?: () => Promise<unknown>;

			getDisabledSkills?: (cwd: string) => ReadonlySet<string>;
		},
	) {}

	async load(
		cwd: string,
		options?: {
			askTrust?: boolean;
			confirm?: PermissionConfirm;
			modeRef?: PermissionModeRef;
		},
	): Promise<{
		settingsManager: SettingsManager;
		resourceLoader: DefaultResourceLoader;
	}> {
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });

		await this.deps.warmSkillPrefs?.();
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			extensionFactories: this.deps.buildExtensions(cwd, options?.confirm, options?.modeRef),
			...(this.deps.getDisabledSkills
				? {
						skillsOverride: (base) => {
							const disabled = this.deps.getDisabledSkills?.(cwd);
							if (!disabled || disabled.size === 0) return base;
							return {
								...base,
								skills: base.skills.map((skill) =>
									disabled.has(skill.name) && !skill.disableModelInvocation
										? { ...skill, disableModelInvocation: true }
										: skill,
								),
							};
						},
					}
				: {}),
			...(this.deps.desktopIntegration
				? {
						appendSystemPrompt:
							typeof this.deps.desktopIntegration.appendSystemPrompt === "function"
								? this.deps.desktopIntegration.appendSystemPrompt()
								: this.deps.desktopIntegration.appendSystemPrompt,
						additionalSkillPaths: this.deps.desktopIntegration.additionalSkillPaths,
					}
				: {}),
		});
		if (this.deps.projectTrust === false) {
			settingsManager.setProjectTrusted(true);
			await resourceLoader.reload();
			return { settingsManager, resourceLoader };
		}
		await resourceLoader.reload({
			resolveProjectTrust: async () => {
				const trusted = await resolveProjectTrust({
					cwd,
					trustStore: this.deps.trustStore,
					defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
					askUser:
						options?.askTrust !== false && this.deps.canAsk()
							? (dir, opts) => this.deps.ask(dir, opts)
							: undefined,
				});
				log.info("project trust resolved", cwd, { trusted });
				return trusted;
			},
		});
		return { settingsManager, resourceLoader };
	}

	async ensureTrust(cwd: string): Promise<boolean> {
		const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false });
		const trusted = await resolveProjectTrust({
			cwd,
			trustStore: this.deps.trustStore,
			defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
			askUser: this.deps.canAsk() ? (dir, o) => this.deps.ask(dir, o) : undefined,
		});
		log.info("project trust ensured", cwd, { trusted });
		return trusted;
	}
}
