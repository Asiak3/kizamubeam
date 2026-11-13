---
sidebar_position: 12
title: Jobs ausführen und Maschine steuern
description: Jobs starten, umfahren und in der Vorschau ansehen, festlegen, wo ein Job beginnt, Leistung und Geschwindigkeit beim Lasern anpassen und Geräte einrichten.
---

# Jobs ausführen und Maschine steuern

Diese Seite beschreibt alles, was nach dem Entwurf passiert. Wie du einen Laser zum ersten Mal verbindest, steht unter [Laser verbinden](../getting-started/connect-laser.md).

Die Maschinenfenster liegen standardmäßig rechts: **Laser** (Job, Status, Geräte), **Verschieben** (Verfahren und Ursprung) und **Konsole**.

## Vorschau

**Laser → Vorschau …** (Alt+P) simuliert den Job, bevor sich etwas bewegt:

- Wiedergabe mit Zeitregler, Leerwegen und Schattierung nach Leistung,
- eine Zeitschätzung, die Beschleunigung und Ecken berücksichtigt,
- dieselbe Reihenfolge wie der echte Job.

**Hier starten** lasert den Job ab der Position des Zeitreglers, etwa nach einem Abbruch. Der Kopf fährt mit ausgeschaltetem Laser dorthin und macht mit Leistung, Geschwindigkeit und Air Assist dieses Layers weiter.

## Rahmen

**Rahmen** fährt das Rechteck um den Job ab, **Kontur-Rahmen** folgt seinem Umriss. Beides kann mit schwachem Laser laufen, damit du den Rahmen auf dem Material siehst. Prüfe mit dem Rahmen vor dem Start, ob der Job auf das Werkstück passt.

## Starten, pausieren und stoppen

**Start** schickt den Job ab. Währenddessen zeigt das Fenster Laser Fortschritt, vergangene und verbleibende Zeit.

- **Pause** hält die Maschine an, **Weiter** macht weiter.
- **Stopp** bricht den Job ab und setzt die Steuerung zurück. Die Position bleibt erhalten.
- **Nur Auswahl** lasert nur die ausgewählten Objekte.

Vor jedem Job und jedem Rahmen prüft KizamuBeam, ob alle Bewegungen samt Überfahrweg im Arbeitsbereich der Maschine bleiben. Hat die Steuerung ihren Ursprung noch nicht gemeldet (oder tut das nie, wie Marlin), zeigt eine Warnung die Ausdehnung des Jobs, die du bestätigen musst.

## Wo der Job beginnt

Die Einstellung **Starten ab** im Fenster Laser entscheidet, wo der Job landet:

| Starten ab | Bedeutung |
|---|---|
| **Absolute Koordinaten** | Der Job liegt genau dort, wo er auf der Arbeitsfläche liegt. Die Arbeitsfläche ist das Maschinenbett. Braucht eine Referenzfahrt. |
| **Benutzer-Ursprung** | Der Job beginnt an einem Ursprung, den du im Fenster Verschieben setzt. |
| **Aktuelle Position** | Der Job beginnt dort, wo der Kopf gerade steht. |

Bei Benutzer-Ursprung und Aktueller Position legt der **Job-Ursprung** (neun Punkte: Ecken, Kantenmitten, Mitte) fest, welcher Punkt des Jobs an dieser Stelle liegt.

## Beim Lasern nachsteuern

**Nachsteuern** im Fenster Laser ändert Leistung und Geschwindigkeit in Schritten von 1 und 10 % (von 10 bis 200 %) und Eilgänge auf 25, 50 oder 100 %, während der Job läuft. Air Assist lässt sich sofort ein- und ausschalten, auch während eines Jobs. Das funktioniert mit GRBL, grblHAL und FluidNC.

## Schnittreihenfolge

Das Fenster Laser hat drei Optionen für die Reihenfolge der Schnitte. Die Layer werden immer in der Reihenfolge der Layer-Tabelle gelasert.

| Option | Wirkung |
|---|---|
| **Innere Formen zuerst** | Löcher und Innenkonturen werden vor ihrer Außenkontur geschnitten, damit Teile nicht herausfallen, bevor ihre Löcher geschnitten sind. |
| **Leerwege verkürzen** | Die nächstgelegene Form wird als nächste geschnitten. Ist die Option aus, gilt die Reihenfolge aus dem Fenster Objekte (manuelle Reihenfolge). |
| **Gruppen zusammenhalten** | Formen desselben Objekts oder derselben Gruppe werden bevorzugt nacheinander geschnitten. |

