// Werkzeugkasten: welche Generatoren und Werkzeuge als Kacheln erscheinen, in welcher Gruppe, mit welchem
// kurzen Namen, Erklärsatz und welchen Suchwörtern. Was eine Kachel tut (Symbol, Aufruf, ob sie gerade
// möglich ist), kommt von der gleichnamigen Aktion der Funktionsleisten (ui.ts, buildBars).
// Neues Werkzeug: Aktion in buildBars anlegen und hier eintragen; npm run test:apps prüft beides.
// Ohne DOM, damit die Tests in Node laufen.
import en from './locales/en.json';
import { t } from './i18n';

export type AppGroup = 'mech' | 'box' | 'model3d' | 'join' | 'arrange' | 'text' | 'image' | 'laser';

export interface AppGroupInfo {
  id: AppGroup;
  /** Überschrift der Gruppe */
  label: string;
  /** Kurzname für den Filterknopf */
  chip: string;
  /** Symbol vor der Überschrift (icons.ts) */
  icon: string;
}

export interface AppInfo {
  /** Kennung der Aktion in den Funktionsleisten */
  id: string;
  group: AppGroup;
  /** Name unter der Kachel */
  name: string;
  /** Ein Satz Erklärung (Tooltip) */
  desc: string;
  /** Weitere Suchwörter, durch Leerzeichen getrennt */
  keys: string;
  /** Version, mit der das Werkzeug dazukam (für die Markierung „NEU“); fehlt = schon lange da */
  since?: string;
}

/** Gruppen in der Reihenfolge im Fenster */
export const appGroups = (): AppGroupInfo[] => [
  { id: 'mech', label: t('Mechanik'), chip: t('Mechanik'), icon: 'gear' },
  { id: 'box', label: t('Boxen und Möbel'), chip: t('Boxen'), icon: 'box' },
  { id: 'model3d', label: t('3D-Steckmodelle'), chip: t('3D'), icon: 'discsphere' },
  { id: 'join', label: t('Verbindungen und Biegen'), chip: t('Verbindungen'), icon: 'joint' },
  { id: 'arrange', label: t('Vervielfältigen und Anordnen'), chip: t('Anordnen'), icon: 'gridArray' },
  { id: 'text', label: t('Text und Daten'), chip: t('Text'), icon: 'qr' },
  { id: 'image', label: t('Bild|Werkzeugkasten'), chip: t('Bild|Werkzeugkasten'), icon: 'image' },
  { id: 'laser', label: t('Laser und Kalibrieren'), chip: t('Laser'), icon: 'mattest' },
];

/**
 * Alle Kacheln. Der Parameter heißt absichtlich t: mit der echten Übersetzung ergibt das die Kacheln in der
 * Sprache der Oberfläche, mit der Identität die deutschen Quelltexte (für die Suche in beiden Sprachen);
 * npm run i18n:check findet die Texte so wie sonst auch.
 */
