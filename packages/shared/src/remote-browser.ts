export type RemoteBrowserInputEvent =
	| {
			type: "mouseDown" | "mouseUp" | "mouseMove";
			x: number;
			y: number;
			button?: "left" | "middle" | "right";
			modifiers?: string[];
			clickCount?: number;
	  }
	| { type: "mouseWheel"; x: number; y: number; deltaX?: number; deltaY?: number }
	| { type: "keyDown" | "keyUp"; keyCode: string; modifiers?: string[] }
	| { type: "char"; keyCode: string };

export interface RemoteBrowserFrame {
	id: string;

	dataUrl: string;
}

export interface RemoteBrowserStatus {
	url: string;
	title: string;
}

export interface RemoteBrowserEmbedCheck {
	embeddable: boolean;
	reason: string | null;
}
