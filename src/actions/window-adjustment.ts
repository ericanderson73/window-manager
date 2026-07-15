import streamDeck from "@elgato/streamdeck";
import { action, DialRotateEvent, DidReceiveSettingsEvent, SingletonAction, TouchTapEvent, WillAppearEvent } from "@elgato/streamdeck";
import { adjustFocusedWindow, restoreFocusedWindowBounds, WindowAdjustment, WindowBounds } from "../window-control";
import { applyButtonBackground } from "../button-background";

type DialSettings = {
	/** Pixels to move or resize for each dial detent. */
	step?: number;
	/** Color used behind the dial's icon. */
	backgroundColor?: string;
	/** Geometry from before the current adjustment session. */
	previousBounds?: WindowBounds;
};

abstract class WindowAdjustmentDial extends SingletonAction<DialSettings> {
	protected abstract readonly adjustment: WindowAdjustment;
	protected abstract readonly icon: string;
	// SingletonAction is shared by every placement of this action type. Keep all
	// transient state keyed by action context so separate dials never share a
	// baseline, queued movement, or post-restore flag.
	private readonly states = new Map<string, AdjustmentState>();

	override async onWillAppear(ev: WillAppearEvent<DialSettings>): Promise<void> {
		if (ev.action.isDial()) {
			// Dial Stack swaps actions without retaining the previous child's layout.
			// Reassign it before feedback so the selected child's icon is always shown.
			await ev.action.setFeedbackLayout("layouts/window-icon.json");
			await applyButtonBackground(ev.action, this.icon, ev.payload.settings.backgroundColor);
			await ev.action.setTriggerDescription({ rotate: "Adjust selected window", touch: "Restore original window bounds" });
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialSettings>): Promise<void> {
		await applyButtonBackground(ev.action, this.icon, ev.payload.settings.backgroundColor);
	}

	override onDialRotate(ev: DialRotateEvent<DialSettings>): void {
		const state = this.getState(ev.action.id);
		const configuredStep = Number(ev.payload.settings.step);
		const step = Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 20;
		// Press-and-turn is useful for making a larger adjustment without another action.
		const distance = ev.payload.ticks * step * (ev.payload.pressed ? 5 : 1);
		state.pendingDistance += distance;
		if (!state.pendingSettings) {
			const { previousBounds: _previousBounds, ...settings } = ev.payload.settings;
			state.pendingSettings = state.captureNewBaselineOnNextRotation ? settings : ev.payload.settings;
		}
		state.pendingAction ??= ev.action;
		this.scheduleFlush(ev.action.id);
	}

	override async onTouchTap(ev: TouchTapEvent<DialSettings>): Promise<void> {
		const { previousBounds, ...settings } = ev.payload.settings;
		if (!previousBounds) {
			await ev.action.showAlert();
			return;
		}

		try {
			await restoreFocusedWindowBounds(previousBounds);
			await ev.action.setSettings(settings);
			// Settings events can lag behind setSettings. Make the very next rotation
			// capture a fresh baseline even if it still carries the old settings.
			this.getState(ev.action.id).captureNewBaselineOnNextRotation = true;
		} catch (error) {
			streamDeck.logger.error(`Unable to restore focused window: ${String(error)}`);
			await ev.action.showAlert();
		}
	}

	/**
	 * Applying each tick immediately starts a separate osascript process on macOS.
	 * Group ticks that arrive within one screen frame, then run one adjustment at a
	 * time so rapid dial turns do not build up a delayed queue or race each other.
	 */
	private getState(actionId: string): AdjustmentState {
		let state = this.states.get(actionId);
		if (!state) {
			state = { pendingDistance: 0, isAdjusting: false };
			this.states.set(actionId, state);
		}
		return state;
	}

	private scheduleFlush(actionId: string): void {
		const state = this.getState(actionId);
		if (state.flushTimer || state.isAdjusting) return;
		state.flushTimer = setTimeout(() => {
			state.flushTimer = undefined;
			void this.flush(actionId);
		}, 16);
	}

	private async flush(actionId: string): Promise<void> {
		const state = this.getState(actionId);
		if (state.isAdjusting || state.pendingDistance === 0) return;

		const distance = state.pendingDistance;
		const settings = state.pendingSettings;
		const action = state.pendingAction;
		state.pendingDistance = 0;
		state.pendingSettings = undefined;
		state.pendingAction = undefined;
		state.isAdjusting = true;
		try {
			const originalBounds = await adjustFocusedWindow(this.adjustment, distance);
			if (settings && action && !settings.previousBounds) {
				await action.setSettings({ ...settings, previousBounds: originalBounds });
				state.captureNewBaselineOnNextRotation = false;
			}
		} catch (error) {
			streamDeck.logger.error(`Unable to adjust focused window: ${String(error)}`);
		} finally {
			state.isAdjusting = false;
			this.scheduleFlush(actionId);
		}
	}
}

type AdjustmentState = {
	pendingDistance: number;
	isAdjusting: boolean;
	flushTimer?: NodeJS.Timeout;
	pendingSettings?: DialSettings;
	pendingAction?: DialRotateEvent<DialSettings>["action"];
	captureNewBaselineOnNextRotation?: boolean;
};

/** Move the focused window left or right. */
@action({ UUID: "com.bamabit.window-manager.move-horizontal" })
export class MoveHorizontal extends WindowAdjustmentDial {
	protected readonly adjustment = WindowAdjustment.MoveHorizontal;
	protected readonly icon = "move-horizontal";
}

/** Move the focused window up or down. */
@action({ UUID: "com.bamabit.window-manager.move-vertical" })
export class MoveVertical extends WindowAdjustmentDial {
	protected readonly adjustment = WindowAdjustment.MoveVertical;
	protected readonly icon = "move-vertical";
}

/** Increase or decrease the focused window's width. */
@action({ UUID: "com.bamabit.window-manager.resize-horizontal" })
export class ResizeHorizontal extends WindowAdjustmentDial {
	protected readonly adjustment = WindowAdjustment.ResizeHorizontal;
	protected readonly icon = "resize-horizontal";
}

/** Increase or decrease the focused window's height. */
@action({ UUID: "com.bamabit.window-manager.resize-vertical" })
export class ResizeVertical extends WindowAdjustmentDial {
	protected readonly adjustment = WindowAdjustment.ResizeVertical;
	protected readonly icon = "resize-vertical";
}
