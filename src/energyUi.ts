import { h } from './dom';
import { t } from './i18n';
import { ELECTRICITY_CURRENCIES, electricityCurrency, electricityTariffText, EnergySettings, estimateEnergy, formatCost, formatEnergyValue, parseEnergyNumber, setElectricityCurrency, setElectricityTariffText } from './energy';
import type { SelectField, TextField } from './settings/registry';

const numberHint = () => t('Geben Sie eine nicht negative elektrische Leistung in Watt ein. Lassen Sie unbekannte Werte leer; geben Sie 0 nur bei einem bekannten Nullwert ein.');
let fieldId = 0;

export function electricityCurrencyField(): SelectField {
  return {
    kind: 'select', id: 'general.electricityCurrency', label: t('Währung für Stromkosten'),
    hint: t('Währung der Kostenanzeige in der Vorschau. Der Tarif selbst bleibt ein reiner Zahlenwert pro kWh.'),
    options: () => ELECTRICITY_CURRENCIES.map((c) => [c, c] as [string, string]),
    get: electricityCurrency, set: setElectricityCurrency,
  };
}

export function electricityTariffField(): TextField {
  const cur = electricityCurrency();
  return {
    kind: 'text', id: 'general.electricityTariff', label: t('Stromtarif ({cur}/kWh)', { cur }),
    hint: t('Geben Sie einen nicht negativen Preis pro kWh ein (Punkt oder Komma). Bei unbekanntem Tarif leer lassen; 0 bedeutet kostenlosen Strom. Ungültige oder fehlende Werte blenden die Kosten aus, nicht die Energie.'),
    get: electricityTariffText, set: setElectricityTariffText,
  };
}

/** The device dialog must pass this guard before writing any part of its draft. */
export function saveEnergySettings(rows: HTMLElement[], showInvalid: (input: HTMLInputElement) => void, save: () => void): boolean {
  const invalid = rows.flatMap(row => [row, ...row.querySelectorAll('input')])
    .find((el): el is HTMLInputElement => el.tagName === 'INPUT' && !(el as HTMLInputElement).validity.valid);
  if (invalid) {
    showInvalid(invalid);
    invalid.reportValidity();
    invalid.focus();
    return false;
  }
  save();
  return true;
}

/** Controls only change the caller's detached device draft; saving belongs to the device dialog. */
export function energySettingsRows(settings: EnergySettings): HTMLElement[] {
  const rows: HTMLElement[] = [];
  const errors = new WeakMap<HTMLElement, HTMLElement>();
  const field = (label: string, control: HTMLElement, into = rows) => {
    control.id = `energy-field-${++fieldId}`;
    control.classList.add('energy-control');
    const error = errors.get(control);
    into.push(h('label', { for: control.id }, label), error ? h('div', {}, control, error) : control);
  };
  const watts = (value: number | null, set: (v: number | null) => void) => {
    const error = h('div', { id: `energy-error-${++fieldId}`, class: 'note error', role: 'alert', hidden: true });
    const input = h('input', {
      type: 'number', min: '0', step: 'any', value: value === null ? '' : String(value), title: numberHint(),
      'aria-describedby': error.id,
      oninput: () => {
        const parsed = parseEnergyNumber(input.value);
        const invalid = input.validity.badInput || (input.value !== '' && parsed === null);
        const message = invalid ? t('Die elektrische Leistung muss eine endliche, nicht negative Zahl sein. Geben Sie 0 oder einen positiven Wert ein, oder leeren Sie das Feld bei unbekanntem Wert.') : '';
        input.setCustomValidity(message);
        input.setAttribute('aria-invalid', String(invalid));
        error.textContent = message;
        error.hidden = !invalid;
        if (!invalid) set(parsed);
      },
    });
    errors.set(input, error);
    return input;
  };
  rows.push(h('div', { class: 'note wide' }, numberHint()));
  field(t('Elektrische Grundleistung der Maschine (W), ohne Laser und Zubehör'), watts(settings.baseWatts, v => settings.baseWatts = v));
  const labels = [t('Zusätzliche elektrische Laserleistung bei 0% (W)'), t('Zusätzliche elektrische Laserleistung bei 50% (W)'), t('Zusätzliche elektrische Laserleistung bei 100% (W)')];
  labels.forEach((label, i) => field(label, watts(settings.laserWatts[i], v => settings.laserWatts[i] = v)));
  rows.push(h('div', { class: 'note wide' }, t('Der 0%-Wert ist der Bereitschaftsverbrauch des Lasers während des gesamten Auftrags. Werte zwischen 0%, 50% und 100% werden linear interpoliert. Geben Sie keine optische Ausgangsleistung ein.')));
  const list = h('div', { class: 'wide' });
  const groups = new WeakMap<EnergySettings['consumers'][number], HTMLElement>();
  const render = () => {
    list.replaceChildren();
    settings.consumers.forEach((consumer, index) => {
      const existing = groups.get(consumer);
      if (existing) {
        existing.querySelector('legend')!.textContent = t('Zubehör {n}', { n: index + 1 });
        list.append(existing);
        return;
      }
      const fields: HTMLElement[] = [];
      field(t('Zubehörname'), h('input', { type: 'text', value: consumer.name, oninput: (e: Event) => consumer.name = (e.target as HTMLInputElement).value }), fields);
      field(t('In Schätzung einbeziehen'), h('input', { type: 'checkbox', checked: consumer.included, onchange: (e: Event) => consumer.included = (e.target as HTMLInputElement).checked }), fields);
      field(t('Elektrische Leistung (W)'), watts(consumer.watts, v => consumer.watts = v), fields);
      field(t('Betriebsregel'), h('select', { onchange: (e: Event) => consumer.rule = (e.target as HTMLSelectElement).value as typeof consumer.rule },
        h('option', { value: '', selected: !['job', 'laser', 'air'].includes(consumer.rule), disabled: true }, t('Betriebsregel wählen')),
        h('option', { value: 'job', selected: consumer.rule === 'job' }, t('Gesamter Auftrag')),
        h('option', { value: 'laser', selected: consumer.rule === 'laser' }, t('Laser aktiv')),
        h('option', { value: 'air', selected: consumer.rule === 'air' }, t('Luftunterstützung eingeschaltet'))), fields);
      const group = h('fieldset', {}, h('legend', {}, t('Zubehör {n}', { n: index + 1 })), h('div', { class: 'form' }, ...fields),
        h('button', { type: 'button', class: 'btn small', onclick: () => { settings.consumers.splice(settings.consumers.indexOf(consumer), 1); render(); add.focus(); } }, t('Zubehör entfernen')));
      groups.set(consumer, group);
      list.append(group);
    });
  };
  const add = h('button', { type: 'button', class: 'btn small', onclick: () => {
    settings.consumers.push({ name: '', watts: null, included: true, rule: 'job' }); render();
    list.lastElementChild?.querySelector('input')?.focus();
  } }, t('Zubehör hinzufügen'));
  render();
  rows.push(list, add, h('div', { class: 'note wide' }, t('Ausgeschlossenes Zubehör wird gespeichert, aber nicht einbezogen. Geben Sie bei einem Kompressor mit Druckluftbehälter die durchschnittliche elektrische Leistung während der Luftunterstützung einschließlich seiner Einschaltdauer ein. Vor- und Nachlaufzeiten werden nicht berücksichtigt.')));
  return rows;
}

