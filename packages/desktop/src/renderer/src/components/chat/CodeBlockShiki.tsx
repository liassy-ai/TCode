import { MarkdownCodeBlockNode, type MarkdownCodeBlockNodeProps } from "markstream-react";
import { useThemeStore } from "../../stores/theme";

export function CodeBlockShiki(props: MarkdownCodeBlockNodeProps) {
	const isDark = useThemeStore((s) => s.resolved === "dark");
	return (
		<MarkdownCodeBlockNode
			{...props}
			isDark={isDark}
			themes={["vitesse-light", "vitesse-dark"]}
			lightTheme="vitesse-light"
			darkTheme="vitesse-dark"
		/>
	);
}
