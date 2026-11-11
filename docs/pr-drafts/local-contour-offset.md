# Lokaler Konturversatz mit erhaltener Quellzugehörigkeit

Lokaler PR-Entwurf, nicht veröffentlicht. Keine Commits oder Pushes.

## Scope

- Neues separates Werkzeug statt Umdeutung von Alt+O oder Layer-Kerf.
- Nichtdestruktives Rezept mit gecachter Geometrie pro bestehendem Quellobjekt.
- Gemeinsame Außenkontur-Netzerkennung mit T-Knoten/Kreuzungen, ohne Zusammenführen.
- V2-Teilspannenzuordnung und mehrere Versätze pro Unterpfad; V1 bleibt lesbar.
- Innen/Außen, Abstand, Toleranz, Arbeitsflächenvorschau und Konturwahl.
- Bestätigtes dauerhaftes Festschreiben; Originale/Rezepte durch Undo wiederherstellbar.
- Getrennte Validierung von Geometrie, Zugehörigkeit und atomarer Anwendung.

## Dateien und Abhängigkeiten

`src/contourOffset.ts`, `src/contourOffsetNetwork.ts`,
`src/contourOffsetNetworkResult.ts`, `src/editor/contourOffset.ts`,
`src/contourOffsetDialog.ts`, Registrierung in `src/generators/index.ts`,
Editor-Komposition und Menü/Toolbar/Generator-Editor in `src/ui.ts`, Übersetzungen.
Tests: `scripts/contour-offset-test.ts` und separater Browser-Fixture-Einstieg.
Verwendet den transienten Arbeitsflächen-Overlay-/Eingabevertrag und das bewegliche
Werkzeugfenster aus dem Außenkontur-PR. Diese Grundlage beim Extrahieren als
Abhängigkeit deklarieren oder separat voranstellen, nicht den ganzen Außenkontur-
und Schlitzumfang in diesen PR übernehmen.

## Bewusste Grenzen

Nacharbeit `frame_test_2.kzb`: falsche Mehrdeutigkeit durch Sackgassen wird nur
bei eindeutigem vollständigem Randweg aufgelöst; Konturen innerhalb desselben
Blattobjekts brauchen keine neuen inter-Objekt-Nähte. Teilspannen bleiben im
Rezept und es wird kein neues Sammelobjekt erzeugt. Zusammengesetzte Ausgabe
bleibt formal offen mit explizitem Schlusssegment (Layer-Kerf-Vertrag erhalten).
Ungültige Zusatzklicks dürfen gültige Auswahl und Vorschau nicht mehr löschen.
25 fokussierte/33 synthetische Browserchecks sowie Ressourcen-UI-Checks für41
Einzel-/Gesamtversätze bestanden; fünf Sicherheitsablehnungen bleiben bei den
dokumentierten Parametern. Noch lokale Nacharbeit, keine Veröffentlichung.

[Workflow, Eigentumsvertrag und Grenzen](../contour-offset.md). Keine generelle
Bearbeitung gemeinsam genutzter Konturkanten, keine willkürliche Zuordnung geteilter
Kanten, kein Live-Quellgenerator-Editor und keine Material-/Hardwarefreigabe.
Bestehende Layer-Kerf-Regeln bleiben erhalten. Kein neues Dateiformatfeld:
neue Generatoridentität nutzt das vorhandene Rezept-/Cacheformat.

Vor öffentlichem PR isolierten Scope erneut testen und Benutzerabnahme ergänzen.
Automatische Prüfungen sind keine unabhängige menschliche Prüfung.

Wesentliche KI-Unterstützung: **GPT 6.1 Sol (OpenAI) via OpenCode**.
