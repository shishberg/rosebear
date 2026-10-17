/**
 * PROTOTYPE ?hand: the measured left hand (v4/hand/left-hand.json, mirrored
 * into the right half's layout axes) drawn in the editor, laying out the
 * keys. Every slider move rewrites the finger columns and the thumb row
 * (Undo restores).
 *
 * Fingers: chains MCP-PIP-DIP-pad from the resting pose. At every key,
 * reaching between rows is along the keyboard and pressing is square to it;
 * each row is set as its distance from home, centre to centre. The path is
 * set by the reach mix (MCP degrees per PIP degree) or the press mix (PIP+DIP
 * degrees per MCP degree; Jindrich et al. 2004 measured about 1.4).
 *
 * Thumb: a ball joint at the assumed CMC, hinges at the MCP and IP, its pose
 * at each key interpolated from the photos' poses round one arc (thumbAt).
 * Its turn about the metacarpal comes with the CMC's swing (twistAt).
 *
 * The readout says first whether the layout is valid (see check): no keycaps
 * hit, no part of the hand goes into the keyboard or the printed test frame,
 * every key is in reach and the board fits the 66 mm tray.
 */
import * as T from 'three';
import hand from '../../../hand/left-hand.json';
import { capsOf, check, partHits, problems, thumbPart, trisOf, TRAY } from './check';
import {
  DACTYL,
  EXTRA,
  MIX_MIN,
  NATURAL,
  NO_CURL,
  START,
  THUMB_ROW,
  YOURS,
  anchorOf,
  applyHand,
  mixFor,
  solveHand,
  stateOf,
  turnOf,
  wayOf,
  worldOf,
  wristHeightAt,
} from './layout';
import {
  BACK_OF_THUMB,
  C,
  THUMB_EDGE,
  THUMB_R,
  carry,
  cmc,
  moveBy,
  photoPose,
  pressed,
  rowPose,
  thumb,
  thumbRow,
  twistAt,
} from './model';

export { setupHand } from './panel';

/** Internals for the tests and the fingerprint. */
export const _test = {
  T,
  thumb,
  pressed,
  moveBy,
  carry,
  thumbPart,
  THUMB_ROW,
  thumbRow,
  BACK_OF_THUMB,
  twistAt,
  photoPose,
  C,
  cmcPoses: cmc.poses,
  prints: hand.measured.thumb_prints,
  THUMB_R,
  THUMB_EDGE,
  solveHand,
  capsOf,
  check,
  partHits,
  anchorOf,
  applyHand,
  worldOf,
  trisOf,
  TRAY,
  rowPose,
  wayOf,
  turnOf,
  NATURAL,
  DACTYL,
  YOURS,
  NO_CURL,
  MIX_MIN,
  wristHeightAt,
  mixFor,
  problems,
  stateOf,
  START,
  EXTRA,
};
