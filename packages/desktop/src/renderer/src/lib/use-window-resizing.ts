import { useEffect, useState } from "react";

export function useWindowResizing(): boolean {
	const [resizing, setResizing] = useState(false);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onResize = () => {
			setResizing(true);
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(() => setResizing(false), 180);
		};
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
			if (timer !== undefined) clearTimeout(timer);
		};
	}, []);
	return resizing;
}
