import type { ImageInput } from "@tcode/shared";
import { useT } from "../../i18n";
import { imageSrc } from "../chat/ImagePreview";
import { CloseIcon } from "../icons";

export function ImageTray({
	images,
	onPreview,
	onRemove,
}: {
	images: ImageInput[];
	onPreview: (image: ImageInput) => void;
	onRemove: (index: number) => void;
}) {
	const t = useT();
	if (images.length === 0) return null;
	return (
		<div className="absolute bottom-full left-0 z-10 mb-2 flex max-w-full flex-wrap items-end gap-2">
			{images.map((image, index) => (
				<div
					key={index}
					className="group relative"
				>
					<button
						type="button"
						className="block h-16 w-16 overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
						onClick={() => onPreview(image)}
					>
						<img
							src={imageSrc(image)}
							alt={`${t("composer.previewImage")} ${index + 1}`}
							className="h-full w-full object-cover"
						/>
					</button>
					<button
						type="button"
						className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-on-ink shadow transition-colors hover:bg-red-600"
						aria-label={t("composer.removeImage")}
						onClick={() => onRemove(index)}
					>
						<CloseIcon size={8} />
					</button>
				</div>
			))}
		</div>
	);
}
