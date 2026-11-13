---
sidebar_position: 14
title: Kamera
description: Das Bett mit einer USB- oder Netzwerkkamera auf der Arbeitsfläche zeigen, die Kamera kalibrieren und Entwürfe automatisch auf Werkstücke legen.
---

# Kamera

Mit einer Kamera über dem Bett siehst du das Material direkt unter deinem Entwurf und kannst den Entwurf genau dort platzieren, wo er hingehört.

## Kamera wählen

Öffne das Fenster **Kamera** und wähle eine Kamera:

- eine **USB-Kamera** oder
- eine **Netzwerkkamera**, die einen MJPEG-Stream oder Einzelbilder über `http://` liefert, etwa eine ESP32-CAM oder die virtuelle Kamera der [Virtuellen Maschine](virtual-machine.md).

Das Bild wird entzerrt und unter den Objekten auf der Arbeitsfläche platziert. Du kannst seine Deckkraft einstellen und es einmal oder fortlaufend aktualisieren. **Als Bild einfügen** legt das aktuelle Bild auf den Layer T1, etwa zum Nachzeichnen. Unter macOS fragt das System beim ersten Verbinden nach der Kamera-Erlaubnis.

Ein Gerät kann mehrere Kameras haben, jede mit eigener Kalibrierung, alle gleichzeitig eingeblendet.

## Kalibrieren

Die Kamera muss lernen, wo das Bett in ihrem Bild liegt:

1. Starte die Kalibrierung im Fenster Kamera.
2. Lass den Laser ein Raster aus Markern (2 × 2 bis 5 × 5) auf ein Reststück lasern, oder speichere die Marker als G-Code.
3. Nimm ein Bild auf und klicke jeden Marker im Foto an.

KizamuBeam berechnet die Lage und ab 3 × 3 Markern auch die Linsenverzeichnung. Es zeigt den Restfehler in mm und eine entzerrte Kontrollansicht. Der Kalibrierdialog hat eigene Schaltflächen, um die Maschine zu verbinden, eine Referenzfahrt zu machen und zu verfahren.

Kalibrierungen lassen sich als `.kzb-camera`-Datei exportieren und auf einem anderen Rechner mit gleicher Kamera und Halterung importieren.

## Bild anpassen

Das Fenster Kamera kann die Überlagerung ohne neue Kalibrierung leicht verschieben, strecken und drehen sowie Helligkeit, Kontrast, Sättigung und Gamma einstellen oder das Bild grau zeigen. Diese Einstellungen ändern nur die Anzeige, nicht die Kalibrierung.

## Kopfkamera

Eine Kamera am Laserkopf sieht nur einen kleinen Bereich. KizamuBeam kalibriert sie mit kleinen Markern rund um die Kopfposition und legt jedes Bild an der Kopfposition ab, an der es aufgenommen wurde. **Bett erfassen** oder **Auswahl erfassen** fährt den Kopf (Laser aus) über den Bereich und setzt die Bilder zusammen. Das Sichtfeld wird an der Kopfposition gestrichelt angezeigt.

## Auf Werkstücke übertragen {#place-on-workpieces}

**Auf Werkstücke übertragen** (im Fenster Kamera oder **Werkzeugkasten → Vervielfältigen und Anordnen**) findet gleiche Werkstücke im Kamerabild und legt den ausgewählten Entwurf auf jedes davon, in passender Lage und Drehung.

1. Leg die Werkstücke auf das Bett und nimm ein Bild auf.
2. Wähle deinen Entwurf aus. Zeichne entweder den Umriss des Werkstücks um ihn herum (der Umriss darf irgendwo liegen, etwa neben dem Bett), oder leg den Entwurf auf eines der erkannten Werkstücke.
3. Klicke im Dialog Werkstücke an, um sie ein- oder auszuschließen, drehe sie um 90° oder 180° und prüfe die gestrichelte orange Vorschau auf der Arbeitsfläche.

Werkstücke werden über die Helligkeit vom Bett unterschieden, zuverlässiger mit einem gemerkten Foto des leeren Betts. Empfindlichkeit und Mindestgröße sind einstellbar. Optionen: Umriss mit übertragen, Vorlage danach ausblenden, je Werkstück gruppieren. Ein Rückgängig-Schritt.

Für Serien mit festem Layout ist ein [Jig](print-and-cut.md#jigs) oft genauer.
