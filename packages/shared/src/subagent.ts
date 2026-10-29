export interface SubagentRunData {
	agent: string;
	task?: string;
	status: "done" | "error";
	model?: string;

	thinkingLevel?: string;

	tokens?: number;

	exitCode?: number;

	artifactsDir?: string;

	sessionFile?: string;

	result?: string;
}

export function isSubagentToolName(name: string): boolean {
	return name === "subagent" || name.startsWith("subagent_");
}

export function extractSubagentRuns(details: unknown): SubagentRunData[] | null {
	const d = details as
		| {
				results?: unknown[];
				completions?: unknown[];
				artifacts?: { dir?: unknown };
		  }
		| null
		| undefined;
	if (!d) return null;
	const runs: SubagentRunData[] = [];
	const artifactsDir = typeof d.artifacts?.dir === "string" ? d.artifacts.dir : undefined;

	const pushRun = (
		agent: unknown,
		rest: {
			task?: unknown;
			model?: unknown;
			thinkingLevel?: unknown;
			exitCode?: unknown;
			error?: unknown;
			sessionFile?: unknown;
			tokens?: unknown;
			content?: unknown;
		},
	) => {
		if (typeof agent !== "string") return;
		const sessionFile = typeof rest.sessionFile === "string" ? rest.sessionFile : undefined;
		const task = typeof rest.task === "string" && rest.task.length > 0 ? rest.task : undefined;
		const exitCode = typeof rest.exitCode === "number" ? rest.exitCode : undefined;
		const error = typeof rest.error === "string" && rest.error.length > 0 ? rest.error : undefined;
		const result = typeof rest.content === "string" && rest.content.length > 0 ? rest.content : undefined;
		runs.push({
			agent,
			result,
			task,
			status: exitCode != null && exitCode !== 0 ? "error" : error ? "error" : "done",
			model: typeof rest.model === "string" ? rest.model : undefined,
			thinkingLevel: typeof rest.thinkingLevel === "string" ? rest.thinkingLevel : undefined,
			tokens: typeof rest.tokens === "number" ? rest.tokens : undefined,
			exitCode,
			artifactsDir,
			sessionFile,
		});
	};

	const completions = Array.isArray(d.completions) ? d.completions : [];
	for (const rawCompletion of completions) {
		const completion = rawCompletion as
			| { agent?: unknown; success?: unknown; results?: unknown[] }
			| undefined;
		if (!completion || !Array.isArray(completion.results)) continue;
		for (const rawChild of completion.results) {
			const child = rawChild as
				| {
						agent?: unknown;
						task?: unknown;
						model?: unknown;
						success?: unknown;
						error?: unknown;
						content?: unknown;
						result?: unknown;
						text?: unknown;
						exitCode?: unknown;
						usage?: {
							totalTokens?: { tokens?: unknown };
							tokens?: unknown;
							input?: unknown;
							output?: unknown;
						};
						artifactPaths?: { jsonlPath?: unknown; outputPath?: unknown };
				  }
				| undefined;
			if (!child) continue;
			const outputPath =
				typeof child.artifactPaths?.outputPath === "string" ? child.artifactPaths.outputPath : undefined;
			const jsonlPath =
				typeof child.artifactPaths?.jsonlPath === "string" ? child.artifactPaths.jsonlPath : undefined;
			const sessionFile = jsonlPath ?? (outputPath?.endsWith(".jsonl") ? outputPath : undefined);

			const content =
				typeof child.content === "string"
					? child.content
					: typeof child.result === "string"
						? child.result
						: typeof child.text === "string"
							? child.text
							: undefined;
			const usage = child.usage;
			const tokenValue =
				usage?.totalTokens?.tokens ??
				usage?.tokens ??
				(typeof usage?.input === "number" && typeof usage?.output === "number"
					? usage.input + usage.output
					: undefined);
			pushRun(child.agent, {
				content,
				task: child.task,
				model: child.model,
				tokens: tokenValue,
				error: child.error,
				exitCode:
					typeof child.exitCode === "number" ? child.exitCode : child.success === false ? 1 : undefined,
				sessionFile,
			});
		}
	}

	const results = Array.isArray(d.results) ? d.results : [];
	for (const raw of results) {
		const r = raw as Record<string, unknown>;
		const agent = typeof r.agent === "string" ? r.agent : undefined;
		const sessionFile = typeof r.sessionFile === "string" ? r.sessionFile : undefined;
		if (!agent && !sessionFile) continue;
		const artifactPaths = r.artifactPaths as { jsonlPath?: unknown } | undefined;
		const usage = r.usage as
			| { totalTokens?: { tokens?: unknown }; tokens?: unknown; input?: unknown; output?: unknown }
			| undefined;
		const progress = r.progressSummary as { tokens?: unknown } | undefined;
		const totalTokens = r.totalTokens as { tokens?: unknown } | undefined;
		const tokenValue =
			usage?.totalTokens?.tokens ??
			usage?.tokens ??
			(typeof usage?.input === "number" && typeof usage?.output === "number"
				? usage.input + usage.output
				: undefined) ??
			progress?.tokens ??
			totalTokens?.tokens;
		const exitCode = typeof r.exitCode === "number" ? r.exitCode : undefined;
		const error = typeof r.error === "string" && r.error.length > 0 ? r.error : undefined;
		pushRun(agent ?? sessionFile ?? "subagent", {
			task: r.task,
			model: r.model,
			content: r.content,
			thinkingLevel: r.thinkingLevel,
			exitCode,
			error,
			sessionFile:
				sessionFile ?? (typeof artifactPaths?.jsonlPath === "string" ? artifactPaths.jsonlPath : undefined),
			tokens: tokenValue,
		});
	}
	return runs.length > 0 ? runs : null;
}
