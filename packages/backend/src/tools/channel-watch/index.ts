export {
	clearChannelWatchEnabledCache,
	readChannelWatchEnabled,
	writeChannelWatchEnabled,
} from "./config";
export type { ChannelWatchOptions } from "./extension";
export { buildWakeMessage, makeChannelWatchExtension } from "./extension";
export { contentHash, LoopGuard } from "./guard";
export {
	AGENT_WORK_REL,
	agentWorkRoot,
	type CheckIgnoreFn,
	channelRoot,
	ensureAgentWorkInit,
	planRoot,
	setCheckIgnoreOverride,
	specRoot,
	topicDir,
	validateTopic,
} from "./init";
export {
	buildSubsPayload,
	type RestoredSubscriptions,
	restoreSubscriptionState,
	restoreSubscriptions,
	SUBSCRIPTION_CUSTOM_TYPE,
	type SubsPayload,
} from "./subscriptions";
export { makeChannelTools } from "./tools";
export { ChannelWatcher, parseWatchFilename } from "./watcher";
