// Remembered settings of the Joint tool dialog (localStorage), without the dialog itself so they can be tested.
import { DEFAULT_JOINT, type JointOptions } from './jointsGeom';

export const JOINT_STATE_KEY = 'kizamubeam.joints';
/** Marks a remembered state written with the total play (#402); the play was per side before, so it is doubled once */
const PLAY_TOTAL = '_playTotal';

export function loadJointState(): JointOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(JOINT_STATE_KEY) ?? '{}') as Record<string, unknown>;
    const { [PLAY_TOTAL]: total, ...rest } = raw;
    if (!total && typeof rest.clearance === 'number') {
      rest.clearance = Math.round(2 * rest.clearance * 1e6) / 1e6;
      saveJointState({ ...DEFAULT_JOINT, ...rest } as JointOptions);
    }
    return { ...DEFAULT_JOINT, ...rest };
  } catch {
    return { ...DEFAULT_JOINT };
  }
}

export function saveJointState(st: JointOptions) {
  try {
    localStorage.setItem(JOINT_STATE_KEY, JSON.stringify({ ...st, [PLAY_TOTAL]: true }));
  } catch {
    /* Speicher nicht verfügbar */
  }
}
