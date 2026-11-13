---
sidebar_position: 15
title: Print and Cut und Jigs
description: Gedruckte Bögen mit Passermarken genau ausschneiden und Serien von Werkstücken mit einem Jig lasern.
---

# Print and Cut und Jigs

## Print and Cut

Print and Cut schneidet einen gedruckten Bogen genau entlang des Drucks aus, etwa Sticker oder Pappfiguren. Starte es über **Werkzeugkasten → Laser und Kalibrieren → Print and Cut**.

1. **Marken setzen**: Setze drei Passermarken um den Entwurf (oder mache eigene Objekte zu Marken). Die Marken werden gedruckt und exportiert, aber nie gelasert.
2. **Drucken**: den Entwurf in Originalgröße drucken (100 %, nicht „an Seite anpassen“).
3. **Messen**: Leg den Bogen in den Laser. Fahre für jede Marke den Kopf mit schwachem Laserpunkt und den Verfahrtasten auf ihre Mitte, oder klicke sie im Kamerabild an.
4. **Ausrichten**: KizamuBeam verschiebt und dreht den ganzen Entwurf auf den Druck. Mit drei Marken korrigiert es auch Skalierung und Schräglauf des Druckers. Der Restfehler wird angezeigt.
5. Rahmen fahren und wie gewohnt starten.

Zwei Marken reichen zum Verschieben und Drehen; drei gleichen auch Verzerrungen des Druckers aus.

## Jigs {#jigs}

Ein Jig ist eine Halteplatte mit Aussparungen für eine Serie gleicher Werkstücke, etwa Schlüsselanhänger-Rohlinge oder Untersetzer. Erstelle ihn über **Werkzeugkasten → Vervielfältigen und Anordnen → Jig**.

Die Form der Fächer kann kommen aus:

- ausgewählten Objekten (beliebige importierte Vektordatei, Formen oder Text),
- einem nachgezeichneten Foto oder Scan (echte Breite eingeben),
- mit der kalibrierten Kamera auf dem Bett erkannten Stücken.

Ein Jig kann mehrere Arten von Werkstücken aufnehmen, jede mit Anzahl und 0° oder 90° Drehung. Der Generator setzt Spiel je Seite (Kerf eingerechnet), Fachabstand, Griffmulden zum Herausnehmen, gravierte Fachnummern und drei gravierte Passermarken. Die Platte passt sich den Fächern an oder hat eine feste Größe. Ein späterer Doppelklick auf den Jig ändert alles.

### Einen Jig benutzen

1. Schneide den Jig und lass ihn im Laser liegen (oder leg ihn später wieder ein).
2. Leg deinen Entwurf auf Fach 1, etwa einen Namen.
3. Wähle **Werkzeugkasten → Vervielfältigen und Anordnen → Auf Jig-Fächer legen** und gib die Fächer an, etwa `1-5, 8`. In jedes gewählte Fach kommt eine Kopie, an derselben Stelle im Fach.
4. Variabler Text zählt je Fach weiter (Seriennummer oder Tabellenzeile), und der Jig selbst wird ausgeblendet, sodass nur der Entwurf geschnitten wird.

Nimmst du den Jig heraus und legst ihn wieder ein, miss seine gravierten Marken mit Print and Cut: Jig und alle Kopien werden gemeinsam ausgerichtet.

Für Werkstücke, die irgendwo auf dem Bett liegen, siehe [Auf Werkstücke übertragen](camera.md#place-on-workpieces).
