import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../../log";
import { readChannelWatchEnabled } from "./config";
import { contentHash, LoopGuard } from "./guard";
import { channelRoot, ensureAgentWorkInit, topicDir, validateTopic } from "./init";
import { appendPost, MESSAGES_FILE } from "./post";
import { buildSubsPayload, restoreSubscriptionState, SUBSCRIPTION_CUSTOM_TYPE } from "./subscriptions";
import { makeChannelTools } from "./tools";
import { type ChannelWatchEvent, ChannelWatcher, type ChannelWatcherOptions } from "./watcher";

const log = createLogger("channel-watch");

export function buildWakeMessage(topic: string, at: Date = new Date()): string {
	const p = (n: number): string => String(n).padStart(2, "0");
	return `[channel:${topic}] 有新消息（${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}），请读 .local/agent-work/channel/${topic}/MESSAGES.md 查收。`;
}

export interface ChannelWatchOptions {
	agentDir: string;

	cwd: string;

	isEnabled?: () => boolean;

	now?: () => number;

	sendWake?: (text: string) => void;

	waitForHistoryReady?: (sessionId: string) => Promise<boolean>;

	onSessionCleanup?: (cleanup: () => void) => void;

	isSessionAlive?: (sessionId: string) => boolean;

	notify?: (text: string) => void;

	onSubscriptionsChanged?: (sessionId: string, topics: ReadonlySet<string>) => void;

	watcherFactory?: (options: ChannelWatcherOptions) => ChannelWatcher;

	readFileHash?: (absPath: string) => Promise<string | null>;
}

async function defaultReadFileHash(absPath: string): Promise<string | null> {
	try {
		return contentHash(await readFile(absPath, "utf8"));
	} catch {
		return null;
	}
}

