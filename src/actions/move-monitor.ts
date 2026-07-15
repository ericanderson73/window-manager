import streamDeck from "@elgato/streamdeck";
import { action, DialRotateEvent, DidReceiveSettingsEvent, SingletonAction, TouchTapEvent, WillAppearEvent } from "@elgato/streamdeck";
import { moveFocusedWindowToAdjacentMonitor, restoreFocusedWindowBounds, WindowBounds } from "../window-control";
import { applyButtonBackground } from "../button-background";

type MoveMonitorSettings = {
	/** Color used behind the dial's icon. */
	backgroundColor?: string;
	/** Geometry from before the current monitor-move session. */
	previousBounds?: WindowBounds;
};

/** Moves the focused window to the adjacent monitor when the dial is turned. */
@action({ UUID: "com.bamabit.window-manager.move-monitor" })
export class MoveMonitor extends SingletonAction<MoveMonitorSettings> {
	// A SingletonAction serves every placement of this action, so state must be
	// scoped to the action context rather than the action class.
	private readonly states = new Map<string, MoveMonitorState>();

	override async onWillAppear(ev: WillAppearEvent<MoveMonitorSettings>): Promise<void> {
		if (ev.action.isDial()) {
			// Reapply the layout whenever Dial Stack selects this child action.
			await ev.action.setFeedbackLayout("layouts/window-icon.json");
			await applyButtonBackground(ev.action, "move-monitor", ev.payload.settings.backgroundColor);
			await ev.action.setTriggerDescription({ rotate: "Move selected window to another monitor", touch: "Restore original window bounds" });
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MoveMonitorSettings>): Promise<void> {
		await applyButtonBackground(ev.action, "move-monitor", ev.payload.settings.backgroundColor);
	}

	override onDialRotate(ev: DialRotateEvent<MoveMonitorSettings>): void {
		const state = this.getState(ev.action.id);
		const direction = Math.sign(ev.payload.ticks);
		if (direction === 0) return;

		// Monitor changes are discrete. Keep only the most recent requested direction
		// while the operating system completes the current move.
		state.pendingDirection = direction;
		if (!state.pendingSettings) {
			const { previousBounds: _previousBounds, ...settings } = ev.payload.settings;
			state.pendingSettings = state.captureNewBaselineOnNextRotation ? settings : ev.payload.settings;
		}
		state.pendingAction ??= ev.action;
		void this.flush(ev.action.id);
	}

	override async onTouchTap(ev: TouchTapEvent<MoveMonitorSettings>): Promise<void> {
		const { previousBounds, ...settings } = ev.payload.settings;
		if (!previousBounds) {
			await ev.action.showAlert();
			return;
		}

		try {
			await restoreFocusedWindowBounds(previousBounds);
			await ev.action.setSettings(settings);
			// Settings events can lag behind setSettings, so explicitly request a
			// new baseline for the next rotation.
			this.getState(ev.action.id).captureNewBaselineOnNextRotation = true;
		} catch (error) {
			streamDeck.logger.error(`Unable to restore focused window: ${String(error)}`);
			await ev.action.showAlert();
		}
	}

	private getState(actionId: string): MoveMonitorState {
		let state = this.states.get(actionId);
		if (!state) {
			state = { isMoving: false, pendingDirection: 0 };
			this.states.set(actionId, state);
		}
		return state;
	}

	private async flush(actionId: string): Promise<void> {
		const state = this.getState(actionId);
		if (state.isMoving || state.pendingDirection === 0) return;

		const direction = state.pendingDirection;
		const settings = state.pendingSettings;
		const action = state.pendingAction;
		state.pendingDirection = 0;
		state.pendingSettings = undefined;
		state.pendingAction = undefined;
		state.isMoving = true;
		try {
			const originalBounds = await moveFocusedWindowToAdjacentMonitor(direction);
			if (settings && action && !settings.previousBounds) {
				await action.setSettings({ ...settings, previousBounds: originalBounds });
				state.captureNewBaselineOnNextRotation = false;
			}
		} catch (error) {
			streamDeck.logger.error(`Unable to move focused window to another monitor: ${String(error)}`);
		} finally {
			state.isMoving = false;
			void this.flush(actionId);
		}
	}
}

type MoveMonitorState = {
	isMoving: boolean;
	pendingDirection: number;
	pendingSettings?: MoveMonitorSettings;
	pendingAction?: DialRotateEvent<MoveMonitorSettings>["action"];
	captureNewBaselineOnNextRotation?: boolean;
};
