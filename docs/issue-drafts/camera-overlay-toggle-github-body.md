## Vorschlag: Kamera-Overlay direkt in der Menü-/Werkzeugleistenregion umschalten

Beim Ausrichten und Bearbeiten eines Entwurfs ist es hilfreich, das Kamerabild auf der Arbeitsfläche schnell ein- und auszublenden. Zurzeit muss dafür der Kamera-Tab geöffnet und **„Auf der Arbeitsfläche zeigen“** umgeschaltet werden. Ein eigener gut erreichbarer **Kamera-Overlay Ein/Aus-Button** würde diesen wiederholten Umweg vermeiden.

Beobachtet in KizamuBeam 2.7.0 unter Windows. Im aktuellen Menü-/Werkzeugleisten-Code wurde kein separater Overlay-Umschalter gefunden; falls es bereits einen entsprechenden Befehl gibt, wäre dessen bessere Erreichbarkeit/Dokumentation ebenfalls hilfreich.

## Gewünschtes Verhalten

- Eigener Button im oberen Menü-/Werkzeugleistenbereich, idealerweise auch als Befehl für anpassbare Werkzeugleisten verfügbar.
- Sichtbarer Aktivzustand und klarer Tooltip, z. B. „Kamerabild auf der Arbeitsfläche ein-/ausblenden“.
- Gemeinsamer Zustand mit dem vorhandenen Häkchen im Kamera-Tab, keine unabhängige zweite Einstellung.
- Nur die Überlagerung der Arbeitsfläche umschalten; normale Kamera-Livevorschau, Zeichnungsobjekte und Ausgabedaten unverändert lassen.
- Bei mehreren Kameras ausdrücklich festlegen, ob der Button die aktuell gewählte Kamera oder alle Overlays schaltet. Ein globaler Sichtbarkeitsschalter sollte die individuellen Kamerakonfigurationen nicht versehentlich verlieren.

## Abgrenzung

Der Button darf keine Kamera automatisch verbinden, keine Aufnahme/Maschinenbewegung auslösen und keine Kalibrierung zurücksetzen oder ungültige Kalibrierungen umgehen. Bei fehlendem Bild bzw. unpassender Auflösung sollte der Zustand verständlich erklärt werden; „eingeschaltet“ bedeutet nicht automatisch „gültiges Bild verfügbar“.

Es geht um einen Feature-Request zur Bedienung, nicht um einen bestätigten Renderfehler. Ein zuvor fehlendes Arbeitsflächenbild ließ sich durch Auswahl der zur Kalibrierung passenden Auflösung beheben.

Noch keine Umsetzung oder Plattformprüfung dieses neuen Buttons; kein PR. Der vorhandene Sichtbarkeitsschalter bleibt bestehen.

## KI-Unterstützung

Code-Recherche und Formulierung dieses Vorschlags wurden mit **GPT 6.1 Sol (OpenAI) via OpenCode** unterstützt.
