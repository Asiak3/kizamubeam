## Feature-Request: parametrische Ausklinkungen mit Referenzpunkt und Projektionskante

Zusätzlich zu „Schlitze anpassen“ wird ein Werkzeug zum Erstellen neuer parametrischer Schlitze/Ausklinkungen gewünscht. **Nach lokalen Bedienversuchen wurde das Positionsmodell präzisiert:** Keine Bogenlängenbemaßung und vorerst keine Platzierung auf Rundungen. Referenzpunkt und Projektionskante sind zwei unabhängige Auswahlen, vollständig im Werkzeugfenster.

## Gewünschte Bedienung

1. Gesamte Außenkontur des ausgewählten Teils in einer Werkzeugvorschau anzeigen.
2. Pro Ausklinkung einen **Referenzpunkt/Nullpunkt** wählen: erkannte Ecke der Grundform oder eine Ecke einer anderen Ausklinkung. Ecke anhand einstellbarem Mindest-Richtungswechsel erkennen, nicht nur 90°. Gerade/Rundung-Übergänge auch bei tangentialem Anschluss als Referenz anbieten.
3. Davon unabhängig eine **gerade Projektionskante** wählen, die Platzierungsgerade und Messrichtung festlegt. Der Referenzpunkt muss nicht auf derselben Geraden liegen: er wird orthogonal auf deren verlängerte Linie projiziert.
4. Abstand ab diesem Fußpunkt **parallel zur Geraden** einstellen. Als eigenes Messziel pro Schnitt erste Außenkante, Mitte oder zweite Außenkante wählen. Keine globale X/Y-Position und keine Bogenlänge.
5. Die volle Ausklinkungsbreite muss auf die vorhandene endliche Gerade passen. Kein Weiterlaufen über Ecken oder auf Rundungen.

Die ausgewählte Referenz bleibt **rot eingekreist**, die Projektionskante **orange**, Positionsmaß und Ziel **gelb**. Beide Bezüge müssen bei Auswahl/Wiederöffnung sichtbar und direkt im Werkzeugfenster änderbar sein; kein Wechsel auf die Arbeitsfläche.

## Abhängigkeiten und Parameter

- Jeder Schnitt hat eigene Referenzen, Breite, Tiefe, Spiel und Faktor.
- Folgeschnitte können Öffnungs-/Bodenecken anderer Schnitte als Nullpunkt verwenden, auch an anderen Platzierungskanten. Ändert sich der Elternschnitt, werden ihre Positionen transitiv nachgeführt.
- Stabile Rezept-IDs, Zyklen-/Fehlreferenzprüfung und Schutz vor Löschen referenzierter Schnitte.
- Nach destruktivem Festschreiben sind dessen geometrische Ecken wieder als Grundkontur-Referenzen erkennbar; keine Wiederherstellung früherer Parametrie behaupten.
- Standardmäßig nicht destruktiv: Originaldefinition, Rezept und gecachte Ergebnisgeometrie bleiben erhalten. Doppelklick bearbeitet erneut; bestätigtes Festschreiben erzeugt normale Pfade. Apply/Cancel/Undo sind transaktional.
- Die früher besprochenen zwei Tiefenursprünge sind bei der jetzt auf Geraden beschränkten Platzierung geometrisch identisch. Alte Rundungsrezepte behalten ihre ursprünglichen Tiefenregeln, ohne stille Umdeutung.

## Fenster und technische Umsetzung

Das Fenster soll verschieb-/skalierbar sein, auf den verfügbaren Bereich begrenzt werden und auch bei kleiner Größe zugängliche Einstellungen/Übernehmen/Abbrechen haben. Die Vorschau wächst mit; Position/Größe lassen sich zurücksetzen.

Lokaler TS-Prototyp: reiner Geometriekern (`straightSlots.ts`), Rezept-/DAG-Resolver und eigene UI. Aufwendige Vorschaugeometrie in einem Web Worker; nur eine Berechnung gleichzeitig, neueste Warteschlange, keine veralteten Resultate nach Änderungen/Schließen. Arbeitsgrenzen und keine Kamera-/Maschinenabhängigkeit. Rust/WASM ist kein Selbstzweck; spätere Optimierung kann an der klaren Datenschnittstelle erfolgen, falls Messungen einen Engpass zeigen.

Bestehendes Generatorformat mit gespeicherten Konturen; neue Kennung `slot-placement-projection`. Frühere lokale freie und konturgeführte Rezepte bleiben mit ihrer alten Semantik lesbar. Ältere Leser ohne neuen Generator behalten gecachte Geometrie, statt das neue Rezept als freie Rechtecke neu zu berechnen. Keine Projektversion-/Maschinenkommandoänderung.

