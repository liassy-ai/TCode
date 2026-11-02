import { useMemo } from "react";
import { useT } from "../../i18n";
import { getDailyDirCached, isDailyCwd } from "../../lib/daily";
import { deriveProjects, useProjectsStore } from "../../stores/projects";
import { useSessionsStore } from "../../stores/sessions";
import { CoffeeIcon } from "../icons";
import { Dropdown } from "../ui/Dropdown";

export function ProjectBranchPicker() {
	const activeSessionId = useSessionsStore((s) => s.activeSessionId);

	if (activeSessionId) return null;
	return (
		<div className="flex items-center justify-center gap-2 text-[13px] text-ink-dim">
			<ProjectPicker />
		</div>
	);
}

function ProjectPicker() {
	const t = useT();
	const cwd = useSessionsStore((s) => s.cwd);
	const pickDirectory = useSessionsStore((s) => s.pickDirectory);
	const setDraftCwd = useSessionsStore((s) => s.setDraftCwd);
	const allSessions = useProjectsStore((s) => s.allSessions);
	const addedProjects = useProjectsStore((s) => s.addedProjects);
	const projects = useMemo(
		() => deriveProjects({ allSessions, addedProjects }),
		[allSessions, addedProjects],
	);
	const name = cwd?.split("/").filter(Boolean).pop();
	const daily = isDailyCwd(cwd);

	const dailyDir = getDailyDirCached();

	return (
		<Dropdown
			trigger={
				<span className="flex items-center gap-1.5">
					{daily ? (
						<span className="flex h-4.5 w-4.5 items-center justify-center rounded border border-border-strong bg-canvas text-ink">
							<CoffeeIcon size={10} />
						</span>
					) : (
						<span className="flex h-4.5 w-4.5 items-center justify-center rounded bg-ink text-[10px] font-semibold text-on-ink">
							{(name?.[0] ?? "P").toUpperCase()}
						</span>
					)}
					{daily ? t("projects.daily") : (name ?? t("projects.selectProject"))}
				</span>
			}
		>
			{(close) => (
				<>
					{dailyDir && (
						<>
							<button
								type="button"
								className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${
									daily ? "text-ink" : "text-ink-2"
								}`}
								onClick={() => {
									setDraftCwd(dailyDir);
									close();
								}}
							>
								<span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border border-border-strong bg-canvas text-ink">
									<CoffeeIcon size={10} />
								</span>
								<span className="truncate">{t("projects.daily")}</span>
							</button>
							{projects.length > 0 && <div className="my-0.5 border-t border-border" />}
						</>
					)}
					{projects.map((project) => (
						<button
							key={project.cwd}
							type="button"
							className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover ${
								project.cwd === cwd ? "text-ink" : "text-ink-2"
							}`}
							onClick={() => {
								setDraftCwd(project.cwd);
								close();
							}}
						>
							<span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-ink-faint text-[10px] font-semibold text-on-ink">
								{(project.name[0] ?? "P").toUpperCase()}
							</span>
							<span className="truncate">{project.name}</span>
						</button>
					))}
					<button
						type="button"
						className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-[13px] text-ink-dim transition-colors hover:bg-hover"
						onClick={() => {
							void pickDirectory();
							close();
						}}
					>
						{t("projects.selectProject")}…
					</button>
				</>
			)}
		</Dropdown>
	);
}
