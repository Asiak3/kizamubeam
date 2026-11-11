import type { Editor } from './editor';
import type { OutlinePreview } from './editor/outline';
import { h } from './dom';
import { t } from './i18n';
import { offsetResults, offsetClosureOwners, offsetRemainderKey, type TrimmedOffsetSpan } from './contourOffset';
import { activeOffsetExclusions, offsetExcludedPaths, offsetWorldPath, offsetSelectionSources, pickOffsetSelection, offsetSelectionArcs, type OffsetSourceHit } from './contourOffsetSelection';
import { regionContains } from './shapeRegions';
import { movableToolWindow } from './toolWindow';
import { defaultLayer } from './model';
import { assessOffsetOutput } from './contourOffsetValidation';
import { offsetContourSections, pickOffsetSections, toggleOffsetSection, type OffsetSection } from './contourOffsetSections';
import { offsetAssemblyOutputConflict } from './editor/contourOffset';

const open = new WeakSet<Editor>();
const exclusionFailure = (error: unknown): string => {
  const cause = error instanceof Error ? error.cause : undefined;
  const reason = cause && typeof cause === 'object' && 'reason' in cause ? cause.reason : undefined;
  if (reason === 'cross-owner-exclusion') return t('Dieser Ausschluss betrifft mehrere Quellobjekte. Ausgabeobjekt wählen und das gemeinsame geschlossene Ergebnis für diese Kontur ausdrücklich aktivieren.');
  if (typeof reason === 'string' && reason.startsWith('exclusion-normal-'))
    return t('An diesem Kurvenpunkt ist keine eindeutige kurze Verbindung zur versetzten Kontur möglich. Andere Bereichsgrenze oder kleineren Versatz wählen.');
  return error instanceof Error ? error.message : String(error);
};