## Stand und Grenzen

Lokal implementiert auf Basis von 2.7.0 (`480d5b1`), kein PR/Branch-Upload. Ein fokussierter PR-Entwurf ist vorbereitet; der gemischte lokale Testbranch muss vor einem PR sauber nach Funktionen getrennt werden.

Erster Umfang: einzelnes geschlossenes Vektorobjekt, äußere gerade Abschnitte, rechteckige Ausschnitte. Keine Gruppen/Baugruppenteile, keine Platzierung auf Innenlochkonturen, keine Live-Bearbeitung eingebetteter Quellgeneratorparameter. Koordinaten sind lokal zum Objekt; allgemeine Skalierungs-/Scherungsfälle benötigen weitere Abnahme. Subtraktion verwendet bestehende Clipper-Approximation; kleine Reststege/Topologie müssen geprüft werden.

**Burn und Innenecken:** Boxes.py-Dokumentation dient konzeptionell als Orientierung: burn ungefähr halbe Schnittfugenbreite; Eckstile corner/loop/backarc. Es wurde kein Python-Code übernommen/übersetzt. Diese Eckstile und lokale Burn-Kompensation sind **noch nicht implementiert**, sondern als Folgeetappe abzugrenzen. Aktuelles Spiel/Faktor und Layer-Kerf bleiben getrennt; keine versteckte Doppelkompensation.

## Teststatus: lokale manuelle Tests **ongoing**

- 15 neue Projektions-/Geradentests bestanden: echte Geraden und kollineare Teilstücke, freie Winkel, tangentiale Übergänge, getrennte Herkunfts-/Projektionskante, eigene Messziele, Endbegrenzung, kantenübergreifende Abhängigkeiten, alle unterstützten Bezugsecken, Zyklen, JSON/Altformat und Unveränderlichkeit.
- Worker-Lebenszyklustests bestanden: zusammengefasste Anfragen, Snapshots, veraltete Antworten, Fehler, Abbruch und Bootstrap ohne native/Hardwareabhängigkeit.
- Echte isolierte Browserworker-Prüfung bestanden: Referenzwahl im Dialog, versetzte Bodenecken-Referenz, persistierte Folgeschnitte, Drag/Resize/erreichbare Fußleiste, Apply/Cancel/Undo/Aufräumen. Außenkontur und bisherige Editorinteraktionen erneut geprüft.
- Relevante Generator-/Schlitz-/G-Code-/Editor-/History-/Parameter-/Boolean-/Nesting-/Kameratests, Frontend-Build und Übersetzungsprüfung bestanden. Keine Aussage, sämtliche Projekttests seien grün: ein früherer Scharnier-Sprachvergleich ist weiterhin offen und hier nicht erneut ausgeführt.
- Neuer gemeinsamer lokaler Windows-x64-Testbuild (EXE und NSIS) mit diesen Änderungen, Overlaybutton und Isolation-Menüfix erfolgreich erstellt; Quellen-/Binärprüfsummen und Buildprotokoll gespeichert, Quellhashes nach dem Build abgeglichen. Nicht gestartet/installiert oder als Release veröffentlicht. Native Bedienabnahme, kleine Displays/Windows-Skalierung und Cross-Platform-Tests offen; keine Hardwaretests.

Dieses Issue dient der Diskussion des Bedienkonzepts und einer möglichen Integration, nicht der Aufforderung zur unveränderten Übernahme des Prototyps.

## KI-Unterstützung

Implementierung, Tests und Bericht wurden wesentlich mit **GPT 6.1 Sol (OpenAI) via OpenCode**, einschließlich delegierter Agentenarbeit, erstellt. Automatisierte Prüfungen/Agenten sind kein Ersatz für unabhängige menschliche Review.
# Local implementation follow-up (not yet published)

Feature groups/tree, recipe-wide corner angle, midpoint-perpendicular infinite
construction lines and virtual contour references, pan/zoom/fit, last-valid
preview recovery and group-local manufacturing corrections are implemented in the
local prototype. Current details and limitations: `docs/slot-features.md`.
47/47 new browser checks and focused geometry/worker/frontend checks passed;
native/material acceptance is ongoing. `loop`/`backarc` are distinct geometric
relief profiles, not exact Boxes.py retraced machining paths. New generator ID:
`slot-placement-features`; all three previous IDs remain readable.

Substantial AI assistance: **GPT 6.1 Sol (OpenAI) via OpenCode**. No public PR,
commit or push; this update is a local issue-body draft only.
