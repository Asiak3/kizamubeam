// Template for a KizamuBeam generator plugin in TypeScript: a name tag with a hanging hole.
// Copy this folder to plugins/<your-name>/, change the ids in plugin.json and build with
//   npm run plugin:pack -- --build plugins/<your-name>
// then check it with npm run plugin:check plugins/<your-name>.
import { definePlugin, circle, mm, roundedRect, type Issue } from '../../../sdk/ts';

interface P {
  [k: string]: number | string | boolean;
  width: number;
  height: number;
  corner: number;
  hole: boolean;
  holeDia: number;
}

definePlugin<P>({
  validate(p) {
    const out: Issue[] = [];
    if (p.corner * 2 > Math.min(p.width, p.height)) out.push({ key: 'corner', level: 'error', code: 'corner-too-large' });
    if (p.hole && p.holeDia + 4 > p.height) out.push({ key: 'holeDia', level: 'error', code: 'hole-too-large', values: { max: p.height - 4 } });
    return out;
  },
  generate(p) {
    const subs = [roundedRect(p.width, p.height, p.corner)];
    if (p.hole) subs.push(circle(-p.width / 2 + p.holeDia / 2 + 3, 0, p.holeDia / 2));
    return { parts: [{ key: 'tag', subs, at: { x: 0, y: 0 } }], info: [['area', `${mm(p.width * p.height)} mm²`]] };
  },
});
