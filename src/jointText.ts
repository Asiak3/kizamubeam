// Texts of the joint messages (jointsGeom.ts): problems and notes of the Joint tool and of host.joints (#398).
import { dec, t, tn } from './i18n';
import type { JointMsg } from './jointsGeom';

const fmt = (v: number) => dec(String(Math.round(v * 100) / 100));

/** Text of one joint message; undefined for an unknown code */
export function jointText(m: JointMsg): string | undefined {
  const v = m.values ?? {};
  const num = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : 0);
  const f = (k: string) => fmt(num(k));
  const n = num('n');
  switch (m.code) {
    case 'no-edge': return t('Keine Kante gewählt.');
    case 'same-edge': return t('Zweimal dieselbe Kante gewählt.');
    case 'thickness': return t('Materialdicke muss größer als 0 sein.');
    case 'fingers-narrow': return t('Zinken zu schmal für Kerf und Spiel.');
    case 'slots-narrow': return t('Schlitze zu schmal für Kerf und Spiel.');
    case 'lap-closed': return t('Überblattung braucht Kanten geschlossener Formen.');
    case 'lap-many': return t('Zu viele Schlitze für die Kantenlänge.');
    case 'lap-opposite': return t('Gegenüberliegende Kante nicht gefunden.');
    case 'hinge-two': return t('Scharnier braucht zwei Kanten: erst die Oberkante der Rückwand, dann die Hinterkante des Deckels.');
    case 'hinge-closed': return t('Scharnier braucht Kanten geschlossener Formen (Rückwand und Deckel).');
    case 'hinge-same': return t('Rückwand und Deckel müssen zwei verschiedene Teile sein.');
    case 'pin-dia': return t('Stiftdurchmesser muss größer als 0 sein.');
    case 'hinge-wall': return t('Wandstärke um den Stift muss größer als 0 sein.');
    case 'pin-hole': return t('Stiftloch zu klein für den Kerf.');
    case 'slots-small': return t('Schlitze zu klein für Kerf und Spiel.');
    case 'eye-weak': return t('Auge zu schwach: Stift oder Wandstärke größer wählen (Auge muss mindestens 1 mm über den Deckel ragen).');
    case 'hinge-many': return t('Zu viele Knöchel für die Kantenlänge (zwischen zwei Knöcheln muss mindestens 0,5 mm Luft bleiben).');
    case 'tenons-fit': return t('Zapfen passen nicht auf die Kante (Anzahl × Breite zu groß).');
    case 'wedge-width': return t('Keilbreite muss größer als 0 sein.');
    case 'wedge-narrow': return t('Zapfen zu schmal für das Keilloch (mindestens Materialdicke + 4 mm).');
    case 'tslot-two': return t('T-Slot braucht mindestens 2 Zapfen; die Schrauben sitzen zwischen den Zapfen.');
    case 'tslot-nut': return t('Schraube und Mutter: Schlüsselweite muss größer als der Schraubendurchmesser sein.');
    case 'tslot-short': return t('Schraube zu kurz für die Materialdicke.');
    case 'tslot-room': return t('Kein Platz für die Mutter zwischen den Zapfen (weniger oder schmalere Zapfen).');
    case 'snap-lip': return t('Rasthaken: Überstand und Länge müssen größer als 0 sein.');
    case 'snap-narrow': return t('Schnappzapfen zu schmal für den Rasthaken-Überstand.');
    case 'hook-length': return t('Hakenlänge muss größer als 0 sein.');
    case 'finger-info': return tn('{n} Feld à {width} mm', '{n} Felder à {width} mm', n, { width: f('width') });
    case 'lengths-differ':
      return t('. Kanten unterschiedlich lang ({len} / {len2} mm): Muster liegt mittig auf {pattern} mm', { len: f('len'), len2: f('len2'), pattern: f('pattern') });
    case 'lap-info': {
      const depth = ['depth', 'depth2'].filter((k) => typeof v[k] === 'number').map((k) => `${f(k)} mm`).join(' / ');
      return tn('{n} Schlitz je Kante, {width} mm breit, {depth} tief', '{n} Schlitze je Kante, {width} mm breit, {depth} tief', n, { width: f('width'), depth });
    }
    case 'hinge-info':
      return t('{nBox} Knöchel für den Kasten, {nLid} für den Deckel; Stift Ø {dia} mm, etwa {len} mm lang', { nBox: num('nBox'), nLid: num('nLid'), dia: f('dia'), len: f('len') });
    case 'hinge-lengths-differ':
      return t('. Kanten unterschiedlich lang ({len} / {len2} mm): Knöchel liegen mittig auf {pattern} mm', { len: f('len'), len2: f('len2'), pattern: f('pattern') });
    case 'hinge-corners': return t('. Achtung: die äußeren Knöchel sitzen sehr nah an den Ecken (Seitenwände!)');
    case 'tenon-info': {
      const name = { snap: t('Schnappzapfen'), hook: t('Hakenzapfen'), wedge: t('Keilzapfen') }[String(v.kind)] ?? t('Zapfen');
      return t('{n} {name} à {width} × {thickness} mm', { n, name, width: f('width'), thickness: f('thickness') });
    }
    case 'wedge-count': return tn(' mit {n} Keil', ' mit {n} Keilen', n);
    case 'tslot-info':
      return tn(', {n} T-Slot für Schraube Ø {dia} × {length} mm, Mutter {nutWidth} × {nutHeight} mm', ', {n} T-Slots für Schraube Ø {dia} × {length} mm, Mutter {nutWidth} × {nutHeight} mm', n, {
        dia: f('dia'), length: f('length'), nutWidth: f('nutWidth'), nutHeight: f('nutHeight'),
      });
    case 'slot-count': return tn(', {n} Schlitz', ', {n} Schlitze', n);
    case 'slot-short': return t('. Achtung: Schlitzlinie ({len} mm) kürzer als die Zapfenkante ({len2} mm)', { len: f('len'), len2: f('len2') });
    case 'slot-edge': return t('. Achtung: Schlitze reichen bis an die Kante');
    case 'bore-count': return tn(', {n} Bohrung', ', {n} Bohrungen', n);
    case 'hook-push': return t('. Einstecken, dann {hookLength} mm in Hakenrichtung schieben', { hookLength: f('hookLength') });
  }
  return undefined;
}

/** The info of a joint as one text (the notes follow each other like the parts of a sentence) */
export const jointInfoText = (info: JointMsg[]) => info.map((m) => jointText(m) ?? '').join('');
