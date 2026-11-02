/**
 * Cross-entry-point intents for the workbench view.
 *
 * A command or the ribbon icon can ask the workbench to open a specific panel,
 * or to put the cursor in the concept input. The request must survive the gap
 * between "the command ran" and "the view finished mounting", so it is stored
 * as a pending value; an already mounted view receives it immediately instead.
 */
export type WorkbenchPanelIntent = "expand";

interface IntentChannel<T> {
  request(value: T): void;
  take(): T | undefined;
  subscribe(listener: (value: T) => void): () => void;
  clear(): void;
}

function createChannel<T>(): IntentChannel<T> {
  let pending: T | undefined;
  const listeners = new Set<(value: T) => void>();
  return {
    request(value) {
      if (listeners.size > 0) {
        for (const listener of listeners) listener(value);
        return;
      }
      pending = value;
    },
    take() {
      const value = pending;
      pending = undefined;
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      pending = undefined;
    },
  };
}

const panelChannel = createChannel<WorkbenchPanelIntent>();
const focusChannel = createChannel<true>();

export function requestWorkbenchPanel(panel: WorkbenchPanelIntent): void {
  panelChannel.request(panel);
}

/** Returns the pending panel request once; a freshly mounted view consumes it. */
export function takeWorkbenchPanel(): WorkbenchPanelIntent | undefined {
  return panelChannel.take();
}

/** Live delivery for an already mounted view; returns the unsubscribe handle. */
export function onWorkbenchPanel(listener: (panel: WorkbenchPanelIntent) => void): () => void {
  return panelChannel.subscribe(listener);
}

export function clearWorkbenchPanel(): void {
  panelChannel.clear();
}

/** Asks the view to focus the concept input; used only by explicit open actions. */
export function requestWorkbenchFocus(): void {
  focusChannel.request(true);
}

export function takeWorkbenchFocus(): boolean {
  return focusChannel.take() === true;
}

export function onWorkbenchFocus(listener: () => void): () => void {
  return focusChannel.subscribe(listener);
}
