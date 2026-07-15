import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** The default touchscreen button background. */
export const DEFAULT_BUTTON_BACKGROUND = "transparent";

type ImageAction = {
	isDial(): boolean;
	/** Encoder actions use this to update the touch-strip layout. */
	setFeedback?(feedback: {
		background: { background: string };
		icon: string;
	}): Promise<void>;
};

const iconCache = new Map<string, string>();

export function getButtonBackground(backgroundColor?: string): string {
	return /^#[0-9a-f]{6}$/i.test(backgroundColor ?? "") ? backgroundColor! : DEFAULT_BUTTON_BACKGROUND;
}

/**
 * Re-colors the circular background in an action's dial icon. The source SVG is
 * read from the plugin bundle so the foreground artwork remains unchanged.
 */
export async function applyButtonBackground(action: ImageAction, icon: string, backgroundColor?: string): Promise<void> {
	let svg = iconCache.get(icon);
	if (!svg) {
		const iconPath = fileURLToPath(new URL(`../imgs/actions/dials/${icon}.svg`, import.meta.url));
		svg = await readFile(iconPath, "utf8");
		iconCache.set(icon, svg);
	}

	// A missing setting means the touchscreen is transparent. Keep the dial's
	// original artwork in that case rather than making its icon transparent too.
	const recoloredSvg = /^#[0-9a-f]{6}$/i.test(backgroundColor ?? "")
		? svg.replace(/(<circle\b[^>]*\bfill=")[^"]+("[^>]*>)/, `$1${backgroundColor}$2`)
		: svg;

	// Feedback properties address the named pixmaps in the touch-strip layout.
	await action.setFeedback?.({
		background: { background: getButtonBackground(backgroundColor) },
		icon: recoloredSvg,
	});
}
