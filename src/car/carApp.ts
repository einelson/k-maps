import { HybridAutoPlay, ListTemplate, MessageTemplate } from '@iternio/react-native-auto-play';

import { finishTrackRecording, restoreRecording, startTrackRecording, syncRecording } from '../features/trackRecorder';
import type { TransportId } from '../features/transport';
import { useSettingsStore } from '../state/useSettingsStore';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';
import { CAR_TITLE, homeSections, startFailureMessage, transportSections, type CarRecordingState } from './carScreens';
import { carDb } from './carDb';

/**
 * K-Maps on the car screen (Android Auto today). It is a list app, not a map: K-Maps has no turn-by-turn
 * guidance, so Google would only accept it as a "points of interest" app (see plugins/withAutoPlay.js), and
 * those draw templates rather than their own map. What it does is what makes sense in a truck or on a trailer
 * haul: start a track (choosing how you're getting around, which sets how often the GPS is sampled), watch the
 * clock and distance, and end and save it. It shares the phone's recording (same SQLite tables, same store), so
 * a track started on either screen shows on both.
 */

/**
 * How often the home screen catches up with the recording. Cars limit how often an app may refresh a template
 * (the host starts ignoring updates), so this stays slow and a refresh that would draw the same thing is skipped.
 */
export const CAR_REFRESH_MS = 5000;

let home: ListTemplate | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** What the home screen last drew, so an unchanged screen isn't redrawn. */
let lastDrawn = '';

const warn = (what: string) => (err: unknown) => console.warn(what, err);
const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

function snapshot(): CarRecordingState {
  const { recording, transport, startedAt, distanceM, interrupted } = useTrackRecordingStore.getState();
  return { recording, transport, startedAt, distanceM, interrupted };
}

function drawHome(): void {
  if (!home) return;
  const sections = homeSections(snapshot(), useSettingsStore.getState().units, Date.now(), {
    chooseTransport,
    endAndSave,
  });
  const drawn = JSON.stringify(sections); // functions drop out, leaving only what is on screen
  if (drawn === lastDrawn) return;
  lastDrawn = drawn;
  void Promise.resolve(home.updateSections(sections)).catch(warn('Could not update the car screen'));
}

function showMessage(title: string, message: string, autoDismissMs?: number): void {
  const ok = { type: 'text' as const, title: 'OK', onPress: () => void HybridAutoPlay.popTemplate() };
  void new MessageTemplate({
    title: { text: title },
    message: { text: message },
    autoDismissMs,
    actions: { android: [ok], ios: [ok] },
  })
    .push()
    .catch(warn('Could not show a message on the car screen'));
}

function chooseTransport(): void {
  const { units, trackSpacingM } = useSettingsStore.getState();
  const back = { type: 'back' as const, onPress: () => void HybridAutoPlay.popTemplate() };
  void new ListTemplate({
    title: { text: 'Record a track' },
    sections: transportSections(units, trackSpacingM, (id) => void startRecording(id)),
    headerActions: { android: { startHeaderAction: back }, ios: { backButton: back } },
  })
    .push()
    .catch(warn('Could not show the transport choices'));
}

async function startRecording(transport: TransportId): Promise<void> {
  try {
    await HybridAutoPlay.popTemplate(); // back to the home screen, which then shows the recording
    const result = await startTrackRecording(await carDb(), transport);
    if (!result.ok) showMessage("Can't record", startFailureMessage(result.reason));
  } catch (err) {
    // Asking for location permission needs the phone's screen, which isn't there when only the car is running.
    showMessage("Can't record", startFailureMessage(describe(err)));
  }
  drawHome();
}

async function endAndSave(): Promise<void> {
  try {
    const id = await finishTrackRecording(await carDb());
    if (id == null) showMessage('Nothing to save', 'Not enough points were recorded to make a track.', 6000);
    else showMessage('Track saved', 'Open K-Maps on your phone to name it and add details.', 6000);
  } catch (err) {
    showMessage("Couldn't save the track", describe(err));
  }
  drawHome();
}

function stopRefreshing(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Called each time a car connects (and again on a reconnect): a fresh root screen and refresh loop. */
async function showHome(): Promise<void> {
  stopRefreshing();
  const db = await carDb();
  // A recording started on the phone (or one that carried on while the app was closed) shows up here too.
  await restoreRecording(db);
  const sections = homeSections(snapshot(), useSettingsStore.getState().units, Date.now(), {
    chooseTransport,
    endAndSave,
  });
  home = new ListTemplate({ title: { text: CAR_TITLE }, sections });
  lastDrawn = JSON.stringify(sections);
  await home.setRootTemplate();
  timer = setInterval(() => {
    const recording = useTrackRecordingStore.getState().recording;
    (recording ? syncRecording(db) : restoreRecording(db)).then(drawHome, warn('Could not refresh the car screen'));
  }, CAR_REFRESH_MS);
}

function onDisconnect(): void {
  stopRefreshing();
  home = null;
  lastDrawn = '';
}

/** Hooks K-Maps up to the car. Safe to call once at startup; nothing happens until a car connects. */
export function registerCarApp(): () => void {
  const removeConnect = HybridAutoPlay.addListener(
    'didConnect',
    () => void showHome().catch(warn('Could not show the car screen'))
  );
  const removeDisconnect = HybridAutoPlay.addListener('didDisconnect', onDisconnect);
  return () => {
    removeConnect();
    removeDisconnect();
    onDisconnect();
  };
}
