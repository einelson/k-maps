import type { ListTemplate, Section } from '@iternio/react-native-auto-play';

import { formatDistance, formatDuration } from '../features/formatUnits';
import { TRANSPORT_MODES, fixEveryM, transportLabel, type FixSpacing, type TransportId } from '../features/transport';
import type { UnitSystem } from '../state/useSettingsStore';

/**
 * What the car screen says, as plain data. The car shows templates the phone's UI can't share (Android Auto and
 * CarPlay only allow lists, grids and messages while driving), so this is deliberately small: start a track,
 * see how it's going, end and save it. Naming and filing a track stays on the phone, where it's safe to type.
 */

/** What the home screen is drawn from. */
export interface CarRecordingState {
  recording: boolean;
  transport: TransportId | null;
  startedAt: number | null;
  distanceM: number;
  /** Location updates stopped and couldn't be restarted, so nothing is being added. */
  interrupted: boolean;
}

export interface CarHomeActions {
  chooseTransport: () => void;
  endAndSave: () => void;
}

export const CAR_TITLE = 'K-Maps';

export function homeSections(
  state: CarRecordingState,
  units: UnitSystem,
  now: number,
  actions: CarHomeActions
): Section<ListTemplate> {
  if (!state.recording) {
    return [
      {
        type: 'default',
        title: 'Track recording',
        items: [
          {
            type: 'default',
            title: { text: 'Record a track' },
            detailedText: { text: "Choose how you're getting around" },
            browsable: true,
            onPress: actions.chooseTransport,
          },
        ],
      },
    ];
  }

  const label = transportLabel(state.transport);
  const elapsed = state.startedAt == null ? '0:00' : formatDuration(now - state.startedAt);
  return [
    {
      type: 'default',
      title: 'Recording',
      items: [
        {
          type: 'text',
          title: { text: label ? `Recording · ${label}` : 'Recording' },
          detailedText: {
            text: state.interrupted
              ? "Stopped: location updates couldn't restart"
              : `${elapsed} · ${formatDistance(state.distanceM, units)}`,
          },
        },
        {
          type: 'default',
          title: { text: 'End & save' },
          detailedText: { text: 'Name it and add details later, on your phone' },
          onPress: actions.endAndSave,
        },
      ],
    },
  ];
}

/** One row per way of getting around; picking one starts the recording. */
export function transportSections(
  units: UnitSystem,
  spacing: FixSpacing,
  onPick: (id: TransportId) => void
): Section<ListTemplate> {
  return [
    {
      type: 'default',
      title: 'How are you getting around?',
      items: TRANSPORT_MODES.map((mode) => ({
        type: 'default' as const,
        title: { text: mode.label },
        detailedText: { text: `A point every ${formatDistance(fixEveryM(mode.id, spacing), units)}` },
        onPress: () => onPick(mode.id),
      })),
    },
  ];
}

/** A message for the car screen when something went wrong that only the phone can fix (a permission prompt, say). */
export const PHONE_HINT = 'If this keeps happening, open K-Maps on your phone and start the recording there.';

export function startFailureMessage(reason: string): string {
  return `${reason}\n\n${PHONE_HINT}`;
}