export function makeChannelWatchExtension(options: ChannelWatchOptions): InlineExtension {
	return {
		name: "channel-watch",
		factory: (pi) => {
			const enabled = options.isEnabled ?? (() => readChannelWatchEnabled(options.agentDir));
			const guard = new LoopGuard({ now: options.now });
			const sendWake =
				options.sendWake ?? ((text: string) => pi.sendUserMessage(text, { deliverAs: "followUp" }));
			const readHash = options.readFileHash ?? defaultReadFileHash;
			const makeWatcher =
				options.watcherFactory ?? ((opts: ChannelWatcherOptions) => new ChannelWatcher(opts));

			let active = false;
			let trusted = false;
			let watcher: ChannelWatcher | null = null;
			let lastCtx: ExtensionContext | null = null;
			let toolsBound = false;
			const subscriptions = new Set<string>();

			const cursors = new Map<string, string | null>();

			const selfWritePreVersion = new Map<string, string | null>();

			let watcherEpoch = 0;
			let watcherPromise: Promise<void> | null = null;
			let startupEpoch = 0;

			const notify = (text: string): void => {
				try {
					if (options.notify) {
						options.notify(text);
						return;
					}
					lastCtx?.ui.notify(text, "warning");
				} catch (err) {
					log.warn("channel-watch notify 失败", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			};

			const shortId = (): string | undefined => {
				try {
					return lastCtx?.sessionManager.getSessionId().slice(0, 8);
				} catch {
					return undefined;
				}
			};

			const fullSessionId = (): string | undefined => {
				try {
					return lastCtx?.sessionManager.getSessionId();
				} catch {
					return undefined;
				}
			};

			const reportSubscriptions = (): void => {
				const onChanged = options.onSubscriptionsChanged;
				if (!onChanged) return;
				try {
					const sessionId = fullSessionId();
					if (!sessionId) {
						log.warn("订阅快照未上报：拿不到 sessionId");
						return;
					}
					onChanged(sessionId, new Set(active && trusted ? subscriptions : []));
				} catch (err) {
					log.warn("订阅快照上报失败", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			};

			const persist = (): void => {
				try {
					pi.appendEntry(SUBSCRIPTION_CUSTOM_TYPE, buildSubsPayload(subscriptions, cursors));
				} catch (err) {
					log.warn("订阅 appendEntry 失败", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			};

			const messagesPath = (topic: string): string => resolve(topicDir(options.cwd, topic), MESSAGES_FILE);

			const isLive = (): boolean =>
				active &&
				trusted &&
				subscriptions.size > 0 &&
				(!options.isSessionAlive ||
					(lastCtx !== null && options.isSessionAlive(lastCtx.sessionManager.getSessionId())));

			const subscribedTopicOfPath = (abs: string): string | null => {
				for (const topic of subscriptions) {
					if (messagesPath(topic) === abs) return topic;
				}
				return null;
			};

			const currentHash = (topic: string): Promise<string | null> => readHash(messagesPath(topic));

			const advanceCursor = (topic: string, hash: string | null): void => {
				if (cursors.has(topic) && cursors.get(topic) === hash) return;
				cursors.set(topic, hash);
				persist();
			};

			const deliverWake = (topic: string, relPath: string, hash: string): void => {
				sendWake(buildWakeMessage(topic));
				log.info("channel 唤醒已投递", { sessionId: shortId(), topic, relPath });
				const pausedNow = guard.recordDelivered(topic, relPath, hash);
				advanceCursor(topic, hash);
				if (pausedNow) {
					notify(
						`channel-watch：频道 [${topic}] 10 分钟内互触发达到上限，已暂停该频道的自动唤醒（防 token 环烧）。如需恢复，让模型重新执行 channel_subscribe(${topic})。`,
					);
				}
			};

			const advanceAfterSelfWrite = (topic: string, hash: string): void => {
				const before = selfWritePreVersion.get(topic);
				selfWritePreVersion.delete(topic);
				if (before !== undefined && before === cursors.get(topic)) {
					advanceCursor(topic, hash);
					return;
				}
				log.info("自写抑制但保留 pending", {
					sessionId: shortId(),
					topic,
					reason: before === undefined ? "pre-version-unknown" : "unconfirmed-external-change",
				});
			};

			const reconcileTopic = async (topic: string): Promise<void> => {
				try {
					if (!subscriptions.has(topic)) return;
					const before = cursors.get(topic);
					const hash = await currentHash(topic);

					if (!isLive() || !subscriptions.has(topic)) return;
					if (cursors.get(topic) !== before) return;
					if (before === hash) return;
					if (hash === null) {
						advanceCursor(topic, null);
						return;
					}
					if (before === undefined) {
						advanceCursor(topic, hash);
						return;
					}
					deliverWake(topic, `${topic}/${MESSAGES_FILE}`, hash);
				} catch (err) {
					log.warn("channel-watch 补投对账失败", {
						topic,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			};

			const onWatchEvent = (event: ChannelWatchEvent): void => {
				try {
					if (!active || !subscriptions.has(event.topic)) return;

					if (event.relPath !== `${event.topic}/${MESSAGES_FILE}`) return;
					const abs = join(channelRoot(options.cwd), event.relPath);
					void (async () => {
						try {
							const hash = await readHash(abs);

							if (!isLive() || !subscriptions.has(event.topic)) return;
							if (hash === null) {
								if (cursors.has(event.topic) && cursors.get(event.topic) !== null) {
									advanceCursor(event.topic, null);
								}
								return;
							}

							if (cursors.get(event.topic) === hash) {
								log.info("唤醒抑制", {
									sessionId: shortId(),
									topic: event.topic,
									reason: "cursor-unchanged",
								});
								return;
							}
							const decision = guard.shouldDeliver(event.topic, event.relPath, hash, abs);
							if (!decision.deliver) {
								log.info("唤醒抑制", {
									sessionId: shortId(),
									topic: event.topic,
									reason: decision.reason,
								});

								if (decision.reason === "self-write") {
									advanceAfterSelfWrite(event.topic, hash);
								}

								return;
							}
							deliverWake(event.topic, event.relPath, hash);
						} catch (err) {
							log.warn("channel-watch 事件处理失败", {
								error: err instanceof Error ? err.message : String(err),
							});
						}
					})();
				} catch (err) {
					log.warn("channel-watch 事件处理失败", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			};

			const ensureWatcher = (): Promise<void> => {
				if (!isLive()) return Promise.resolve();
				if (watcher) return Promise.resolve();
				if (watcherPromise) return watcherPromise;
				const epoch = watcherEpoch;
				let w: ChannelWatcher;
				try {
					w = makeWatcher({
						channelRoot: channelRoot(options.cwd),
						onEvent: onWatchEvent,
					});
				} catch (err) {
					log.warn("channel watcher 工厂失败，下次订阅重试", {
						error: err instanceof Error ? err.message : String(err),
					});
					return Promise.resolve();
				}
				const run = (async () => {
					try {
						const mode = await w.start();

						if (epoch !== watcherEpoch || !isLive()) {
							try {
								w.stop();
							} catch (err) {
								log.warn("丢弃的 watcher 停止失败", {
									error: err instanceof Error ? err.message : String(err),
								});
							}
							return;
						}
						watcher = w;
						log.info("channel watcher 启动", { mode, root: channelRoot(options.cwd) });
					} catch (err) {
						log.warn("channel watcher 启动失败，下次订阅重试", {
							error: err instanceof Error ? err.message : String(err),
						});
					}
				})();
				watcherPromise = run;

				const settle = (): void => {
					if (watcherPromise === run) watcherPromise = null;
				};
				run.then(settle, settle);
				return run;
			};

			const stopWatcher = (): void => {
				watcherEpoch += 1;
				watcherPromise = null;
				if (watcher) {
					try {
						watcher.stop();
					} catch (err) {
						log.warn("watcher 停止失败", { error: err instanceof Error ? err.message : String(err) });
					}
					watcher = null;
				}
			};

			const bindTools = (): void => {
				if (toolsBound) return;
				toolsBound = true;
				for (const tool of makeChannelTools({
					cwd: options.cwd,
					getSubscriptions: () => new Set(subscriptions),
					subscribe: async (topic) => {
						const invalid = validateTopic(topic);
						if (invalid) return { ok: false, error: invalid };
						if (!trusted) {
							return {
								ok: false,
								error: "项目未受信任（trusted），频道协作不可用；请在设置中信任本项目后重开会话",
							};
						}
						const resumed = guard.isPaused(topic);
						guard.resumeTopic(topic);
						subscriptions.add(topic);

						if (!cursors.has(topic)) {
							const baseline = await currentHash(topic);

							if (!isLive() || !subscriptions.has(topic)) return { ok: true, resumed };
							if (!cursors.has(topic)) cursors.set(topic, baseline);
						}
						if (!isLive() || !subscriptions.has(topic)) return { ok: true, resumed };
						persist();
						reportSubscriptions();
						await ensureWatcher();

						if (!isLive() || !subscriptions.has(topic)) return { ok: true, resumed };

						await reconcileTopic(topic);
						return { ok: true, resumed };
					},
					async post(topic, message, closed) {
						if (!trusted) {
							return {
								ok: false,
								error: "项目未受信任（trusted），频道协作不可用；请在设置中信任本项目后重开会话",
							};
						}
						try {
							const sessionId = lastCtx?.sessionManager.getSessionId();
							const file = messagesPath(topic);

							const before = subscriptions.has(topic) ? await readHash(file) : null;
							await appendPost(options.cwd, { topic, message, closed, sessionId });

							guard.markSelfWrite(file);

							if (isLive() && subscriptions.has(topic)) {
								try {
									if (before === cursors.get(topic)) {
										const after = await readHash(file);
										if (after !== null && isLive() && subscriptions.has(topic)) {
											advanceCursor(topic, after);
										}
									} else {
										log.info("post 后保留 pending cursor", { sessionId: shortId(), topic });
									}
								} catch (err) {
									log.warn("post 后推进 cursor 失败（后续对账会收敛）", {
										error: err instanceof Error ? err.message : String(err),
									});
								}
							}
							return { ok: true };
						} catch (err) {
							return { ok: false, error: err instanceof Error ? err.message : String(err) };
						}
					},
					unsubscribe(topic) {
						if (!subscriptions.delete(topic)) return { ok: false, error: `未订阅频道 [${topic}]` };
						guard.forgetTopic(topic);
						cursors.delete(topic);
						persist();
						reportSubscriptions();
						if (subscriptions.size === 0) stopWatcher();
						return { ok: true };
					},
					pausedTopics: () => guard.pausedTopicList(),
				})) {
					pi.registerTool(tool);
				}
			};

			const cleanup = (): void => {
				startupEpoch++;
				stopWatcher();
				guard.reset();
				active = false;
				trusted = false;
				reportSubscriptions();
			};

			pi.on("session_start", async (_event, ctx) => {
				const epoch = ++startupEpoch;

				lastCtx = ctx;
				try {
					options.onSessionCleanup?.(cleanup);
					if (!enabled()) {
						active = false;
						trusted = false;
						reportSubscriptions();
						return;
					}
					active = true;
					trusted = ctx.isProjectTrusted() === true;
					if (trusted) {
						const init = await ensureAgentWorkInit(options.cwd);
						if (init.created.length > 0) {
							notify(
								`channel-watch：已初始化协作目录 .local/agent-work/{channel,spec,plan}（gitignore 已处理：${init.gitignore}）。`,
							);
						}
					}

					try {
						const restored = restoreSubscriptionState(ctx.sessionManager.getEntries());
						for (const topic of restored.topics) subscriptions.add(topic);
						for (const [topic, hash] of restored.cursors) cursors.set(topic, hash);
					} catch (err) {
						log.warn("订阅恢复失败（按空订阅处理）", {
							error: err instanceof Error ? err.message : String(err),
						});
					}
					bindTools();
					log.info("channel-watch session_start", {
						trusted,
						subscriptions: subscriptions.size,
						watcher: watcher?.mode ?? "idle",
					});

					reportSubscriptions();

					if (trusted && subscriptions.size > 0) {
						const resume = async () => {
							try {
								if (options.waitForHistoryReady) {
									const allowed = await options.waitForHistoryReady(ctx.sessionManager.getSessionId());
									if (!allowed) return;
								}
								if (epoch !== startupEpoch || !isLive()) return;
								await ensureWatcher();
								if (epoch !== startupEpoch || !isLive()) return;
								for (const topic of subscriptions) await reconcileTopic(topic);
							} catch (err) {
								log.warn("channel-watch 历史就绪后对账失败", {
									error: err instanceof Error ? err.message : String(err),
								});
							}
						};

						if (options.waitForHistoryReady) void resume();
						else await resume();
					}
				} catch (err) {
					active = false;
					trusted = false;
					log.error("channel-watch session_start 失败，降级关闭", {
						error: err instanceof Error ? err.message : String(err),
					});
					reportSubscriptions();
				}
			});

			pi.on("input", (event) => {
				try {
					if (event.source === "extension") return;
					guard.noteUserMessage();
					return undefined;
				} catch {
					return undefined;
				}
			});

			pi.on("tool_call", async (event) => {
				try {
					if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
					const input = event.input as { path?: unknown; file?: unknown };
					const raw = typeof input?.path === "string" ? input.path : input?.file;
					if (typeof raw !== "string" || raw.length === 0) return undefined;
					const abs = isAbsolute(raw) ? resolve(raw) : resolve(options.cwd, raw);
					guard.markSelfWrite(abs);

					const topic = subscribedTopicOfPath(abs);
					if (topic) selfWritePreVersion.set(topic, await readHash(abs));
					return undefined;
				} catch (err) {
					log.warn("tool_call 自写标记失败", {
						error: err instanceof Error ? err.message : String(err),
					});
					return undefined;
				}
			});

			pi.on("session_shutdown", () => {
				try {
					cleanup();
				} catch (err) {
					log.warn("channel-watch shutdown 清理失败", {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			});
		},
	};
}
