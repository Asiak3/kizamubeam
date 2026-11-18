import type { Estimate, Job, Moves } from './gcode';
import { t } from './i18n';

export type OperatingRule = 'job' | 'laser' | 'air';
export interface EnergyConsumer {
  name: string;
  watts: number | null;
  included: boolean;
  rule: OperatingRule;
}
export interface EnergySettings {
  baseWatts: number | null;
  laserWatts: [number | null, number | null, number | null];
  consumers: EnergyConsumer[];
}
export const emptyEnergySettings = (): EnergySettings => ({ baseWatts: null, laserWatts: [null, null, null], consumers: [] });
/** A detached, validated draft also handles older devices and malformed imported values. */
export function energyDraft(value?: EnergySettings): EnergySettings {
  return {
    baseWatts: validWatts(value?.baseWatts) ? value.baseWatts : null,
    laserWatts: [0, 1, 2].map(i => validWatts(value?.laserWatts?.[i]) ? value!.laserWatts[i] : null) as EnergySettings['laserWatts'],
    consumers: Array.isArray(value?.consumers) ? value.consumers.filter(c => c && typeof c === 'object').map(c => ({
      name: typeof c.name === 'string' ? c.name : '', watts: validWatts(c.watts) ? c.watts : null,
      included: c.included !== false, rule: c.rule,
    })) : [],
  };
}
export function electricityTariffText(): string {
  try { return localStorage.getItem('kizamubeam.electricityTariff') ?? ''; } catch { return ''; }
}
/** ISO-4217-Auswahl für die Kostenanzeige; Default EUR, Fallback bei unbekanntem Wert. */
export const ELECTRICITY_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'CZK', 'SEK', 'JPY'] as const;
export type ElectricityCurrency = typeof ELECTRICITY_CURRENCIES[number];
export function electricityCurrency(): ElectricityCurrency {
  try {
    const v = localStorage.getItem('kizamubeam.electricityCurrency');
    if ((ELECTRICITY_CURRENCIES as readonly string[]).includes(v ?? '')) return v as ElectricityCurrency;
  } catch { /* storage unavailable */ }
  return 'EUR';
}
export function setElectricityCurrency(value: string): void {
  if (!(ELECTRICITY_CURRENCIES as readonly string[]).includes(value)) {
    throw new Error(t('Unbekannte Währung. Wählen Sie eine der angebotenen Währungen.'));
  }
  try { localStorage.setItem('kizamubeam.electricityCurrency', value); } catch { /* storage unavailable */ }
}
/** Kosten betragssprachig formatieren, mit Fallback ohne Intl. */
export function formatCost(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(document.documentElement.lang || undefined,
      { style: 'currency', currency }).format(value);
  } catch { return `${value.toFixed(2)} ${currency}`; }
}
export function setElectricityTariffText(value: string): void {
  if (value.trim() && parseEnergyNumber(value) === null) {
    throw new Error(t('Der Stromtarif muss eine endliche, nicht negative Zahl sein. Geben Sie 0 oder einen positiven Preis pro kWh ein (Punkt oder Komma), oder leeren Sie das Feld bei unbekanntem Tarif.'));
  }
  try { localStorage.setItem('kizamubeam.electricityTariff', value); } catch { /* storage unavailable */ }
}
export const validWatts = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function parseEnergyNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value.replace(/,/g, '.'));
  return validWatts(number) ? number : null;
}
export function laserElectricalWatts(power: number, points: [number, number, number]): number {
  const p = Math.max(0, Math.min(1, power)) * 2;
  return p <= 1 ? points[0] + (points[1] - points[0]) * p : points[1] + (points[2] - points[1]) * (p - 1);
}
export interface EnergyComponent {
  name: string;
  included: boolean;
  kWh: number | null;
}
export function estimateEnergy(moves: Moves, timing: Estimate, air: Job['air'], settings: EnergySettings) {
  const durations = { job: timing.total, laser: 0, air: 0 };
  const airLayers = new Set(air);
  const laserValid = settings.laserWatts.every(validWatts);
  let laserWs = 0;
  for (let i = 0; i < moves.n; i++) {
    const seconds = timing.t[i] - (i ? timing.t[i - 1] : 0);
    const power = moves.f[i] > 0 ? moves.s[i] : 0;
    if (power > 0) durations.laser += seconds;
    if (airLayers.has(moves.layer[i])) durations.air += seconds;
    if (laserValid) laserWs += seconds * laserElectricalWatts(power, settings.laserWatts as [number, number, number]);
  }
  const components: EnergyComponent[] = [
    { name: 'base', included: true, kWh: validWatts(settings.baseWatts) ? settings.baseWatts * durations.job / 3600000 : null },
    { name: 'laser', included: true, kWh: laserValid ? laserWs / 3600000 : null },
    ...settings.consumers.map(consumer => ({
      name: consumer.name,
      included: consumer.included,
      kWh: validWatts(consumer.watts) && ['job', 'laser', 'air'].includes(consumer.rule)
        ? consumer.watts * durations[consumer.rule] / 3600000 : null,
    })),
  ];
  const included = components.filter(component => component.included);
  return { durations, components, total: included.every(component => component.kWh !== null)
    ? included.reduce((sum, component) => sum + component.kWh!, 0) : null };
}

/** Keep tiny positive values visible rather than rounding them down to zero. */
export function formatEnergyValue(value: number, digits: number): string {
  const threshold = 10 ** -digits;
  return value > 0 && value < threshold ? `<${threshold.toFixed(digits)}` : value.toFixed(digits);
}