const rows = (t: (s: string) => string): AppInfo[] => [
  { id: 'gear', group: 'mech', name: t('Zahnrad'), desc: t('Evolventen-Zahnrad mit Modul, Zähnezahl, Bohrung und Speichen; Parameter bleiben änderbar.'), keys: t('Zahnrad Zähne Getriebe Evolvente Modul|Suchwörter') },
  { id: 'rack', group: 'mech', name: t('Zahnstange'), desc: t('Gerade Zahnstange, die zum Zahnrad mit gleichem Modul passt.'), keys: t('Zahnstange Linearantrieb Zahnrad|Suchwörter') },
  { id: 'pulley', group: 'mech', name: t('Riemenscheibe'), desc: t('Zahnriemenscheibe für GT2- oder HTD-Riemen, mit Bordscheiben.'), keys: t('Riemen Zahnriemen GT2 HTD Pulley|Suchwörter') },
  { id: 'cam', group: 'mech', name: t('Nocken'), desc: t('Nockenscheibe für Rolle oder Spitze mit Hub, Rast und Rückhub.'), keys: t('Nocke Kurvenscheibe Hub Exzenter Automat|Suchwörter') },
  { id: 'gearpair', group: 'mech', name: t('Zahnradpaar'), desc: t('Zwei passende Zahnräder mit Achsabstand und Grundplatte als Baugruppe.'), keys: t('Getriebe Übersetzung Zahnräder Achsabstand|Suchwörter') },
  { id: 'box', group: 'box', name: t('Box mit Fingerzinken'), desc: t('Kiste aus Platten mit Fingerzinken, mit oder ohne Deckel, als Baugruppe.'), keys: t('Kiste Kasten Gehäuse Schachtel Fingerzinken Deckel|Suchwörter') },
  { id: 'drawer', group: 'box', name: t('Schublade'), desc: t('Korpus, Schubkasten und Blende mit Griff als Baugruppe.'), keys: t('Schublade Schubfach Kommode Korpus|Suchwörter') },
  { id: 'insert', group: 'box', name: t('Einsatz mit Fächern'), desc: t('Gesteckte Trennstege, die eine Box oder Schublade in Fächer teilen.'), keys: t('Einsatz Fächer Trennwand Sortierkasten Box|Suchwörter') },
  { id: 'shelf', group: 'box', name: t('Steckregal'), desc: t('Regal aus Seiten und Böden, die ineinander gesteckt werden.'), keys: t('Regal Böden Stecksystem Möbel|Suchwörter') },
  { id: 'stack', group: 'model3d', name: t('Schichtmodell'), desc: t('3D-Modell (STL, OBJ) in gestapelte Scheiben zerlegen, die verleimt wieder das Modell ergeben.'), keys: t('3D STL OBJ Scheiben Schichten stapeln Slicer Skulptur Relief Kopf|Suchwörter'), since: '1.10.0' },
  { id: 'ribs', group: 'model3d', name: t('Rippenmodell'), desc: t('3D-Modell (STL, OBJ) als Rippen, die mit Schlitzen auf einem Rückgrat stecken.'), keys: t('3D STL OBJ Rippen Spanten Rückgrat Steckmodell Tier Figur Waffel|Suchwörter'), since: '1.16.0' },
  { id: 'discsphere', group: 'model3d', name: t('Scheibenkugel'), desc: t('Kugel oder Lampe aus Kreisscheiben, die sich über schräge Schlitze gegenseitig halten.'), keys: t('Lampe Kugel Scheiben Steckmodell Lampenschirm Polyeder Papier Karton|Suchwörter'), since: '1.10.0' },
  { id: 'lidhinge', group: 'box', name: t('Deckelscharnier'), desc: t('Scharnier zwischen Rückwand und Deckel einer Box: Knöchel, Schlitze und Stiftlöcher.'), keys: t('Scharnier Deckel Klappe Box Gelenk|Suchwörter') },
  { id: 'tool:joint', group: 'join', name: t('Verbindungen'), desc: t('Fingerzinken, Zapfen, Überblattung, Schnapp-, Haken-, Keil- oder T-Slot-Verbindung auf gerade Kanten.'), keys: t('Zinken Zapfen Schlitz Überblattung T-Slot Keil Holzverbindung|Suchwörter') },
  { id: 'hinge', group: 'join', name: t('Biegeschnitte'), desc: t('Schnittmuster, mit dem sich eine Platte biegen lässt (Living Hinge).'), keys: t('Living Hinge Biegen flexibel Muster Gelenk|Suchwörter') },
  { id: 'slots', group: 'join', name: t('Schlitze anpassen'), desc: t('Schlitze und Aussparungen auf die tatsächliche Materialdicke bringen, auch in importierten Dateien.'), keys: t('Schlitze Materialdicke Passung Nut Aussparung|Suchwörter'), since: '1.5.0' },
  { id: 'gridarray', group: 'arrange', name: t('Rasterarray'), desc: t('Auswahl in Spalten und Zeilen kopieren.'), keys: t('Raster Kopien vervielfältigen Reihe Matrix Array|Suchwörter') },
  { id: 'circarray', group: 'arrange', name: t('Kreisarray'), desc: t('Auswahl im Kreis um einen Mittelpunkt kopieren.'), keys: t('Kreis rund Kopien vervielfältigen Array polar|Suchwörter') },
  { id: 'nest', group: 'arrange', name: t('Verschachteln'), desc: t('Teile mit ihren echten Konturen platzsparend auf Bett, Material oder Reststück legen.'), keys: t('Nesting Verschachteln Platz sparen anordnen Reststück|Suchwörter') },
  { id: 'workpiece', group: 'arrange', name: t('Auf Werkstücke übertragen'), desc: t('Gleiche Werkstücke im Kamerabild finden und das Design passend auf jedes legen.'), keys: t('Kamera Werkstück Serie erkennen ausrichten|Suchwörter'), since: '1.5.0' },
  { id: 'warp', group: 'arrange', name: t('Verformen'), desc: t('Formen, Text und Bilder biegen, wölben oder perspektivisch verzerren.'), keys: t('Verzerren biegen Bogen Perspektive Wölbung|Suchwörter'), since: '1.5.0' },
  { id: 'qr', group: 'text', name: t('QR-Code'), desc: t('QR-Code, WLAN-Zugang oder Visitenkarte als Vektor.'), keys: t('QR Code 2D WLAN vCard Visitenkarte Link|Suchwörter') },
  { id: 'barcode', group: 'text', name: t('Strichcode'), desc: t('1D-Barcode als Vektor: Code 128, EAN-13, EAN-8, UPC-A, Code 39 oder ITF, auch mit Seriennummer.'), keys: t('Barcode Strichcode EAN UPC Code 128 Code 39 ITF Artikelnummer Seriennummer|Suchwörter'), since: '1.10.0' },
  { id: 'fonts', group: 'text', name: t('Schriften'), desc: t('Schriften von Google Fonts mit Vorschau suchen und laden, eigene TTF/OTF-Dateien und Favoriten verwalten.'), keys: t('Schrift Font Google Fonts Schriftart installieren TTF OTF Favoriten|Suchwörter'), since: '1.13.0' },
  { id: 'vartext', group: 'text', name: t('Variabler Text'), desc: t('Seriennummern, Datum oder Spalten aus einer CSV-Datei in Text einsetzen.'), keys: t('Seriennummer Zähler Datum CSV Platzhalter|Suchwörter') },
  { id: 'series', group: 'text', name: t('Serie aus Tabelle'), desc: t('Aus einer Tabelle viele Varianten eines Projekts erzeugen, z. B. Namensschilder.'), keys: t('Serie Tabelle CSV Namensschilder Stapel|Suchwörter') },
  { id: 'newtemplate', group: 'text', name: t('Neu aus Vorlage'), desc: t('Projekt aus einer eigenen, mitgelieferten oder Erweiterungs-Vorlage anlegen.'), keys: t('Vorlage Template Muster neu|Suchwörter') },
  { id: 'filltemplate', group: 'text', name: t('Vorlage ausfüllen'), desc: t('Die Parameter des aktuellen Projekts mit Vorschau ändern.'), keys: t('Vorlage Parameter ausfüllen Formular|Suchwörter') },
  { id: 'trace', group: 'image', name: t('Nachzeichnen'), desc: t('Bild in Vektoren umwandeln, als Umrisse oder Mittellinien.'), keys: t('Vektorisieren Trace Umriss Mittellinie Bild|Suchwörter') },
  { id: 'bgremove', group: 'image', name: t('Hintergrund entfernen'), desc: t('Hintergrund eines Bildes transparent machen, ohne Cloud-Dienst.'), keys: t('Freistellen Hintergrund transparent ausschneiden|Suchwörter'), since: '1.5.0' },
  { id: 'adjust', group: 'image', name: t('Bild anpassen'), desc: t('Helligkeit, Kontrast, Gamma und Rasterung eines Bildes einstellen.'), keys: t('Helligkeit Kontrast Gamma Graustufen Dithering|Suchwörter') },
  { id: 'materialtest', group: 'laser', name: t('Materialtest'), desc: t('Testraster mit gestuften Werten für Leistung und Geschwindigkeit lasern.'), keys: t('Test Leistung Geschwindigkeit Raster Material|Suchwörter') },
  { id: 'testphoto', group: 'laser', name: t('Materialtest auswerten'), desc: t('Foto des gelaserten Tests laden, beste Zelle anklicken, Werte übernehmen.'), keys: t('Foto Kamera Auswertung Material Test|Suchwörter'), since: '1.5.0' },
  { id: 'focustest', group: 'laser', name: t('Fokustest'), desc: t('Rampe auf schrägem Material oder Linienreihe mit Z-Versatz lasern und die schärfste Stelle anklicken.'), keys: t('Fokus Brennpunkt Brennweite Abstand Höhe Schärfe Rampe Z-Achse einstellen|Suchwörter'), since: '1.12.0' },
  { id: 'jig', group: 'arrange', name: t('Jig'), desc: t('Halteplatte mit passgenauen Aussparungen für Werkstücke aus Vektorgrafik, Bild oder Kamera, mit Nummern und Passermarken.'), keys: t('Jig Halterung Vorrichtung Schablone Aussparung Serie Schlüsselanhänger Rohlinge Fächer|Suchwörter'), since: '1.17.0' },
  { id: 'jigfill', group: 'arrange', name: t('Auf Jig-Fächer legen'), desc: t('Design in jedes Fach eines Jigs kopieren, auf Wunsch mit Seriennummer oder CSV-Zeile je Fach.'), keys: t('Jig Fächer verteilen Serie Seriennummer Namen CSV Schlüsselanhänger kopieren|Suchwörter'), since: '1.17.0' },
  { id: 'printcut', group: 'laser', name: t('Print and Cut'), desc: t('Gedrucktes Blatt an Passermarken mit Laserpunkt oder Kamera einmessen und passgenau ausschneiden.'), keys: t('Print Cut Drucken Ausschneiden Passermarken Registrierung Aufkleber Sticker Etikett ausrichten|Suchwörter'), since: '1.17.0' },
  { id: 'calibrate', group: 'laser', name: t('Passung kalibrieren'), desc: t('Testteile lasern, nachmessen und Schnittfuge und Steckspiel übernehmen.'), keys: t('Kerf Fuge Schnittbreite Passung Spiel kalibrieren|Suchwörter') },
  { id: 'check', group: 'laser', name: t('Konstruktion prüfen'), desc: t('Doppelte Linien, offene Umrisse, schmale Stege, Passungen, Steckbarkeit und Arbeitsbereich prüfen.'), keys: t('Prüfen Fehler doppelt offen Steg Kontrolle|Suchwörter') },
  { id: 'setup', group: 'laser', name: t('Laser einrichten'), desc: t('Schritt für Schritt von der Verbindung bis zum ersten Testauftrag.'), keys: t('Einrichten Assistent Verbinden erste Schritte Gerät|Suchwörter') },
  { id: 'rotary', group: 'laser', name: t('Drehachse'), desc: t('Rotary einstellen: Walzen oder Futter, Anschluss, Durchmesser, Testdrehung.'), keys: t('Rotary Drehachse Walze Futter Becher Glas zylindrisch|Suchwörter') },
];

