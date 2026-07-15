import streamDeck from "@elgato/streamdeck";

import { MoveHorizontal, MoveVertical, ResizeHorizontal, ResizeVertical } from "./actions/window-adjustment";
import { MoveMonitor } from "./actions/move-monitor";
import { SnapWindow, SnapWindowThird } from "./actions/snap-window";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new MoveHorizontal());
streamDeck.actions.registerAction(new MoveVertical());
streamDeck.actions.registerAction(new ResizeHorizontal());
streamDeck.actions.registerAction(new ResizeVertical());
streamDeck.actions.registerAction(new MoveMonitor());
streamDeck.actions.registerAction(new SnapWindow());
streamDeck.actions.registerAction(new SnapWindowThird());

// Finally, connect to the Stream Deck.
streamDeck.connect();
