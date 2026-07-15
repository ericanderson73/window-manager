import streamDeck from "@elgato/streamdeck";
import { action, DialRotateEvent, DidReceiveSettingsEvent, SingletonAction, TouchTapEvent, WillAppearEvent } from "@elgato/streamdeck";
import { restoreFocusedWindowBounds, snapFocusedWindowToScreenSegment, WindowBounds } from "../window-control";
import { applyButtonBackground } from "../button-background";

abstract class SnapWindowAction extends SingletonAction<SnapSettings> {
	protected abstract readonly screenFraction: number;
	protected abstract readonly icon: string;
	// SingletonAction is shared by every placement of this action type. Queue
	// work and retain a baseline separately for each dial context.
	private readonly states = new Map<string, SnapState>();

	override async onWillAppear(ev: WillAppearEvent<SnapSettings>): Promise<void> {
		if (ev.action.isDial()) {
			// Reapply the layout whenever Dial Stack selects this child action.
			await ev.action.setFeedbackLayout("layouts/window-icon.json");
			await applyButtonBackground(ev.action, this.icon, ev.payload.settings.backgroundColor);
			// The Dial Stack can change the layout after willAppear. Apply the
			// selected child's icon once more after that layout has settled.
			await new Promise((resolve) => setTimeout(resolve, 25));
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

		const state = this.getState(ev.action.id);
		await this.enqueue(state, async () => {
			const { previousBounds: _previousBounds, ...settingsWithoutBounds } = ev.payload.settings;
			const settings = state.captureNewBaselineOnNextRotation ? settingsWithoutBounds : ev.payload.settings;
			const savedPreviousBounds = state.captureNewBaselineOnNextRotation ? undefined : ev.payload.settings.previousBounds;
			const activeSettings: SnapSettings = {
				...settings,
				previousBounds: state.previousBounds ?? savedPreviousBounds,
				snapSegment: state.snapSegment ?? settings.snapSegment,
			};
			const snapSegment = this.getSnapSegment(direction, activeSettings);
			const bounds = await snapFocusedWindowToScreenSegment(snapSegment, this.screenFraction);
			// Preserve the first pre-snap geometry for this dial's entire session.
			state.previousBounds ??= activeSettings.previousBounds ?? bounds;
			state.snapSegment = snapSegment;
			state.captureNewBaselineOnNextRotation = false;
			await ev.action.setSettings({ ...settingsWithoutBounds, previousBounds: state.previousBounds, snapSegment });
		});
	}

	override async onTouchTap(ev: TouchTapEvent<SnapSettings>): Promise<void> {
		const state = this.getState(ev.action.id);
		await this.enqueue(state, async () => {
			// Touch events can carry a stale settings payload after a fast rotation.
			const currentSettings = await ev.action.getSettings<SnapSettings>();
			const previousBounds = state.previousBounds ?? currentSettings.previousBounds;
			if (!previousBounds) {
				await ev.action.showAlert();
				return;
			}

			try {
				await restoreFocusedWindowBounds(previousBounds);
				const { previousBounds: _previousBounds, ...settings } = currentSettings;
				await ev.action.setSettings(settings);
				state.previousBounds = undefined;
				state.snapSegment = undefined;
				state.captureNewBaselineOnNextRotation = true;
			} catch (error) {
				streamDeck.logger.error(`Unable to restore focused window: ${String(error)}`);
				await ev.action.showAlert();
			}
		});
	}

	private getState(actionId: string): SnapState {
		let state = this.states.get(actionId);
		if (!state) {
			state = { queue: Promise.resolve(), captureNewBaselineOnNextRotation: false };
			this.states.set(actionId, state);
		}
		return state;
	}

	private async enqueue(state: SnapState, operation: () => Promise<void>): Promise<void> {
		state.queue = state.queue.then(operation, operation);
		await state.queue;
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

type SnapState = {
	queue: Promise<void>;
	previousBounds?: WindowBounds;
	snapSegment?: number;
	captureNewBaselineOnNextRotation: boolean;
};