/** Alle Kacheln in der Sprache der Oberfläche */
export const appList = (): AppInfo[] => rows(t);

/** Deutsche Quelltexte (mit Kontext nach „|“) */
const source = rows((s) => s);

/** Deutscher Quelltext ohne Kontext; dazu die englische Fassung, damit beide Sprachen gefunden werden */
const both = (s: string) => {
  const de = s.split('|')[0];
  const tr = (en as Record<string, string>)[s];
  return tr ? `${de} ${tr}` : de;
};

/** Kleinbuchstaben ohne Akzente: „Schlüssel“ → „schlussel“, „ß“ → „ss“ */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const haystacks = new Map<string, string>();
function haystack(id: string): string {
  let s = haystacks.get(id);
  if (s === undefined) {
    const src = source.find((x) => x.id === id);
    s = src ? fold([both(src.name), both(src.desc), both(src.keys)].join(' ')) : '';
    haystacks.set(id, s);
  }
  return s;
}

/** Kacheln, die zur Suche passen: jedes Wort muss in Name, Erklärung oder Suchwörtern (Deutsch oder Englisch) vorkommen.
 *  Treffer im Namen zuerst. */
export function searchApps(list: AppInfo[], query: string): AppInfo[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const hits = list.filter((a) => words.every((w) => haystack(a.id).includes(w)));
  const inName = (a: AppInfo) => words.some((w) => fold(a.name).includes(w));
  return [...hits.filter(inName), ...hits.filter((a) => !inName(a))];
}

/** Haupt- und Nebenversion als vergleichbare Zahl: „1.7.0-beta“ → 1007 */
function minorOf(v: string): number | null {
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
}

/** Wie viele Nebenversionen ein Werkzeug als „NEU“ gilt (die aktuelle und die zwei davor) */
export const NEW_FOR = 3;

/** Ist ein Werkzeug mit dieser Einführungsversion in der laufenden Version noch neu? */
export function isNewIn(since: string | undefined, appVersion: string): boolean {
  if (!since) return false;
  const s = minorOf(since);
  const a = minorOf(appVersion);
  if (s === null || a === null || s > a) return false;
  return Math.floor(s / 1000) === Math.floor(a / 1000) && a - s < NEW_FOR;
}

/** Zuletzt benutzt: Kennung nach vorne, ohne Doppelte, höchstens max Einträge */
export function pushRecent(list: string[], id: string, max = 6): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
