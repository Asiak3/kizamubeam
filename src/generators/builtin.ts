// Source of the generators that come with the app, in toolbox order. The app does not import this file: they are
// built into the core pack (scripts/build-core-plugins.mjs) and run as plugins (src/plugins/core.ts). Node tests
// register them directly (scripts/builtin-generators.ts), and the core pack test compares both.
import { BOX } from './box';
import { FINGERBOX } from './fingerbox';
import { CAM } from './cam';
import { DRAWER } from './drawer';
import { INSERT } from './insert';
import { SHELF } from './shelf';
import { GEAR } from './gear';
import { GEARPAIR } from './gearpair';
import { PULLEY } from './pulley';
import { RACK } from './rack';
import { DISCSPHERE } from './discsphere';
import { STACK } from './stack';
import { RIBS } from './ribs';
import { JIG } from './jig';
import type { Generator } from './types';

export const BUILTIN_GENERATORS: Generator[] = [GEAR, RACK, PULLEY, CAM, GEARPAIR, BOX, FINGERBOX, DRAWER, INSERT, SHELF, STACK, RIBS, DISCSPHERE, JIG];
