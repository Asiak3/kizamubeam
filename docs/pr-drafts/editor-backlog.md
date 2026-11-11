# Editor-Backlog für getrennte Folgearbeiten

**Aktuelle Funktions-/PR-Übersicht:** [README.md](README.md). Die nachfolgenden
Statusangaben vom 06.11. sind teilweise historisch; insbesondere sind die neue
Außenkontur-Vorschau und Slot-Burn/Spiegel inzwischen lokal implementiert.

**Stand: 06.11.2026.** Arbeitsübersicht, kein veröffentlichter PR und keine
Releasezusage. Grundlage: aktueller Quell-/Dokumentationsstand und die nur gelesene
kanonische Liste `C:\my files\laser_beam\TODO.md`, Abschnitt „Editor follow-ups“.
Die kanonische TODO bleibt unverändert. Historische Rust-/Workbench-Pakete aus
anderen Entwicklungsständen werden nicht pauschal in diesen Tauri/TS-Backlog übernommen.

## Offen und konkret planbar

| Aufgabe | Status aus TODO / aktueller Abgleich | Nächster Schritt und Abnahmekriterium |
| --- | --- | --- |
| Parametrische Schlitzprojektion | Lokaler Prototyp; manuelle Tests laufen. Neuer Geradenkern begonnen, revidierter Dialog/Worker in Arbeit. | [Fokussierten Entwurf](parametric-slot-projection.md) umsetzen: getrennte Vorschauauswahl, paralleles Maß, rot/orange Bezüge, DAG, Persistenz und Abbruch-/Undo-Tests. Frühere Konturtests sind kein Projektionsnachweis. |
| Pfadinseln trennen | Offen; kein eigenes Benutzerwerkzeug gefunden. **Empfohlener unabhängiger Kandidat.** | Compound-Pfad in zusammenhängende geschlossene Materialinseln teilen; Außenkontur und zugehörige Löcher zusammenhalten, verschachtelte Materialinseln separat. Béziersegmente, Closure, Transformation, Layer/Eigenschaften bewahren. Berührungen/Überlappungen/offene Teilpfade ausdrücklich behandeln; keine stille Parameterauflösung. Ein Undo, Topologie-Fixtures. „Zerlegen“/Alt+B bleibt Segmentzerlegung. Vorhandene Nesting-Inselzuordnung zuerst prüfen. |
| Kamera-Overlay-Schalter | Offen; [#145](https://github.com/negurvulkan/kizamubeam/issues/145). **Empfohlener unabhängiger Kandidat.** | Menü-/Toolbar-Aktion an bestehende Overlay-Sichtbarkeit anbinden und mit Kamera-Checkbox synchron halten. Kein Connect/Capture, kein Kalibrierungsreset. Fehlende Quelle, Tastatur/Fokus und mehrfaches Umschalten offline testen. |
| Layer-Reihenfolge | Lokaler Fokusguard und Browserregression laut TODO fertig; native Abnahme offen, [#143](https://github.com/negurvulkan/kizamubeam/issues/143). | Verhalten im passenden nativen Testbuild prüfen; Fokus im Eingabefeld versus Listenreihenfolge, Auswahl und wiederholtes Umordnen protokollieren. Frühere Buildanforderung nicht automatisch als Bauauftrag ausführen. |
| Vektorwerkzeuge / Shape Builder / Isolation | Lokale Prototypen; Benutzerabnahme nicht abgeschlossen, separate Vorschläge unveröffentlicht. | Gesten-/Fokus-/Undo-/Topologiegrenzen mit synthetischen Projekten abnehmen und in eigene PR-Scopes schneiden. Shape Builder unterstützt noch keine Gruppen, offenen Schnittlinien, Gap-Erkennung oder live abgeleitete Geometrie; Isolation bleibt Anzeige-/Bearbeitungskontext, kein Ausgabefilter. |
| Kontextmenüs | Positives Benutzerfeedback; Featurediskussion [#144](https://github.com/negurvulkan/kizamubeam/issues/144), kein PR. | Eigenständigen Scope vorbereiten; Objekt-/Bild-/Knoten-/Leerflächenkontexte, Shortcuts, deaktivierte Aktionen und Fokuswiederherstellung prüfen. Nicht als bereits zusammengeführte Funktion beschreiben. |
| Kamera-Auflösungs-/Kalibrierungshinweis | Optionale UX-Aufgabe, offen. Fehlendes Overlay wurde durch passende Auflösung gelöst; kein bestätigter Renderingfehler. | Mismatch sichtbar und verständlich anzeigen; keine automatische Neukalibrierung, kein Zurücksetzen bestehender Daten. |

## Eigenständiger, ausgabesensitiver Vorschlag — nicht mit Slot-Spiel vermischen

**Nachtrag 07.11.:** Nach ausdrücklicher Freigabe als lokaler Konturversatz
implementiert, einschließlich optionaler destruktiver Variante ohne Änderung
der Quellzugehörigkeit. Aktueller Vertrag und Grenzen:
[Konturversatz](../contour-offset.md), [separater PR-Entwurf](local-contour-offset.md).
Die folgende frühere Vorschlagsbeschreibung ist historisch.

Präzisierung vom 07.11.: Gewünscht ist ein editierbarer lokaler geometrischer
Konturversatz, etwa zum Verkleinern einzelner Löcher und Verbreitern von Stegen,
auch bei aus mehreren Objekten gebildeten Konturen innerhalb einer sichtbaren
Toleranz. Layer-Kerf bleibt unverändert und separat. Die frühere Idee
„Layerkorrektur ersetzen/addieren“ ist keine bereits festgelegte Bediensemantik.
Vollständiger Anforderungsstand: [Funktionsübersicht](README.md).

**Lokale nicht destruktive Schnittkompensation: offen, Vorschlag; die TODO
autorisiert ausdrücklich noch keine Ausgabeimplementierung.** Erst Vertrag und
Freigabe klären, nicht als kleiner UI-Follow-up behandeln:

- Eindeutig zuordenbare geschlossene Öffnung/Kontur wählen; bei Schnittflächen
  eine belastbare Source-to-Output-Zuordnung statt bloßer sichtbarer Fläche verlangen.
- Pro Region „Layerkorrektur ersetzen“ oder „zur Layerkorrektur addieren“ explizit
  unterscheiden; ungewählte Konturen unverändert behandeln.
- Original und effektiven Toolpath zeigen; verschwindende Löcher, Kollisionen und
  verbleibende Stegbreiten prüfen. Persistenz, Undo und veraltete Referenzen absichern.
- Geometrisches Slot-Passungsspiel, eine mögliche spätere Burn-Funktion und die
  tatsächliche Layer-/Toolpath-Kerfkorrektur nicht doppelt anwenden. Ausgabe-/G-Code-
  Regressionen und Sicherheitsreview sind ein eigenes Gate, keine Hardwarefreigabe.

## Lokaler Umfang vorhanden, aber nicht pauschal abgenommen

- **Außenkontur mit ausgewählten Löchern:** in der kanonischen TODO als lokal
  implementiert `[x]` geführt, manuelle Tests laufen weiter. Unverbundene Außeninseln
  getrennt halten, Löcher/verschachtelte Inseln und problematische offene oder
  schneidende Konturen prüfen. Eigener Scope; kein Bestandteil des Slot-PR.
- **Vektornacharbeit aus dem aktiven/historischen Port:** partielle
  Pfadvereinfachung, separate Glättungssteuerung, Freehand-Redraw/
  Endpunktfortsetzung, Mehrfachauswahl von Griffen, Lasso und vollständige
  Topologie-/Gestenabnahme bleiben laut TODO offen. Vor neuer Implementierung den
  aktuellen Port abgleichen; keine pauschale vollständige Vektorparität behaupten.
- **Slot-Folgestufen:** Live-Bearbeitung eingebetteter Quellgeneratoren,
  Baugruppen und allgemein affine Platzierung sind keine erledigten Zusagen.
  Burn sowie corner/loop/backarc-Stile sind nicht implementiert; getrennt von der
  vereinbarten Geradenprojektion spezifizieren. Boxes.py ist Ideenreferenz, kein
  zu kopierender Quellcode; burn ≈ halber Kerf ersetzt keine Messung.

## Bewusst geschlossen / nicht erneut eröffnen

Die Photoframe-Prüffunde sind in der TODO abgeschlossen: Benutzerfragen beantwortet,
**ausdrücklich keine weitere Arbeit**. Keine automatische Geometrieentfernung,
Unterdrückung von Befunden oder neue Photoframe-Aufgabe daraus ableiten.

## Empfohlene Reihenfolge und gemeinsame Gates

1. Laufende Schlitzüberarbeitung und manuelle Abnahme abschließen; Quellstand und
   tatsächlich ausgeführte Prüfungen festhalten.
2. Pfadinseln und Overlay-Schalter als kleine, unabhängige Kandidaten getrennt
   diskutieren/umsetzen. Diese Übersicht ist kein zusätzlicher Ausführungsauftrag.
3. Bestehende Prototypen und Layerfix separat abnehmen und aus dem gemischten
   Arbeitsbaum isolieren; kein Sammel-PR mit allen Editoränderungen.
4. Lokale Ausgabekompensation erst nach ausdrücklicher Umfangsentscheidung planen.

Pro PR: eigener klarer Dateiumfang, kompatible Daten, fokussierte Regressionen,
zutreffende Lokalisierungs-/Buildchecks und dokumentierte Einschränkungen.
Für diese Dokumentationsarbeit wurden keine Unit-/Browsertests und kein Build
ausgeführt; frühere Ergebnisse gelten nur für ihre damaligen Quellstände.
Manuelle Tests laufen weiter. Kein Commit, Push, Publizieren oder neuer Build
wird durch diese Liste behauptet oder ausgelöst; keine Hardwaretests.

Wesentliche KI-Unterstützung: **GPT 6.1 Sol (OpenAI) via OpenCode**.
Automatisierte Prüfung ist keine unabhängige menschliche Review.
