---
sidebar_position: 18
title: Virtuelle Maschine
description: Jobs, Kamerafunktionen und Print and Cut ohne Hardware mit der KizamuBeam Virtual Machine ausprobieren.
---

# Virtuelle Maschine

Die **KizamuBeam Virtual Machine** ist ein eigenes Programm (ein eigener Download auf der [Release-Seite](https://github.com/negurvulkan/kizamubeam/releases)), das sich wie ein Laser mit FluidNC-3.7- oder GRBL-1.1-Steuerung verhält. Nutze sie, um KizamuBeam kennenzulernen, einen Job auszuprobieren, bevor du Material verschwendest, oder Kamerafunktionen ohne Kamera zu testen.

## Verbinden

1. Starte die Virtual Machine.
2. Lege in KizamuBeam ein Gerät aus der Vorlage **KizamuBeam Virtual Machine** an und verbinde.

Die Virtual Machine lauscht auf Telnet (Port 2323) und WebSocket (Port 8181). Die Ports lassen sich ändern, und die Maschine kann wahlweise auch aus dem Netz erreichbar sein. Andere Programme verbinden sich mit ihr als GRBL- oder FluidNC-Netzwerkgerät.

## Was sie zeigt

- **Draufsicht**: das Bett mit Brandspuren (dunkler bei mehr Leistung), Eilgängen und dem Kopf mit Laserpunkt.
- **3D-Ansicht**: Bett, Rahmen, Portal, Laserkopf und Strahl. Lege Werkstücke mit Größe, Dicke, Position und einem der 21 Materialaussehen hin. Jede Linie brennt sich in Echtzeit ins Material: Langsamere oder stärkere Durchgänge werden dunkler und tiefer, und wo die Energie reicht, wird das Material durchtrennt.
- **Teile**: Sobald eine Form ringsum geschnitten ist, wird sie zum losen Teil. Nimm es heraus, dreh es um und sieh es dir genau an. Ein Teil, das noch an einer nicht durchtrennten Stelle hängt, wird orange markiert.
- **Zustand**: Positionen, Overrides, Planer, Laufzeit, Verbindungen und eine Konsole.

Das Brandmodell ist auf einen 10-W-Diodenlaser abgestimmt (100 % bei 300 mm/min schneiden 3 mm Sperrholz). Es ist ein Modell, keine Messung; echte Materialien brauchen weiterhin einen [Materialtest](materials-tests.md#material-test).

## Wie eine echte Maschine

Die Virtual Machine bildet den Empfangspuffer, den Bewegungsplaner mit Beschleunigung, Echtzeitbefehle (Halt, Weiter, Reset, Overrides, Air Assist), Referenzfahrt, Verfahren, Werkstück-Offsets und Alarme nach. Sie meldet, wenn ein Programm den Empfangspuffer überfüllt, und fährt der Kopf in den Rahmen, verliert sie ihre Position wie eine echte Maschine. **Aus/Ein** schaltet sie aus und wieder ein.

## Virtuelle Kamera

Die Virtual Machine rendert ein Kamerabild ihrer 3D-Szene, von oberhalb des Betts oder vom Laserkopf aus, und liefert es wie eine Netzwerkkamera (MJPEG-Stream unter `http://…:8282/stream`). Füge sie in KizamuBeam im Fenster [Kamera](camera.md) als Netzwerkkamera hinzu, um Kalibrierung, Werkstückerkennung und [Print and Cut](print-and-cut.md) ohne Hardware auszuprobieren.

## Ruida-Modus

Die Virtual Machine kann auch wie eine Ruida-Steuerung (wie in vielen CO2-Lasern) über UDP antworten. Das ist zum Testen anderer Programme gedacht, die Ruida sprechen; KizamuBeam selbst unterstützt Ruida-Steuerungen noch nicht.

## Fenster

Die Seitenleiste lässt sich in der Breite ändern, ausblenden (Ctrl+B, ⌘B auf dem Mac) und links oder rechts anordnen. Design und Sprache stehen unter **Einstellungen → Ansicht**.
