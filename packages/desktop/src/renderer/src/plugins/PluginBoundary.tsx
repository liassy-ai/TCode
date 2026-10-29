import { Component, type ReactNode } from "react";
import { getPi } from "../api";
import { useUiPluginRegistry } from "./registry";

interface PluginBoundaryProps {
	pluginName: string;

	label: string;

	fallback?: ReactNode;
	children: ReactNode;
}

interface PluginBoundaryState {
	errored: boolean;
}

class PluginBoundary extends Component<PluginBoundaryProps, PluginBoundaryState> {
	state: PluginBoundaryState = { errored: false };

	static getDerivedStateFromError(): PluginBoundaryState {
		return { errored: true };
	}

	componentDidCatch(error: unknown) {
		const { pluginName, label } = this.props;
		console.error(`[ui-plugins] 插件 ${pluginName} 在 ${label} 崩溃`, error);
		if (useUiPluginRegistry.getState().reportCrash(pluginName)) {
			console.warn(`[ui-plugins] 插件 ${pluginName} 连续崩溃达到阈值，自动禁用`);
			void getPi().uiPluginsSetPluginEnabled({ name: pluginName, enabled: false });
		}
	}

	render() {
		return this.state.errored ? (this.props.fallback ?? null) : this.props.children;
	}
}

export { PluginBoundary };