export function energyPreview(result: ReturnType<typeof estimateEnergy>, tariff: number | null): HTMLElement {
  const cur = electricityCurrency();
  const values = (value: number | null, included = true) => {
    if (!included || value === null) return [h('td', { class: 'energy-state', colspan: tariff === null ? 1 : 2 }, included ? t('Unbekannt') : t('Nicht einbezogen'))];
    return [h('td', {}, formatEnergyValue(value, 4)),
      ...(tariff === null ? [] : [h('td', {}, formatCost(value * tariff, cur))])];
  };
  return h('div', { class: 'energy-preview' }, h('h4', {}, t('Geschätzte Energie und Kosten')),
    h('table', { class: 'energy-breakdown', 'aria-label': t('Geschätzte Energie und Kosten') },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('Komponente')),
        h('th', { scope: 'col' }, t('Verbrauch (kWh)')),
        ...(tariff === null ? [] : [h('th', { scope: 'col' }, t('Kosten ({cur})', { cur }))]))),
      h('tbody', {}, ...result.components.map((component, i) => h('tr', {},
        h('th', { scope: 'row' }, i === 0 ? t('Maschinengrundverbrauch') : i === 1 ? t('Elektrischer Laserverbrauch') : component.name || t('Unbenanntes Zubehör')),
        ...values(component.kWh, component.included)))),
      h('tfoot', {}, h('tr', {}, h('th', { scope: 'row' }, t('Gesamt')), ...values(result.total)))),
    ...(result.total === null ? [h('div', { class: 'note' }, t('Konfiguration unvollständig. Ergänzen Sie die Werte unter Geräteeinstellungen → Energie.'))] : []),
    ...(tariff === null ? [h('div', { class: 'note' }, t('Legen Sie in den allgemeinen Einstellungen einen gültigen Stromtarif fest, um Kosten anzuzeigen.'))] : []),
    h('p', { class: 'note energy-caveat' }, t('Modellschätzung, keine Messung. Tatsächlicher Verbrauch und Kosten können abweichen.')),
    h('details', { class: 'energy-help' }, h('summary', {}, t('Berechnung und Grenzen')),
      h('p', { class: 'note' }, t('Modellschätzung, keine Messung. Verwendet die geschätzte XY-Bewegungszeit und die vorgegebene Laserleistung, nicht die tatsächliche dynamische Laserleistung. Skripte, Z-Bewegungen, Verweilzeiten, Controller-Verzögerungen sowie Vor- und Nachlaufzeiten sind ausgeschlossen. Die Luftunterstützungszeit folgt der Layer-Umschaltung des Auftrags, einschließlich Leerfahrten auf diesen Layern.')),
      h('p', { class: 'note' }, t('Unbekannt — gültige elektrische Leistung und Betriebsregel eingeben'))));
}