Wo ein einzelner Schnitt beginnt und in welche Richtung er läuft, legst du mit dem Startpunkt-Werkzeug fest (siehe [Pfade und Formen](paths.md)).

## Fenster Verschieben

Das Fenster **Verschieben** verfährt den Kopf in Schritten, setzt und löscht den Benutzer-Ursprung, entsperrt die Maschine nach einem Alarm, macht eine Referenzfahrt und fährt den Kopf:

- **Laser zur Auswahl** fährt den Kopf zu den ausgewählten Objekten.
- **Laser zur Klickposition**: Solange die Schaltfläche aktiv ist, fährt jeder Klick auf die Arbeitsfläche den Kopf mit ausgeschaltetem Laser dorthin. Esc beendet den Modus.

## Konsole

Die **Konsole** zeigt die Meldungen der Steuerung und lässt dich Befehle senden, mit Verlauf. Alarme und aktive Eingänge (Endschalter, Tür, Taster) werden verständlich erklärt.

## G-Code speichern

**Laser → G-Code speichern …** schreibt den Job in eine Datei, etwa um ihn von einer SD-Karte oder mit einem anderen Programm auszuführen.

## Geräte und Geräteeinstellungen

Jeder Laser ist ein **Gerät** mit eigener Verbindung, eigenem Arbeitsbereich und eigenen Einstellungen. Wähle das Gerät oben im Fenster Laser oder verwalte die Geräte unter **Laser → Gerät → Geräte …**. Neue Geräte können von Vorlagen für verbreitete Laser ausgehen.

**Laser → Gerät → Geräteeinstellungen …** enthält unter anderem:

- Arbeitsbereich, S-Wert für 100 % Leistung, Baudrate, Netzwerkadresse,
- Eilganggeschwindigkeit und Beschleunigung (**Von der Maschine lesen** holt sie von FluidNC oder GRBL),
- Größe des Empfangspuffers,
- Endschalter (mit „Keine“ macht KizamuBeam nie von selbst eine Referenzfahrt und fragt vorher nach),
- motorisierte Z-Achse (für Z-Versatz je Durchgang und den Fokustest),
- Befehl für Air Assist (M8 oder M7),
- **G-Code-Skripte**: Befehle, die vor und nach jedem Job laufen,
- **Rotpunkt-Zeiger**: der Versatz zwischen Laserstrahl und Zeiger, damit Rahmen und Klickfahrten mit dem roten Punkt zielen können,
- **FluidNC**-Extras (siehe unten).

## FluidNC-Extras

Mit einer FluidNC-Steuerung bietet **Laser → FluidNC**:

- **Job von SD-Karte oder Flash ausführen**: den Job zuerst hochladen und dort ausführen, sodass ein WLAN-Aussetzer ihn nicht stoppt. Pause und Stopp funktionieren wie gewohnt.
- **Dateien auf der Steuerung**: Dateien auflisten, hochladen, ausführen und löschen.
- **Konfiguration …**: die config.yaml lesen, durchsuchen und ändern, Werte ausprobieren oder speichern und neu starten. Jedes Speichern sichert den vorherigen Stand (die letzten zehn je Gerät), den du wiederherstellen kannst.
- **Ausgänge**: Freie Ausgänge (etwa eine Absaugung) lassen sich im Fenster Laser schalten und während jedes Jobs automatisch einschalten.

## Steuerungen

KizamuBeam arbeitet mit FluidNC, GRBL 1.1, grblHAL, Marlin und Smoothieware. Die Schaltflächen für Referenzfahrt, Verfahren, Ursprung und Konsole passen sich der Steuerung an. Einzelheiten und getestete Laser stehen unter [Maschinenkompatibilität](../reference/machine-compatibility.md).

## Drehachse und entfernte Laser

- Zylinder gravieren: siehe [Drehachse](rotary.md).
- Einen Laser nutzen, der an einem anderen Rechner hängt: siehe [Fernsteuerung](remote-control.md).
- Alles ohne Laser ausprobieren: siehe [Virtuelle Maschine](virtual-machine.md).