export function openContourOffsetDialog(ed: Editor): void {
  if (open.has(ed) || ed.outlinePreview || document.querySelector('dialog[open]')) return;
  try {
    const session = ed.prepareContourOffset();
    open.add(ed);
    let amounts = new Map(session.plan.contours.filter(c => c.distance).map(c => [c.key, c.distance]));
    // Requested edits and the active source target must survive a failed result.
    // Only refresh's validated result may replace the last valid cut preview.
    let editingTarget = amounts.keys().next().value ?? '';
    let hasValidPreview = false;
    let requestError = '';
    const exclusions = new Map<number, TrimmedOffsetSpan[]>(session.sources.map(s => [s.id, structuredClone(s.excluded ?? [])]));
    const removals = new Set(session.sources.flatMap(s => (s.trimmed ?? []).map(span => offsetRemainderKey(s.id, span))));
    const assemblyOwners = new Map(session.sources.flatMap(s => s.edits.flatMap(e => e.outputOwner === undefined ? [] : [[e.token, e.outputOwner] as const])));
    let endpoint: OffsetSourceHit | undefined, hoverEndpoint: OffsetSourceHit | undefined, frozen = false, arcIndex = 0;
    const first = amounts.values().next().value as number | undefined;
    const title = h('h3', { id: 'contour-offset-title' }, t('Lokaler Konturversatz'));
    const dlg = h('dialog', { class: 'outline-dialog outline-tool-window contour-offset-dialog', 'aria-labelledby': title.id });
    const magnitude = h('input', { id: 'contour-offset-distance', type: 'number', min: 0.001, max: 20, step: 0.01, value: String(Math.abs(first ?? 0.2)) });
    const direction = h('select', { id: 'contour-offset-direction' },
      h('option', { value: '-1', selected: first === undefined || first < 0 }, t('Innen – eingeschlossene Fläche verkleinern')),
      h('option', { value: '1', selected: first !== undefined && first > 0 }, t('Außen – eingeschlossene Fläche vergrößern')));
    const tolerance = h('input', { id: 'contour-offset-tolerance', type: 'number', min: 0, max: 0.5, step: 0.01, value: String(session.tolerance) });
    const permanent = h('input', { id: 'contour-offset-permanent', type: 'checkbox' });
    const choices = h('div', { id: 'contour-offset-contours', class: 'outline-choices' });
    const mode = h('select', { id: 'contour-offset-mode' },
      h('option', { value: 'contours', selected: !amounts.size }, t('Konturen wählen')),
      h('option', { value: 'exclude', selected: !!amounts.size }, t('Abschnitte per Klick ausschließen')),
      h('option', { value: 'endpoints' }, t('Erweitert: zwei Bereichsgrenzen wählen')));
    const excludedChoices = h('div', { id: 'contour-offset-exclusions', class: 'outline-choices' });
    const targetContour = h('select', { id: 'contour-offset-exclusion-contour' });
    const targetSource = h('select', { id: 'contour-offset-exclusion-source' });
    const assemblyOwner = h('select', { id: 'contour-offset-assembly-owner' });
    const assemblyEnabled = h('input', { id: 'contour-offset-assembly', type: 'checkbox' });
    const assemblyInfo = h('p', { id: 'contour-offset-assembly-info', class: 'note' });
    const assemblyControls = h('div', { id: 'contour-offset-assembly-controls' },
      h('p', { class: 'note' }, t('Diese Kontur verwendet mehrere Quellobjekte. Ein gemeinsames geschlossenes Ergebnis ersetzt nur die beteiligten Quellabschnitte. Originaldefinitionen und Gruppen bleiben erhalten.')),
      h('label', { for: assemblyOwner.id }, t('Ausgabeobjekt und dessen Layer-Einstellungen')), assemblyOwner,
      h('label', { class: 'check' }, assemblyEnabled, t('Gemeinsames geschlossenes Ergebnis verwenden')), assemblyInfo);
    const targetSection = h('select', { id: 'contour-offset-exclusion-section' });
    let sections: OffsetSection[] = [], hoveredSection: OffsetSection | undefined;
    let sectionContour = '', sectionPlan = session.plan;
    const sectionHint = h('p', { id: 'contour-offset-section-hint', class: 'note' },
      t('Zuerst Kontur wählen. Dann über einen Abschnitt fahren: Rot zeigt den vollständigen Bereich vor dem Klick. Ein Klick schaltet den Ausschluss um. Bei mehreren Treffern Abschnitt ausdrücklich wählen.'));
    const advancedHint = h('p', { class: 'note' }, t('Erweitert: Kontur und Quelle festlegen, dann zwei Grenzen wählen. Rot vorab prüfen und übernehmen. Bei geschlossenen Pfaden ist der andere Bogen ausdrücklich wählbar. Gerade Übergänge werden mitgeschnitten.'));
    const sourceLabel = h('label', { for: targetSource.id }, t('Quellpfad für Ausnahme'));
    const sectionLabel = h('label', { for: targetSection.id }, t('Abschnitt'));
    const swapArc = h('button', { id: 'contour-offset-swap-arc', class: 'btn', disabled: true,
      onclick: () => { arcIndex = 1 - arcIndex; showInterval(); } }, t('Anderen Bogen wählen'));
    const acceptInterval = h('button', { id: 'contour-offset-add-exclusion', class: 'btn', disabled: true,
      onclick: () => commitInterval() }, t('Roten Bereich übernehmen'));
    const remainderChoices = h('div', { id: 'contour-offset-remainders', class: 'outline-choices' });
    const info = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
    const requestStatus = h('p', { id: 'contour-offset-request-status', class: 'note', role: 'status', 'aria-live': 'polite' });
    const cancelEndpoint = h('button', { id: 'contour-offset-cancel-endpoint', class: 'btn', disabled: true,
      onclick: () => { resetInterval(); refresh(); } }, t('Bereichsauswahl neu beginnen'));
    const apply = h('button', { class: 'btn primary' }, t('Anwenden'));
    let manufacturingWarnings = false;
    let openSourceWarnings = false;
    let valid = true, topologyValid = true, topologyError = '', applying = false, disposed = false;
    const selectedAmount = () => magnitude.valueAsNumber * Number(direction.value);
    const sourceChoices = () => offsetSelectionSources(session.sources, session.plan, targetContour.value);
    const currentSource = () => sourceChoices().find(s => `${s.id}:${s.sub}` === targetSource.value);
    const editableTarget = () => topologyValid && session.plan.contours.some(c => c.key === editingTarget && !c.blocked);
    const requestTarget = () => { if (!amounts.has(editingTarget)) amounts.set(editingTarget, selectedAmount()); };
    const resetInterval = () => {
      endpoint = undefined; hoverEndpoint = undefined; frozen = false; arcIndex = 0;
      hoveredSection = undefined;
      preview.markers = []; cancelEndpoint.disabled = true; swapArc.disabled = true; acceptInterval.disabled = true;
      targetContour.disabled = false; targetSource.disabled = false;
    };
    const listSections = () => {
      if (sectionContour === targetContour.value && sectionPlan === session.plan) return;
      sectionContour = targetContour.value; sectionPlan = session.plan;
      sections = sectionContour ? offsetContourSections(session.sources, session.plan, sectionContour, session.tolerance) : [];
      targetSection.replaceChildren(h('option', { value: '' }, t('Abschnitt bei Mehrdeutigkeit wählen')), ...sections.map((s, i) =>
        h('option', { value: s.key }, t('Abschnitt {n} · Objekt {id}, Teilpfad {sub}', { n: i + 1, id: s.id, sub: s.sub + 1 }) +
          (s.toleranceOnly ? ` — ${t('Nur über Verbindungstoleranz verbunden')}` : ''))));
    };
    const listSources = () => {
      const previous = targetSource.value;
      targetSource.replaceChildren(...sourceChoices().map(s => h('option', { value: `${s.id}:${s.sub}` },
        t('Quelle · Objekt {id}, Teilpfad {sub}', { id: s.id, sub: s.sub + 1 }))));
      if (sourceChoices().some(s => `${s.id}:${s.sub}` === previous)) targetSource.value = previous;
    };
    const listTargets = () => {
      targetContour.replaceChildren(...session.plan.contours.flatMap((c, i) => !c.blocked ?
        [h('option', { value: c.key }, t('Kontur {n}', { n: i + 1 }))] : []));
      if (session.plan.contours.some(c => c.key === editingTarget && !c.blocked)) targetContour.value = editingTarget;
      editingTarget = targetContour.value;
      listSources();
      listSections();
      const contour = session.plan.contours.find(c => c.key === editingTarget);
      const ids = [...new Set(contour?.members.map(m => session.sources[m.owner].id) ?? [])];
      assemblyControls.hidden = ids.length < 2;
      const selected = assemblyOwners.get(editingTarget), previous = assemblyOwner.value;
      assemblyOwner.replaceChildren(h('option', { value: '' }, t('Ausgabeobjekt ausdrücklich wählen')), ...ids.map(id => {
        const obj = session.leaves.find(o => o.id === id)!;
        const layer = session.doc.layers[obj.layer] ?? defaultLayer(obj.layer);
        return h('option', { value: String(id) }, t('Objekt {id} · Layer {layer}', { id, layer: layer.name }));
      }));
      if (selected !== undefined) assemblyOwner.value = String(selected);
      else if (ids.includes(Number(previous))) assemblyOwner.value = previous;
      assemblyEnabled.checked = selected !== undefined;
      assemblyEnabled.disabled = !assemblyOwner.value;
      const obj = session.leaves.find(o => o.id === Number(assemblyOwner.value));
      const layer = obj && (session.doc.layers[obj.layer] ?? defaultLayer(obj.layer));
      assemblyInfo.textContent = layer ? t('Gemeinsames Ergebnis: Modus {mode}, Kerf {kerf} mm, Geschwindigkeit {speed}, Leistung {power} %. Auch Unterlayer-Einstellungen des Ausgabeobjekts gelten.',
        { mode: layer.mode === 'line' ? t('Linie') : t('Füllen'), kerf: layer.kerf, speed: layer.speed, power: layer.power }) : t('Ohne gewähltes Ausgabeobjekt wird keine gemeinsame Ausgabekontur erzeugt.');
    };
    const arcs = () => {
      const choice = currentSource(), source = session.sources.find(s => s.id === choice?.id);
      return source && choice && endpoint && hoverEndpoint ? offsetSelectionArcs(source, choice, endpoint.u, hoverEndpoint.u) : [];
    };
    const showInterval = () => {
      const routes = arcs(), route = routes[arcIndex];
      const active = activeOffsetExclusions(session.sources, session.plan, amounts, exclusions);
      preview.excluded = offsetExcludedPaths(session.sources, active);
      // Never paint an unselected portion as an actual exclusion, even in preview.
      if (route?.allowed && endpoint) preview.excluded.push(...offsetExcludedPaths(session.sources, new Map([[endpoint.id, route.spans]])));
      preview.markers = endpoint ? [endpoint.point, ...(hoverEndpoint ? [hoverEndpoint.point] : [])] : [];
      swapArc.disabled = routes.length !== 2;
      acceptInterval.disabled = !frozen || !route?.allowed;
      apply.disabled = !valid || !!endpoint || (!amounts.size && !session.sources.some(s => s.edits.length));
      if (endpoint) info.textContent = route && !route.allowed ? t('Dieser Bogen verlässt die gewählte Kontur. Anderen Bogen oder andere Grenzen wählen.') :
        frozen ? t('Roten Bereich prüfen, bei geschlossenen Pfaden gegebenenfalls den Bogen wechseln und dann übernehmen.') :
        t('Endpunkt bewegen: Rot zeigt den Bereich vor dem zweiten Klick. Knoten und erkannte Konturgrenzen rasten ein.');
      ed.redraw();
    };
    const commitInterval = () => {
      const route = arcs()[arcIndex];
      if (!endpoint || !route?.allowed || !frozen || !editableTarget()) return;
      requestTarget();
      exclusions.set(endpoint.id, [...(exclusions.get(endpoint.id) ?? []), ...route.spans]);
      resetInterval(); refresh();
    };
    const faces = () => session.plan.contours.map(c => ({ layer: 0, subs: [{ closed: true, nodes: c.points }] }));
    const showSection = (section?: OffsetSection) => {
      hoveredSection = section;
      preview.excluded = offsetExcludedPaths(session.sources, activeOffsetExclusions(session.sources, session.plan, amounts, exclusions));
      if (section) {
        preview.excluded.push(...offsetExcludedPaths(session.sources, new Map([[section.id, section.spans]])));
        info.textContent = section.wholeContour ? t('Ohne Abzweigung: Klick entfernt den Versatz dieser ganzen Kontur; die Quelle bleibt unverändert.') :
          section.toleranceOnly ? t('Dieser Abschnitt endet an einer nur über die eingestellte Toleranz verbundenen Stelle. Die Quellgeometrie wird nicht verschoben.') :
          t('Roten Abschnitt anklicken, um den Ausschluss umzuschalten.');
      }
      ed.redraw();
    };
    const sectionAt = (p: { x: number; y: number }) => {
      const hits = pickOffsetSections(session.sources, sections, p, 10 / ed.view.zoom);
      // A clearly nearer section is safe; shared endpoints/coincident alternatives
      // require an explicit section choice rather than an arbitrary nearest owner.
      const candidates = hits.filter(h => h.d <= (hits[0]?.d ?? 0) + 1 / ed.view.zoom);
      if (candidates.length === 1) return candidates[0].section;
      const explicit = candidates.find(h => h.section.key === targetSection.value)?.section;
      if (candidates.length > 1 && !explicit) info.textContent = t('Mehrere Abschnitte unter dem Zeiger. Abschnitt in der Liste ausdrücklich wählen.');
      return explicit;
    };
    const commitSection = (section: OffsetSection) => {
      if (!topologyValid) { info.textContent = topologyError; return; }
      if (!editableTarget()) return;
      if (section.wholeContour) amounts.delete(editingTarget);
      else { requestTarget(); exclusions.set(section.id, toggleOffsetSection(section, exclusions.get(section.id) ?? [])); }
      resetInterval(); refresh();
    };
    const locate = (x: number, y: number) => {
      const candidates = faces().flatMap((face, index) => {
        if (!regionContains(face, x, y)) return [];
        const p = face.subs[0].nodes;
        const area = Math.abs(p.reduce((a, v, i) => { const q = p[(i + 1) % p.length]; return a + v.x * q.y - q.x * v.y; }, 0));
        return [{ index, area }];
      }).sort((a, b) => a.area - b.area);
      return candidates[0]?.index ?? -1;
    };
    const preview: OutlinePreview = { subs: [], holes: [], hover: -1, original: [],
      pick: p => {
        if (mode.value === 'exclude') {
          const section = sectionAt(p);
          if (section) commitSection(section);
          return;
        }
        if (mode.value === 'endpoints') {
          const choice = currentSource();
          const hit = choice && pickOffsetSelection(session.sources, choice, p, 10 / ed.view.zoom, 8 / ed.view.zoom);
          if (!hit) { info.textContent = t('Anfang und Ende auf derselben Original-Teilkontur anklicken.'); return; }
          if (!endpoint) {
            endpoint = hit; hoverEndpoint = undefined; frozen = false; arcIndex = 0;
            cancelEndpoint.disabled = false; targetContour.disabled = true; targetSource.disabled = true;
          } else { hoverEndpoint = hit; frozen = true; }
          showInterval(); return;
        }
        const i = locate(p.x, p.y); if (i < 0) return;
        if (session.plan.contours[i].blocked) { info.textContent = session.plan.contours[i].blocked!; return; }
        toggle(i);
      },
      move: p => {
        if (mode.value === 'exclude') {
          preview.hover = -1;
          showSection(sectionAt(p));
          return;
        }
        if (mode.value === 'endpoints') {
          preview.hover = -1;
          if (endpoint && !frozen) {
            const choice = currentSource();
            hoverEndpoint = choice && pickOffsetSelection(session.sources, choice, p, 10 / ed.view.zoom, 8 / ed.view.zoom);
            showInterval();
          }
          return;
        }
        const index = locate(p.x, p.y); if (preview.hover !== index) { preview.hover = index; ed.redraw(); }
      },
      cancel: () => dlg.close(),
    };
    const toggle = (index: number) => {
      const contour = session.plan.contours[index];
      if (!topologyValid || contour.blocked) return;
      editingTarget = contour.key;
      if (amounts.has(contour.key)) amounts.delete(contour.key); else amounts.set(contour.key, selectedAmount());
      resetInterval(); refresh();
    };
    const list = () => {
      choices.replaceChildren();
      session.plan.contours.forEach((c, i) => {
        const checkbox = h('input', { type: 'checkbox', checked: amounts.has(c.key), disabled: !!c.blocked, title: c.blocked ?? '', onchange: () => {
          toggle(i);
        } });
        const ids = [...new Set(c.members.map(m => session.sources[m.owner].id))].join(', ');
        choices.append(h('label', { class: 'check', title: c.blocked ?? '' }, checkbox, t('Kontur {n} · Quellobjekte {ids}', { n: i + 1, ids: ids || '—' }),
          c.blocked ? ` — ${c.blocked}` : c.legacy ? ` — ${t('Bestehender Versatz')}` : '',
          !valid && amounts.has(c.key) ? ` — ${t('Angefordert; Gesamtprüfung ausstehend')}` : ''));
      });
    };
    const updateRequestStatus = () => {
      requestStatus.textContent = valid ? openSourceWarnings ? t('Achtung: Verbleibende Quellreste werden offene Linien. Darauf wirkt kein Layer-Kerf; die gemeinsame Ergebniskontur bleibt geschlossen. Diese Änderung muss bestätigt werden.') : '' : hasValidPreview ?
        t('Anforderung ausstehend. Türkis: letzte gültige Vorschau, nicht die aktuelle Anforderung. Rot: angeforderte Ausschlüsse. Anwenden ist gesperrt; Abschnitte bearbeiten oder Konturen abwählen.') :
        t('Anforderung ausstehend; noch keine gültige Vorschau. Rot: angeforderte Ausschlüsse. Anwenden ist gesperrt; Abschnitte bearbeiten oder Konturen abwählen.');
      if (!valid && requestError) requestStatus.textContent = requestError + ' ' + requestStatus.textContent;
      choices.querySelectorAll<HTMLInputElement>('input').forEach((box, index) => {
        const contour = session.plan.contours[index];
        box.checked = amounts.has(contour.key);
        box.title = !valid && box.checked ? t('Angefordert; Gesamtprüfung ausstehend') : contour.blocked ?? '';
      });
    };
    const refresh = () => {
      valid = true;
      requestError = '';
      let resultAvailable = false;
      manufacturingWarnings = false;
      openSourceWarnings = false;
      listTargets();
      targetSource.hidden = sourceLabel.hidden = advancedHint.hidden = mode.value !== 'endpoints';
      swapArc.hidden = acceptInterval.hidden = cancelEndpoint.hidden = mode.value !== 'endpoints';
      targetSection.hidden = sectionHint.hidden = sectionLabel.hidden = mode.value !== 'exclude';
      preview.holes = faces().map(face => face.subs);
      preview.original = faces().filter((_face, i) => amounts.has(session.plan.contours[i].key)).flatMap(face => face.subs);
      preview.excluded = offsetExcludedPaths(session.sources, activeOffsetExclusions(session.sources, session.plan, amounts, exclusions));
      excludedChoices.replaceChildren();
      for (const [id, spans] of exclusions) spans.forEach((span, index) => {
        excludedChoices.append(h('div', {}, t('Ausnahme · Objekt {id}, Teilpfad {sub}', { id, sub: span.sub + 1 }),
          h('button', { class: 'btn', onclick: () => { exclusions.set(id, spans.filter((_s, i) => i !== index)); refresh(); } }, t('Entfernen'))));
      });
      try {
        if (!topologyValid) throw new Error(topologyError);
        if (!Number.isFinite(magnitude.valueAsNumber) || magnitude.valueAsNumber < 0.001 || magnitude.valueAsNumber > 20 ||
          !Number.isFinite(tolerance.valueAsNumber) || tolerance.valueAsNumber < 0 || tolerance.valueAsNumber > 0.5) throw new Error(t('Abstand: 0,001 bis 20 mm; Verbindungstoleranz: 0 bis 0,5 mm.'));
        if (offsetAssemblyOutputConflict(session, assemblyOwners, amounts)) throw new Error(t('Gemeinsames Ergebnis gesperrt: Beteiligte Quellen haben unterschiedliche Laser-/Ausgabefreigaben. Diese zuerst ausdrücklich vereinheitlichen.'));
        const available = offsetResults(session.sources, session.plan, amounts, session.tolerance, new Set(), exclusions, assemblyOwners);
        const removable = new Set(available.remainders.filter(part => !part.protected).map(part => part.key));
        for (const key of removals) if (!removable.has(key)) removals.delete(key);
        const r = offsetResults(session.sources, session.plan, amounts, session.tolerance, removals, exclusions, assemblyOwners);
        resultAvailable = true;
        const assessment = assessOffsetOutput(session.sources, r.recipes, r.preview,
          session.leaves.map(o => ed.doc.layers[o.layer] ?? defaultLayer(o.layer)));
        openSourceWarnings = assessment.warnings.includes('open-source-remainders');
        if (!assessment.unsafe.length) {
          preview.subs = r.recipes.flatMap((recipe, i) => recipe ? recipe.result.map(path => offsetWorldPath(session.sources[i], path)) : []);
          hasValidPreview = preview.subs.length > 0;
        }
        preview.removed = r.remainders.filter(part => removals.has(part.key)).map(part => part.path);
        remainderChoices.replaceChildren();
        for (const part of r.remainders) {
          const box = h('input', { type: 'checkbox', checked: removals.has(part.key), disabled: part.protected,
            onchange: () => { if (box.checked) removals.add(part.key); else removals.delete(part.key); refresh(); } });
          remainderChoices.append(h('label', { class: 'check' }, box,
            t('Reststück · Objekt {id}, Teilpfad {sub}', { id: session.sources[part.owner].id, sub: part.sub + 1 }),
            part.protected ? ` — ${t('Geschützt')}` : ''));
        }
        if (assessment.unsafe.length) throw new Error(t('Ergebnis gesperrt: Der Versatz erzeugt neue offene oder unverbundene Konturen oder eine ungeklärte Kerf-/Füllwirkung. Problematische Kontur abwählen oder Reststücke gezielt prüfen.'));
        preview.original = faces().filter((_face, i) => amounts.has(session.plan.contours[i].key)).flatMap(face => face.subs);
        preview.holes = faces().map(face => face.subs);
        info.textContent = t('{chosen} von {total} Konturen versetzt; {unused} freie Linienenden. Erkennung wie beim Außenkontur-Werkzeug.',
          { chosen: amounts.size, total: session.plan.contours.length, unused: session.plan.unused });
        manufacturingWarnings = assessment.warnings.some(w => w === 'small-area' || w === 'narrow-span');
        if (manufacturingWarnings) {
          const area = Math.min(...assessment.metrics.map(m => m.areaMm2));
          const span = Math.min(...assessment.metrics.map(m => m.minSpanMm));
          info.textContent = t('Fertigung prüfen: kleinste Ergebnisfläche {area} mm², kleinste Ausdehnung {span} mm. Bereiche bis 3 mm² oder nahe der Schnittfugenbreite sind Warnfälle, keine allgemeine Verbotsgrenze. Nichts wird automatisch gelöscht.',
            { area: area.toPrecision(4), span: span.toPrecision(4) });
        }
      } catch (error) {
        valid = false;
        const reason = exclusionFailure(error);
        requestError = reason;
        info.textContent = preview.subs.length ? t('{reason} Letzte gültige Vorschau bleibt sichtbar; Anwenden ist gesperrt.', { reason }) : reason;
      }
      if (!resultAvailable) {
        preview.removed = [];
        remainderChoices.querySelectorAll<HTMLInputElement>('input').forEach(box => { box.disabled = true; });
      }
      updateRequestStatus();
      apply.disabled = !valid || !!endpoint || (!amounts.size && !session.sources.some(s => s.edits.length));
      if (endpoint) showInterval();
      ed.redraw();
    };
    const changedAmount = () => { for (const key of amounts.keys()) amounts.set(key, selectedAmount()); refresh(); };
    magnitude.addEventListener('input', changedAmount); direction.addEventListener('change', changedAmount);
    mode.addEventListener('change', () => { resetInterval(); preview.hover = -1; refresh(); });
    targetContour.addEventListener('change', () => { editingTarget = targetContour.value; resetInterval(); refresh(); });
    targetSource.addEventListener('change', () => { resetInterval(); showInterval(); });
    targetSection.addEventListener('change', () => showSection(sections.find(s => s.key === targetSection.value)));
    assemblyOwner.addEventListener('change', () => {
      if (assemblyEnabled.checked && assemblyOwner.value) assemblyOwners.set(editingTarget, Number(assemblyOwner.value));
      else if (!assemblyOwner.value) assemblyOwners.delete(editingTarget);
      refresh();
    });
    assemblyEnabled.addEventListener('change', () => {
      if (assemblyEnabled.checked && assemblyOwner.value) { assemblyOwners.set(editingTarget, Number(assemblyOwner.value)); requestTarget(); }
      else assemblyOwners.delete(editingTarget);
      resetInterval(); refresh();
    });
    tolerance.addEventListener('input', () => {
      try {
        ed.updateContourOffset(session, tolerance.valueAsNumber);
        sectionContour = '\0';
        topologyValid = true; topologyError = '';
        amounts = new Map(session.plan.contours.filter(c => c.distance).map(c => [c.key, c.distance]));
        assemblyOwners.clear();
        for (const source of session.sources) for (const edit of source.edits)
          if (edit.outputOwner !== undefined && session.plan.contours.some(c => c.key === edit.token)) assemblyOwners.set(edit.token, edit.outputOwner);
        editingTarget = amounts.keys().next().value ?? '';
        removals.clear(); resetInterval();
        preview.hover = -1; list(); refresh();
      } catch (error) {
        topologyValid = false; topologyError = error instanceof Error ? error.message : String(error);
        valid = false; apply.disabled = true;
        requestError = topologyError;
        updateRequestStatus();
        const reason = error instanceof Error ? error.message : String(error);
        info.textContent = preview.subs.length ? t('{reason} Letzte gültige Vorschau bleibt sichtbar; Anwenden ist gesperrt.', { reason }) : reason; ed.redraw();
      }
    });
    dlg.append(title,
      h('p', { class: 'note' }, t('Konturen auf der Arbeitsfläche anklicken oder unten wählen. Grau: Quelle. Türkis gestrichelt: Versatz. Jede Teilkontur bleibt bei ihrem ursprünglichen Objekt und ihrer Gruppe.')),
      h('div', { class: 'form' },
        h('label', { for: magnitude.id }, t('Abstand (mm)')), magnitude,
        h('label', { for: direction.id }, t('Richtung')), direction,
        h('label', { for: tolerance.id }, t('Verbindungstoleranz (mm)')), tolerance,
        h('label', { for: permanent.id }, t('Dauerhaft festschreiben (destruktiv)')), permanent),
      h('p', { class: 'note' }, t('Abstand und Richtung gelten für alle gewählten Konturen. Toleranzänderungen verwerfen die noch nicht angewandte Auswahl. Layer-Kerf und seine bisherige Ausgabesemantik bleiben unverändert.')),
      h('label', { for: mode.id }, t('Auswahlmodus')), mode,
      sectionHint,
      advancedHint,
      h('label', { for: targetContour.id }, t('Zielkontur für Ausnahme')), targetContour,
      assemblyControls,
      sourceLabel, targetSource,
      sectionLabel, targetSection,
       swapArc, acceptInterval, cancelEndpoint, info, requestStatus, choices, excludedChoices,
      h('h4', {}, t('Reststücke gezielt entfernen')), remainderChoices,
      h('p', { class: 'note' }, t('Markierte Reststücke werden orange gestrichelt dargestellt und erst nach Bestätigung entfernt. Geschützte Abschnitte bleiben erhalten.')),
      h('button', { class: 'btn', onclick: () => { amounts.clear(); resetInterval(); refresh(); } }, t('Alle lokalen Versätze entfernen')),
      h('p', { class: 'note' }, t('Standard: Originalform und Versatzrezept bleiben gespeichert. Dauerhaftes Festschreiben ersetzt nur die Geometrie im jeweiligen Quellobjekt. Knotenbearbeitung oder Zusammenführen ist dafür nicht nötig.')),
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), apply));
    apply.addEventListener('click', () => {
      if (apply.disabled) return;
      if (permanent.checked && !confirm(t('Konturversatz dauerhaft in den Quellobjekten festschreiben? Betroffene Formen werden Pfade; gespeicherte Originaldefinitionen und Versatzrezepte entfallen. Rückgängig stellt sie wieder her.'))) return;
      try {
        const activeAssemblies = [...assemblyOwners].filter(([key]) => amounts.has(key));
        const hostCounts = new Map<number, number>();
        for (const [, id] of activeAssemblies) hostCounts.set(id, (hostCounts.get(id) ?? 0) + 1);
        const outputSummary = [...hostCounts].map(([id, n]) => {
          const obj = session.leaves.find(o => o.id === id)!;
          const layer = session.doc.layers[obj.layer] ?? defaultLayer(obj.layer);
          return t('{n} Konturen über Objekt {id}: Layer {layer}, Modus {mode}, Kerf {kerf} mm, Geschwindigkeit {speed}, Leistung {power} %.',
            { n, id, layer: layer.name, mode: layer.mode === 'line' ? t('Linie') : t('Füllen'), kerf: layer.kerf, speed: layer.speed, power: layer.power });
        }).join('\n');
        if (activeAssemblies.length && !confirm(t('Gemeinsame geschlossene Konturen mit den angezeigten Einstellungen der gewählten Ausgabeobjekte erzeugen? Layer-Kerf, Füllen und Unterlayer wirken auf diese Ergebnisse. Ersetzte Quellabschnitte werden nicht zusätzlich ausgegeben.') +
          '\n\n' + outputSummary +
          (openSourceWarnings ? '\n\n' + t('Verbleibende Quellreste werden offene Linien ohne Layer-Kerf. Diese geänderte Ausgabewirkung ebenfalls bestätigen?') : ''))) return;
        if (manufacturingWarnings && !confirm(t('Das Ergebnis enthält sehr kleine oder schmale Bereiche. Herstellbarkeit anhand von Material, Schnittfuge und Maschine prüfen. Trotzdem anwenden?'))) return;
        if (removals.size && !confirm(t('Die orange markierten Reststücke aus dem Ergebnis entfernen? Die Originaldefinition bleibt im Rezept erhalten.'))) return;
        const closureKerf = offsetClosureOwners(session.plan, session.sources, amounts, assemblyOwners).some(owner => {
          const id = session.leaves[owner].layer;
          return Math.abs((ed.doc.layers[id] ?? defaultLayer(id)).kerf) > 1e-12;
        });
        if (closureKerf && !confirm(t('Neu geschlossene Konturen berücksichtigen den vorhandenen Layer-Kerf. Diese zusätzliche Ausgabewirkung bestätigen?'))) return;
        applying = true; ed.applyContourOffset(session, amounts, permanent.checked, permanent.checked,
          { exclusions, removeRemainders: removals, assemblyOwners, confirmedAssembly: true, confirmedOpenRemainders: openSourceWarnings, confirmedRemainderRemoval: true, confirmedClosureKerf: true, confirmedManufacturability: manufacturingWarnings }); dlg.close();
      } catch (error) { applying = false; info.textContent = error instanceof Error ? error.message : String(error); }
    });
    let disposeWindow = () => {};
    const changed = (what: string) => { if (!applying && ['doc', 'sel', 'tool'].includes(what)) dlg.close(); };
    const leave = () => { preview.hover = -1; if (mode.value === 'exclude' && hoveredSection) showSection(); else ed.redraw(); };
    const cleanup = () => {
      if (disposed) return; disposed = true;
      ed.off(changed); ed.canvas.removeEventListener('pointerleave', leave); disposeWindow();
      if (ed.outlinePreview === preview) ed.outlinePreview = null;
      ed.canvas.style.cursor = ed.tool === 'select' ? 'default' : 'crosshair';
      open.delete(ed); dlg.remove(); ed.redraw();
    };
    dlg.addEventListener('close', cleanup);
    dlg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); dlg.close(); } });
    document.body.append(dlg); dlg.show(); ed.outlinePreview = preview;
    ed.on(changed); ed.canvas.addEventListener('pointerleave', leave);
    disposeWindow = movableToolWindow(dlg, title, () => {}); list(); refresh();
  } catch (error) { open.delete(ed); ed.hint = error instanceof Error ? error.message : String(error); ed.emit('tool'); }
}
