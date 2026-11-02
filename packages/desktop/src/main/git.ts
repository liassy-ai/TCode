import { runComponentGit } from "./component-bridge";

function runGit(args: string[], cwd: string, timeout: number): Promise<string> {
	return runComponentGit(["--no-pager", "-c", "core.hooksPath=", ...args], cwd, { timeoutMs: timeout }).then(
		({ stdout, stderr, code }) => {
			if (code !== 0) {
				throw new Error(stderr?.trim() || `git 执行失败（退出码 ${code}）`);
			}
			return stdout;
		},
	);
}

export async function getGitBranch(cwd: string): Promise<string | null> {
	try {
		return (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd, 3000)).trim() || null;
	} catch {
		return null;
	}
}

export async function listGitBranches(
	cwd: string,
): Promise<{ current: string | null; branches: string[]; gitMissing?: boolean }> {
	try {
		const out = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], cwd, 5000);
		const branches = out
			.split("\n")
			.map((b) => b.trim())
			.filter(Boolean);
		return { current: await getGitBranch(cwd), branches };
	} catch {
		return { current: null, branches: [], gitMissing: true };
	}
}

export async function checkoutBranch(cwd: string, branch: string): Promise<string> {
	try {
		await runGit(["checkout", branch], cwd, 15000);
	} catch (err) {
		throw new Error(err instanceof Error ? err.message : String(err));
	}
	return (await getGitBranch(cwd)) ?? branch;
}
