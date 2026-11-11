# PR-Entwurf: Parametrische Schlitze mit getrenntem Ursprung und Projektionskante

Aktuelle Folgeüberarbeitung: dauerhaft erhaltene Dialog-Entwürfe, Icon-Werkzeuge,
bestätigtes Zurücksetzen im offenen Fenster, Vorschau-Augensymbole und
parametrische Spiegelungen als Unterfeatures. Neue Identität:
`slot-placement-mirrors`; bisherige vier Identitäten bleiben lesbar.
Aktueller Prüfstand/Grenzen: [`slot-features.md`](../slot-features.md).
Der unten archivierte Feature-Build enthält diese Folgeüberarbeitung noch nicht.
Neuer Windows-Testbuild bestanden:
`artifacts/windows-slot-mirrors-20261106-225359/`; Quellprüfsummen nachgeprüft,
EXE/NSIS/Protokoll/Browserergebnisse archiviert. 87 neue Featureassertionen und
alle sechs Browsersuiten bestanden, zusätzlich 14 Spiegel-Geometrietests sowie
die bisherigen fokussierten Regressionen. Nicht gestartet/installiert.

**Stand: 06.11.2026 · lokaler Entwurf, nicht veröffentlichungs- oder mergefertig.**
Aktueller Folgeumfang: Gruppen, Featuretree, allgemeiner Eckenwinkel,
Mittelpunkt-Senkrechten/virtuelle Schnittpunkte, Navigation und lokale
Fertigungskorrekturen sind lokal implementiert. Aktuelle Grenzen und tatsächlich
ausgeführte Prüfungen: [`slot-features.md`](../slot-features.md). Die folgenden
Projektionsnotizen dokumentieren die vorherige Stufe; deren Build ist kein
Nachweis für den neuen Featureumfang. Neue Generatoridentität:
`slot-placement-features`; alle drei früheren Identitäten bleiben lesbar.
Frontend-Build, i18n, fokussierte Geometrie-/Worker-/Regressionsprüfungen sowie
47/47 neue Browserchecks bestanden. Hilfsobjekt-only-Persistenz,
Originalwiederherstellung, Entwurfs-Revert und bestätigter/abgebrochener
Gruppenwechsel sind dabei ausdrücklich geprüft. Windows-Paketierung bestanden:
`artifacts/windows-slot-features-20261106-222649/`; EXE/NSIS, Protokoll und
Prüfsummen archiviert, Quellprüfsummen nachgeprüft. Nicht gestartet/installiert.

`loop`/`backarc` sind geometrische Freistellungsprofile, keine exakten Boxes.py-
Werkzeugpfade. Kein öffentlicher PR, Commit oder Push; native Abnahme offen.

Manuelle lokale Tests laufen weiter. Dieser Text hält den vereinbarten Zielumfang
fest; er erklärt die laufende Überarbeitung nicht pauschal für implementiert.

## Problem und Ziel

Der bisherige konturgeführte Prototyp misst entlang der Kontur und verlagert die
Punktwahl auf die Arbeitsfläche. Der revidierte Ablauf soll stattdessen vollständig
in der Werkzeugvorschau stattfinden und Ursprung und Projektionskante unabhängig
wählbar machen. Bestehende freie und konturgeführte Rezepte bleiben lesbar; deren
alte Bogenlängensemantik darf nicht still umgedeutet werden.

