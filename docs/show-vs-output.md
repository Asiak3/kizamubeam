# Sichtbarkeit vs. Ausgabe (Issue #217)

Regel: **`output` entscheidet über die Laser-Teilnahme, `show`/`hidden` nur über die Anzeige.**
Die Vorschau zeigt immer die tatsächliche Sendung — inklusive ausgeblendeter Objekte.

## Matrix

| Zustand | Editor | Konstruktionsprüfung | Job / G-Code | Vorschau | Warnung |
|---|---|---|---|---|---|
| Layer `show=false` | versteckt | gezählt (Hindernis) | nimmt teil, wenn `output=true` | sichtbar | — |
| Layer `output=false` | sichtbar | ignoriert | nie | nie | — |
| Objekt `hidden=true`, Output an | versteckt | gezählt (Hindernis) | nimmt teil | sichtbar | „… nimmt am Job teil (Ausgabe eingeschaltet)" |
| Objekt `hidden=true`, Output aus | versteckt | ignoriert | nie | nie | keine |
| Objekt `noLaser=true` | sichtbar, markiert | ignoriert | nie (vererbt in Gruppen) | nie | keine |
| Objekt `showIf` falsch | versteckt | ignoriert | nie (vererbt; Modelllogik) | nie | keine |
| Objekt `showIf` wahr / leer | normal | gezählt | nimmt teil | sichtbar | — |
| `reg`-Passermarken | sichtbar | — | nie (nur Druck) | — | — |

## Umsetzung

- `outputLeaves()` (`src/model.ts`): Blätter für die Ausgabe-Auswahl. Schließt nur `noLaser`
  (vererbt) und falsches `showIf` aus; `hidden` zählt mit. `selfOutputOff()` = Eigenanteil
  davon (ohne Vererbung), für Top-Level-Skips.
- `buildJob` (`src/gcode.ts`) und `lasers()` (`src/parking.ts`) nutzen `outputLeaves()`.
- `check.ts` vererbt `noLaser`/Ausblendung in Gruppen; `view3d/engrave.ts` nutzt `outputLeaves()`.
- Bewusst unverändert (WYSIWYG): SVG-Export (`files.ts`) und Editor-Auswahl/Hit-Test
  nutzen weiter `visibleLeaves` + Layer-`show`.
- Automatische Platzierung zählt alle geometrischen Objekte als Hindernisse,
  unabhängig von Sichtbarkeit und Ausgabe.
