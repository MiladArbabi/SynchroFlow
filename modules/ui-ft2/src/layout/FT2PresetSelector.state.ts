import type { FT2DateRangePreset } from '../contracts/ft2DateRange.js';

export type SemanticPreset = Exclude<FT2DateRangePreset, 'custom'>;

export type FT2PresetSelectorState =
  | {
      kind: 'semantic';
      preset: SemanticPreset;
    }
  | {
      kind: 'custom';
    };

export type FT2PresetEvent =
  | { type: 'SELECT_PRESET'; preset: FT2DateRangePreset }
  | { type: 'CANCEL_CUSTOM' };

export function ft2PresetReducer(
  state: FT2PresetSelectorState,
  event: FT2PresetEvent
): FT2PresetSelectorState {
  switch (event.type) {
    case 'SELECT_PRESET': {
      if (event.preset === 'custom') {
        return { kind: 'custom' };
      }

      return {
        kind: 'semantic',
        preset: event.preset,
      };
    }

    case 'CANCEL_CUSTOM': {
      return {
        kind: 'semantic',
        preset: 'past_30_days',
      };
    }

    default:
      return state;
  }
}