// "Select assembly" (issue #237): select every part of the assemblies in the selection. When parts are
// on other pages, hidden or locked, a small dialog says so and offers to select only the available
// parts or to bring all of them to this page first. The editor side lives in editor/generators.ts.
import type { Editor } from './editor';
import type { AsmStatus } from './editor/generators';
import { asmParts } from './editor/generators';
import { h, showDialog } from './dom';
import { t, tn } from './i18n';

type Answer = 'ready' | 'bring' | null;

function askAsmSelect(ed: Editor, asms: string[], st: AsmStatus): Promise<Answer> {
  return new Promise((resolve) => {
    let answer: Answer = null;
    const done = (a: Answer) => ((answer = a), dlg.close());
    const ready = asmParts(st.ready), hidden = asmParts(st.hidden), away = asmParts(st.away), blocked = asmParts(st.blocked);
    const pages = [...new Set(st.away.map((x) => x.page))].sort((a, b) => a - b).map((i) => ed.doc.pages[i].name).join(', ');
    const bringLabel = t('Alle Teile zusammenholen und auswählen');
    const lines = [
      ready ? tn('{n} Teil ist hier auswählbar.', '{n} Teile sind hier auswählbar.', ready) : null,
      away ? tn('{n} Teil liegt auf einer anderen Seite ({pages}).', '{n} Teile liegen auf anderen Seiten ({pages}).', away, { pages }) : null,
      hidden ? tn('{n} Teil ist ausgeblendet oder gesperrt.', '{n} Teile sind ausgeblendet oder gesperrt.', hidden) : null,
      blocked ? tn('{n} Teil bleibt unverändert: Layer ausgeblendet oder gesperrt, Bedingung „Sichtbar, wenn …“ oder außerhalb der Isolation.',
        '{n} Teile bleiben unverändert: Layer ausgeblendet oder gesperrt, Bedingung „Sichtbar, wenn …“ oder außerhalb der Isolation.', blocked) : null,
    ].filter((s): s is string => !!s);
    const dlg = h(
      'dialog',
      { class: 'offset-dialog asm-select' },
      h('h3', {}, t('Baugruppe auswählen')),
      h('p', {}, h('b', {}, ed.asmLabel(asms))),
      h('ul', {}, ...lines.map((s) => h('li', {}, s))),
      hidden || away
        ? h('p', {}, t('„{button}“ verschiebt Teile anderer Seiten an dieselbe Stelle auf dieser Seite und hebt das Ausblenden und Sperren der Teile auf. Layer bleiben, wie sie sind.', { button: bringLabel }))
        : null,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => done(null) }, t('Abbrechen')),
        ready ? h('button', { class: hidden || away ? 'btn' : 'btn primary', onclick: () => done('ready') }, t('Nur verfügbare auswählen')) : null,
        hidden || away ? h('button', { class: 'btn primary', onclick: () => done('bring') }, bringLabel) : null,
      ),
    );
    showDialog(dlg, () => resolve(answer));
  });
}

/** Menu command: select the assemblies of the selected parts, asking first when some parts are not available */
export async function selectAssembly(ed: Editor) {
  const asms = ed.selAsms();
  if (!asms.length) return;
  const st = ed.asmStatus(asms);
  if (!st.hidden.length && !st.away.length && !st.blocked.length) {
    ed.selectAsm(asms);
    return;
  }
  const answer = await askAsmSelect(ed, asms, st);
  if (answer) ed.selectAsm(asms, answer === 'bring');
}
