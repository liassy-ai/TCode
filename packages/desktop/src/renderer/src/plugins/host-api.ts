import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { ImagePreviewOverlay } from "../components/chat/ImagePreview";
import { Markdown } from "../components/chat/Markdown";
import { displayName, summarizeArgs } from "../components/chat/ToolCallCard";
import { Button } from "../components/ui/Button";
import { Dropdown } from "../components/ui/Dropdown";
import { Tooltip } from "../components/ui/Tooltip";
import { useContextUsage } from "../hooks/use-context-usage";
import { useLanguage } from "../hooks/use-language";
import { useQuota } from "../hooks/use-quota";
import { useT } from "../i18n";
import { useProjectsStore } from "../stores/projects";
import { useSessionsStore } from "../stores/sessions";
import { useSettingsStore } from "../stores/settings";
import { useTranscriptStore } from "../stores/transcript";
import { useUiStore } from "../stores/ui";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import type { TcodeUiApi } from "./env";

window.TcodeUI = {
	version: 1,

	React,
	jsxRuntime,
	ReactDOM,
	components: {
		Button,
		Dropdown,
		Tooltip,
		Markdown,
		ImagePreview: ImagePreviewOverlay,
	},
	helpers: {
		summarizeArgs,
		displayToolName: displayName,
	},
	hooks: {
		useT,
		useContextUsage,
		useQuota,
		useLanguage,
	},
	stores: {
		useTranscriptStore,
		useSessionsStore,
		useUiStore,
		useProjectsStore,
		useSettingsStore,
		useUiPreferencesStore,
	},
} satisfies TcodeUiApi;
