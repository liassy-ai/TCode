import type { MessageKey, Translate } from "../i18n";
import type { BrowserControlNotice } from "./browser-control-notice";

const NOTICE_ACTION_KEYS: Record<string, MessageKey> = {
	open: "sidepane.browser.actOpen",
	reload: "sidepane.browser.actReload",
	script: "sidepane.browser.actScript",
	screenshot: "sidepane.browser.actScreenshot",
	resize: "sidepane.browser.actResize",
	click: "sidepane.browser.actClick",
	type: "sidepane.browser.actType",
	keys: "sidepane.browser.actKeys",
	hover: "sidepane.browser.actHover",
	scroll: "sidepane.browser.actScroll",
};

export function controlNoticeText(t: Translate, notice: BrowserControlNotice): string {
	const what = notice.op ? NOTICE_ACTION_KEYS[notice.op] : undefined;
	if (what && notice.mode === "act") {
		return t(
			notice.status === "active" ? "sidepane.browser.aiActingNamed" : "sidepane.browser.aiActedNamed",
			{
				what: t(what),
			},
		);
	}
	if (notice.status === "active") {
		return notice.mode === "act" ? t("sidepane.browser.aiActing") : t("sidepane.browser.aiViewing");
	}
	return notice.mode === "act" ? t("sidepane.browser.aiActed") : t("sidepane.browser.aiViewed");
}
