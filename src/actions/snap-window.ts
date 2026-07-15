import streamDeck from "@elgato/streamdeck";
import { action, DialRotateEvent, DidReceiveSettingsEvent, SingletonAction, TouchTapEvent, WillAppearEvent } from "@elgato/streamdeck";
import { restoreFocusedWindowBounds, snapFocusedWindowToScreenSegment, WindowBounds } from "../window-control";
import { applyButtonBackground } from "../button-background";

abstract class SnapWindowAction extends SingletonAction<SnapSettings> {
	protected abstract readonly screenFraction: number;
	protected abstract readonly icon: string;
	// A SnapWindowAction instance is shared across placements; retain the
	// post-restore flag per dial context.
	private readonly captureNewBaselineOnNextRotation = new Set<string>();

	override async onWillAppear(ev: WillAppearEvent<SnapSettings>): Promise<void> {
		if (ev.action.isDial()) {
			// Reapply the layout whenever Dial Stack selects this child action.
			await ev.action.setFeedbackLayout("layouts/window-icon.json");
			await applyButtonBackground(ev.action, this.icon, ev.payload.settings.backgroundColor);
			await ev.action.setTriggerDescription({ rotate: "Snap selected window", touch: "Restore original window bounds" });
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SnapSettings>): Promise<void> {
		await applyButtonBackground(ev.action, this.icon, ev.payload.settings.backgroundColor);
	}

	override async onDialRotate(ev: DialRotateEvent<SnapSettings>): Promise<void> {
		const direction = Math.sign(ev.payload.ticks);
		if (direction === 0) return;

		const { previousBounds: _previousBounds, ...settings } = ev.payload.settings;
		const activeSettings: SnapSettings = this.captureNewBaselineOnNextRotation.has(ev.action.id) ? settings : ev.payload.settings;
		const snapSegment = this.getSnapSegment(direction, activeSettings);
		const bounds = await snapFocusedWindowToScreenSegment(snapSegment, this.screenFraction);
		// Preserve the original geometry while switching between left and right halves.
		await ev.action.setSettings({
			...activeSettings,
			previousBounds: activeSettings.previousBounds ?? bounds,
			snapSegment,
		});
		this.captureNewBaselineOnNextRotation.delete(ev.action.id);
	}

	override async onTouchTap(ev: TouchTapEvent<SnapSettings>): Promise<void> {
		const { previousBounds, ...settings } = ev.payload.settings;
		if (!previousBounds) {
			await ev.action.showAlert();
			return;
		}

		try {
			await restoreFocusedWindowBounds(previousBounds);
			await ev.action.setSettings(settings);
			this.captureNewBaselineOnNextRotation.add(ev.action.id);
		} catch (error) {
			streamDeck.logger.error(`Unable to restore focused window: ${String(error)}`);
			await ev.action.showAlert();
		}
	}

	protected getSnapSegment(direction: number, _settings: SnapSettings): number {
		return direction < 0 ? 0 : this.screenFraction - 1;
	}
}

/** Snaps the focused window to the left or right half of its current monitor. */
@action({ UUID: "com.bamabit.window-manager.snap-window" })
export class SnapWindow extends SnapWindowAction {
	protected readonly screenFraction = 2;
	protected readonly icon = "snap-window";
}

/** Snaps the focused window to the left or right third of its current monitor. */
@action({ UUID: "com.bamabit.window-manager.snap-window-third" })
export class SnapWindowThird extends SnapWindowAction {
	protected readonly screenFraction = 3;
	protected readonly icon = "snap-window-third";

	override getSnapSegment(direction: number, settings: SnapSettings): number {
		if (!settings.previousBounds) return direction < 0 ? 0 : this.screenFraction - 1;

		const currentSegment = settings.snapSegment ?? (direction < 0 ? this.screenFraction - 1 : 0);
		return Math.max(0, Math.min(this.screenFraction - 1, currentSegment + direction));
	}
}

type SnapSettings = {
	/** Color used behind the dial's icon. */
	backgroundColor?: string;
	previousBounds?: WindowBounds;
	snapSegment?: number;
};
