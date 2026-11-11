## Feature-Request: Außenkontur erzeugen und Löcher gezielt auswählen

Aus mehreren ausgewählten Objekten – auch auf verschiedenen Layern – soll eine **neue zusammengefasste Außenkontur** entstehen. Anders als normales Vereinen soll das Ergebnis standardmäßig **keine Innenlöcher** enthalten. Anschließend sollen geschlossene Innenflächen interaktiv anklickbar sein, um genau diese als Löcher in die neue Geometrie zu übernehmen.

## Gewünschter Ablauf

1. Mehrere geschlossene Formen auswählen und Werkzeug öffnen.
2. Vorschau nur der äußeren Silhouette sehen; Löcher sind zunächst gefüllt.
3. Gewünschte Innenflächen durch Hover/Klick oder eine alternative Auswahlliste als Löcher markieren.
4. Zielebene wählen und **„Originale behalten“** an-/abwählen (standardmäßig an).
5. Übernehmen oder abbrechen; ein Undo stellt den vorherigen Zustand wieder her. Parametrische Originale nicht stillschweigend verlieren.

Getrennte Außenbereiche bleiben getrennt; keine künstlichen Brücken und keine konvexe Hülle. Vorhandene Booleans und Shape Builder bleiben zusätzlich verfügbar.

## Lokaler Teststand

Ein lokaler Prototyp auf Basis von 2.7.0 (`480d5b1`) ist implementiert, nicht als Quellbranch/PR veröffentlicht. Er bietet die interaktive Dialogvorschau, wählbare Innenflächen, Checkbox-Alternative, Zielebene sowie Originale behalten/ausdrücklich ersetzen. Auch vollständig eingeschlossene eigenständige Quellformen können als Loch ausgewählt werden, obwohl normales Vereinen sie verschlucken würde.

Das Ergebnis ist ein unabhängiger zusammengesetzter Pfad im bestehenden Dateiformat, keine live-parametrisch abgeleitete Form. Erhaltene Originale behalten Parameter, Geometrie und Ausgabestatus; doppelte Ausgabe muss vermieden werden. Bei ersetzten Originalen ist eine ausdrückliche Bestätigung nötig. Quellen mit deaktivierter Ausgabe führen konservativ zu einem als „Nicht lasern“ markierten Ergebnis.

Begrenzungen: geschlossene Vektorflächen, keine Bilder/offenen Pfade; versteckte/gesperrte Bestandteile werden abgelehnt statt still weggelassen. Begrenzte Objekt-/Flächenbudgets. Kurven werden mit vorhandener Clipper-Infrastruktur fein angenähert; keine Garantie identischer Topologie an kleinsten Lücken oder Tangenten. Kein neuer Ausgabe- oder Maschinenbefehl.

## Teststatus: **lokale manuelle Tests ongoing**

18 fokussierte Geometrie-/Editorchecks bestanden: Löcher, verschachtelte Inseln, Überlappungen, mehrere Layer, Transformationen, Grenzen, unveränderte Originale/Parameter, Ersetzen, Undo/Redo und veraltete Vorschauen. Isolierte Real-Editor-Browserprüfung für Lochwahl, Pixelvorschau, Apply/Cancel und Dialog-Lebenszyklus bestanden. Relevante Editor-/Boolean-/History-/Generator-/G-Code-Regressionen, Frontend-Build und Übersetzungsprüfung bestanden.

Native Bedienabnahme und plattformübergreifende Tests bleiben offen, keine Hardwaretests. Ein gemeinsamer lokaler Windows-x64-Testbuild (EXE und NSIS-Installer) mit dem ebenfalls vorgeschlagenen Schlitzwerkzeug wurde erfolgreich erstellt; weder vom Agenten gestartet noch installiert. Das ist keine Upstream-Veröffentlichung. Bei dessen breiterer Prüfrunde scheiterte ein bestehender Scharnier-Test am Sprachvergleich; keine pauschale Aussage, dass sämtliche Projekttests bestanden seien.

Dieses Issue dient zunächst zur Diskussion der Funktion und Bedienung, nicht als PR oder Aufforderung zur Übernahme eines fertigen Patches.

## KI-Unterstützung

Implementierung, Tests und Bericht wurden wesentlich mit **GPT 6.1 Sol (OpenAI) via OpenCode** erstellt. Automatisierte Prüfungen ersetzen keine unabhängige menschliche Review.
