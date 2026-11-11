## Vorschlag

Ein kontextabhängiges **Rechtsklick-Menü im Editor** würde häufige Befehle direkt an der Auswahl erreichbar machen, ohne dafür die Menüleiste durchsuchen oder Werkzeugleisten erweitern zu müssen.

Dieser Vorschlag wird zunächst als Issue zur Diskussion gestellt, nicht als PR. Ein lokaler Prototyp auf Basis von KizamuBeam 2.7.0 (`480d5b1`) wurde bereits ausprobiert; das Rechtsklick-Menü funktioniert nach bisherigem Praxistest gut. Der Feature-Branch ist nicht veröffentlicht.

## Gewünschtes Verhalten

- Passende Aktionen für Vektoren, Bilder, Knoten/Segmente und leere Arbeitsfläche.
- Bestehende Editorbefehle wiederverwenden, statt deren Verhalten im Menü nachzubauen.
- Rechtsklick auf ein bereits ausgewähltes Objekt erhält die Mehrfachauswahl; Rechtsklick auf ein anderes bearbeitbares Objekt wählt dieses aus.
- Nicht verfügbare Aktionen deaktivieren. Zum Beispiel benötigen bestimmte Bildaktionen genau ein Bild.
- Beispiele: Kopieren/Einfügen, Duplizieren/Löschen, Gruppieren, Pfad-/Boolean-Aktionen, Bildbearbeitung sowie Knoten-/Segmentaktionen.
- Bestehende Rechtsklick-Gesten zum Abschließen laufender Zeichenaktionen und aktive Skizzen-/Auswahloperationen nicht verdrängen.
- Normale Menüs und Werkzeugleisten bleiben weiterhin verfügbar.

## Tastatur und Lebenszyklus

Shortcut-Texte sollen zentral aus denselben Befehlsbindungen wie die Tastatursteuerung stammen, nicht separat hart kodiert werden. Der lokale Prototyp verwendet dafür gemeinsame Command-IDs und Standardbindungen; eine frei konfigurierbare Tastaturbelegung ist ausdrücklich kein Bestandteil dieses Vorschlags.

Das Menü sollte innerhalb des sichtbaren Bereichs bleiben, Tastaturnavigation unterstützen, den Fokus sinnvoll zurückgeben und auf Escape/Außenklick schließen. Während es offen ist, darf z. B. Delete nicht versehentlich den dahinterliegenden Editor bedienen. Änderungen an Auswahl/Dokument schließen veraltete Menüs; geöffnete modale Dialoge sperren konkurrierende Aktionen.

## Lokaler Prüfstand

- Offline-Interaktionstests prüfen Menüvarianten, Bild-/Knotenaktionen, gemeinsame Modifier-Bindungen und reservierte Rechtsklick-Gesten.
- Isolierte Browserprüfungen für Tastaturnavigation, deaktivierte Aktionen, Fokus, Bildschirmgrenzen, Untermenüs und Listener-Aufräumen bestanden.
- Isolierte Real-Editor-Prüfung für Mehrfachauswahl beim Rechtsklick und Escape bestanden.
- Positiver manueller Ersteindruck im Windows-Testbuild; keine vollständige Plattform-/Accessibility-Abnahme.

Der Prototyp ist keine fertige Upstream-Integration. Gruppierung/Umfang der Befehle, Tastaturaufruf des Kontextmenüs sowie macOS/Linux- und native WebView-Fokusdetails sollten vor einer Integration abgestimmt werden. Keine Änderung am Projektformat oder an Maschinenbefehlen beabsichtigt. Keine privaten Projekte oder Hardwaretests erforderlich.

## KI-Unterstützung

Prototyp, Tests und Bericht wurden wesentlich mit **GPT 6.1 Sol (OpenAI) via OpenCode** erstellt. Automatisierte Prüfungen sind kein Ersatz für unabhängige menschliche Review.