Kontext, keine automatische Schließung oder gemeinsame PR-Zusage:
[Schlitzwerkzeug #146](https://github.com/negurvulkan/kizamubeam/issues/146).
[Außenkontur #147](https://github.com/negurvulkan/kizamubeam/issues/147) ist eine
separate Funktion und gehört nicht in diesen fokussierten PR.

## Vereinbarter Umfang

- Ursprung in der Vorschau wählen: erkannte Ecke der Originalkontur oder Bezug
  eines anderen Ausschnitts, insbesondere dessen Öffnungs- oder Bodenecke.
  Vorhandene Schnittbezüge müssen eindeutig identifizierbar bleiben.
- Davon unabhängig eine echte gerade Projektionskante wählen. Der Ursprung wird
  orthogonal auf diese Gerade projiziert; der Abstand wird ab dort **parallel zur
  gewählten Geraden** in der gewählten Richtung gemessen, nicht als Bogenlänge.
- Am eigenen Ausschnitt **Anfang / Mitte / Ende** als Maßziel wählen. Breite und
  Tiefe bleiben editierbar; Breite = Nennbreite × Faktor + gesamtes Spiel.
- Der Ausschnitt muss vollständig auf der gewählten Geraden liegen. Kein
  Weiterlaufen um Ecken, keine Platzierung auf Rundungen und kein stiller Wechsel
  auf eine benachbarte Kante. Ungültige Platzierungen erhalten einen Hinweis.
- Eckenerkennung über einen einstellbaren Richtungsänderungs-Schwellenwinkel.
  Linie/Kurve-Übergänge auch bei tangentialem Anschluss als Referenzpunkte
  anbieten; das macht die Kurve selbst nicht zur zulässigen Projektionskante.
- Für **jeden** Ausschnitt Ursprung rot und Projektionskante orange darstellen,
  bei Auswahl und Wiederöffnen erhalten und nachträglich ändern können. Farben
  durch eindeutige Beschriftung/Markierungen ergänzen.
- Stabile Schnitt-IDs und Abhängigkeiten als DAG: Änderungen eines Elternschnitts
  propagieren transitiv, einschließlich relevanter Breiten-/Tiefenänderungen.
  Zyklen, fehlende oder ungültige Bezüge ablehnen; referenzierte Schnitte nicht
  unbemerkt löschen. Veraltete Quellen-/Kantenreferenzen nicht automatisch erraten.
- Standardmäßig nicht destruktiv: Originalform, Rezept und Ergebnisgeometrie
  erhalten, per Doppelklick wieder bearbeiten. Explizites bestätigtes Festschreiben
  (Bake) entfernt Parameter; kein stilles Flattening. Apply/Cancel, Undo/Redo und
  Quellenprüfung müssen den gesamten Vorgang transaktional halten.
- Dialog verschiebbar und größenveränderbar, innerhalb des sichtbaren Fensters
  begrenzt; Vorschau und Übernehmen/Abbrechen bleiben auch nach Resize erreichbar.
- Eigenständig prüfbarer reiner TypeScript-Geometriekern, getrennt von DOM und
  Editor; aufwendige Vorschaugeometrie in einem Web Worker mit Arbeitsgrenzen,
  Abbruch und Schutz gegen verspätete Ergebnisse. Die Trennung und Worker-Anbindung
  sind lokal implementiert und mit synthetischen Tests/echtem Browserworker geprüft;
  die native Bedienabnahme bleibt offen.

## Implementierungsstand und Grenzen

Beim Lesen des lokalen Arbeitsstands sind in `src/straightSlots.ts` bereits
Geradenerkennung, Winkel-/Übergangsreferenzen und die parallele Projektion mit
Anfang/Mitte/Ende sichtbar. `src/slotPlacement.ts` enthält Projektionsmetadaten,
einen DAG-Resolver und die neue Generatoridentität `slot-placement-projection`.
Das ist Quellcodebefund, kein Ausführungsnachweis.

Aktuelle Integrationsprüfung: 15 Geraden-/Projektionsfälle, Worker-Lebenszyklustest,
relevante Regressionen, Build/i18n und echte Browserworker-Prüfung bestanden.
Details: [`slot-projection.md`](../slot-projection.md). Windows EXE/NSIS gebaut:
`artifacts/windows-projection-overlay-20261106-165125/`; nicht gestartet/installiert.
Der frühere gemischte Quellbefund ist unten als Entwicklungskontext beschrieben.

Der überarbeitete Dialog `src/slotPlacementDialog.ts` bietet nun Auswahl innerhalb
der Vorschau, rot/orange Bezüge, eigene Maßziele, verschieb-/skalierbares Fenster
und Worker-Vorschau. Browserchecks für Projektions-/Bodeneckenbezüge, mitwandernde
Folgeschnitte, Größenänderung, Drag, Apply/Cancel/Undo und Aufräumen bestanden.
Die älteren Dokumente
[`parametric-slot-placement.md`](../parametric-slot-placement.md) und
[`contour-guided-slots.md`](../contour-guided-slots.md) beschreiben frühere Stufen,
nicht den Nachweis des hier vereinbarten neuen Ablaufs.

Der erste Umfang bleibt ein einzelnes geschlossenes Vektorobjekt ohne Gruppen
oder Baugruppen. Im gelesenen Geradenkern sind innere Lochkonturen keine
Platzierungskanten. Live-Regeneration eines eingebetteten Quellgenerators und
allgemeine Skalierungs-/Scherungsunterstützung sind nicht zugesagt.

### Boxes.py: Inspiration, kein übernommener Quellcode

Die besprochene Faustregel **burn ≈ halbe Schnittfugenbreite (Kerf)** dient als
Orientierung, nicht als universell gemessener Materialwert. Ideen zu Ecken,
Schleifen und Rückbögen (corner/loop/backarc) sind konzeptionelle Inspiration;
dieser Entwurf sieht keine Übernahme von Boxes.py-Quellcode vor.

**Burn-Kompensation und diese Eckstile sind noch nicht implementiert und nicht
Teil der bestätigten Basisfunktion.** Als eigene Folgeetappe spezifizieren und
testen. Geometrisches Passungsspiel und Layer-Ausgabekerf getrennt halten, damit
keine doppelte Kompensation entsteht. Keine lokale Toolpath-Kompensation als
Nebenwirkung dieses PR einführen.

## Vor einem fokussierten PR noch zu erledigen

- [x] Vorschau-only-Ablauf, editierbare Bezüge und Dialog-/Worker-Integration lokal implementieren.
- [ ] Regressionsfälle: 100 × 80 mm Rechteck, 3,7 mm Nennbreite + 0,1 mm Spiel,
  gedrehte/gespiegelte Quelle, entfernte Ursprungsecke, eigene Maßziele,
  Richtungswechsel, Kantenende und abgewiesenes Überqueren einer Ecke.
- [ ] Tangentiale Linie/Kurve-Übergänge, Winkelschwellen, kollineare Teilsegmente,
  Rundungsablehnung, mehrstufige Abhängigkeiten sowie ungültige Bezüge absichern.
- [ ] Rezept-Roundtrip, alte Generatoridentitäten und gecachte Geometrie prüfen;
  alte Dateien nicht mit neuer Maßsemantik regenerieren. Sourceänderung,
  Cancel/Undo/Redo, bestätigtes Bake und Wiederherstellung testen.
- [ ] Worker-Abbruch, veraltete Antworten, große Eingaben, wiederholtes Öffnen/
  Schließen und native Fokus-/Resize-Grenzen offline prüfen.
- [ ] Lokalisierung und relevante Regressionen ausführen und Ergebnisse mit
  konkretem Source-Stand protokollieren: `test:slot-placement`,
  `test:contour-slots`, `test:generators`, `test:history`, `test:gcode`,
  `i18n:check`, `build`; neue Projektionsfälle zusätzlich erforderlich.
- [ ] Den gemischten Arbeitsbaum in reviewbare Scopes aufteilen. Vektorwerkzeuge,
  Shape Builder, Kontextmenüs, Isolation, Außenkontur und Layer-Fokusfix bleiben
  außerhalb dieses PR; gemeinsame Editor-/UI-Dateien hunkweise prüfen.

## Prüfung, Kompatibilität und Sicherheit

Für diese Dokumentationsarbeit wurden **keine Unit-/Browsertests und kein Build**
ausgeführt. Frühere Dokumente enthalten Ergebnisse früherer Prototypen; diese
werden nicht als bestandene Prüfung der Projektion übernommen. Manuelle lokale
Tests sind weiterhin laufend, vollständige native Abnahme steht aus.

Keine Veröffentlichung, kein Commit/Push und keine Releasefreigabe durch diesen
Entwurf. Keine Versions-, Controller- oder Maschinenbefehlsänderung vorgesehen.
Geänderte Geometrie beeinflusst trotzdem die spätere Ausgabe: Materialreste,
verschwindende Öffnungen und effektive Schnittbahnen separat prüfen. Nur
synthetische Testprojekte offline verwenden; keine Hardwarefahrt oder
Laseraktivierung und keine Behauptung physischer Sicherheitszertifizierung.

Wesentliche KI-Unterstützung bei Implementierung/Testentwürfen/Dokumentation:
**GPT 6.1 Sol (OpenAI) via OpenCode**. Automatisierte KI-Prüfung ist keine
unabhängige menschliche Review; menschliche Verantwortung und Abnahme bleiben nötig.
