export interface SendGuard {
	tryAcquire: () => boolean;
	release: () => void;
}

export function createSendGuard(): SendGuard {
	let locked = false;
	return {
		tryAcquire: () => {
			if (locked) return false;
			locked = true;
			return true;
		},
		release: () => {
			locked = false;
		},
	};
}
