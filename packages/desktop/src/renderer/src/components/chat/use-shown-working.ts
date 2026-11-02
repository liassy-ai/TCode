import { useEffect, useRef, useState } from "react";

const HYSTERESIS_MS = 1500;

export function useShownWorking(working: boolean, endImmediately = false, resetKey?: string | null): boolean {
	const [shownWorking, setShownWorking] = useState(working);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevKeyRef = useRef(resetKey);
	useEffect(() => {
		if (prevKeyRef.current !== resetKey) {
			prevKeyRef.current = resetKey;
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			setShownWorking(working);
			return;
		}
		if (working) {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
			setShownWorking(true);
		} else if (shownWorking) {
			if (endImmediately) {
				setShownWorking(false);
				return;
			}
			if (!timerRef.current) {
				timerRef.current = setTimeout(() => {
					timerRef.current = null;
					setShownWorking(false);
				}, HYSTERESIS_MS);
			}
		}
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [working, shownWorking, endImmediately, resetKey]);
	return shownWorking;
}
