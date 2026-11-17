// The core pack as built by `npm run plugin:core` (part of `npm run build` and `npm run dev`), bundled with the app.
// Only the app imports this module; tests read the file themselves.
import text from '../../plugins/core/dist/org.kizamubeam.core-generators.kzp?raw';

export const CORE_PACK_TEXT: string = text;
