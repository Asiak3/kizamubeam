---
sidebar_position: 13
title: Drehachse
description: Becher, Gläser und andere runde Gegenstände mit einer Walzen- oder Futter-Drehachse gravieren, auch konische Objekte.
---

# Drehachse

Eine Drehachse (Rotary) dreht einen runden Gegenstand unter dem Laser, sodass du Becher, Gläser, Flaschen oder Nudelhölzer gravieren kannst. KizamuBeam rechnet die Y-Richtung deines Entwurfs in eine Drehung des Gegenstands um.

## Einrichten

Öffne **Laser → Gerät → Drehachse (Rotary) …** (oder **Drehachse …** im Fenster Laser). Die Einstellungen werden je Gerät gespeichert:

| Einstellung | Bedeutung |
|---|---|
| **Drehachse einschalten** | Schaltet den Rotary-Modus für dieses Gerät ein. |
| **Walzen / Futter** | Walzen: Der Gegenstand liegt auf angetriebenen Walzen. Futter: Der Gegenstand wird eingespannt und direkt gedreht. |
| **Achse** | Y (Rotary statt des Y-Motors angeschlossen) oder eine eigene Achse A, B, C oder Z. |
| **Achsweg pro Umdrehung** | Wie weit die Achse (in mm oder Grad, meist 360°) für eine volle Umdrehung der Walze oder des Futters fährt. |
| **Walzendurchmesser** | Durchmesser der angetriebenen Walze (nur bei Walzen). |
| **Objektdurchmesser** | An der breitesten Stelle der Gravur gemessen. Du kannst stattdessen den Umfang eingeben, etwa mit einem Maßband gemessen. |
| **Drehrichtung umkehren** | Dreht die Drehrichtung um, wenn die Gravur gespiegelt herauskommt. |

**Testdrehung** dreht den Gegenstand mit den eingegebenen Werten genau einmal herum. Dreht er zu weit oder zu kurz, passe den Achsweg pro Umdrehung im gleichen Verhältnis an.

## So funktioniert es

Bei eingeschalteter Drehachse:

- wird die Y-Richtung des Entwurfs zur Drehung, und die Geschwindigkeit wird so angepasst, dass sie auf der Oberfläche stimmt,
- gilt das für Jobs, Bilder, Rahmen, Verschieben und Hier starten,
- wird nur X gegen das Bett geprüft, und KizamuBeam warnt, wenn der Entwurf höher ist als der Umfang des Gegenstands,
- wird eine eigene Achse beim Start auf null gesetzt (`G92 A0` bzw. B, C, Z), und der Rahmen kehrt danach zum Start zurück,
- fragt KizamuBeam vor einer Referenzfahrt nach, wenn der Rotary am Y-Anschluss hängt (die Referenzfahrt würde ihn drehen).

## Konische Gegenstände

Becher und viele Gläser sind unten dünner als oben. Gib den Objektdurchmesser am linken und rechten Rand des Jobs ein. Die Drehung folgt dann an jeder X-Position dem Durchmesser, sodass die Gravur ihre echte Größe behält und die Mitte des Jobs gerade bleibt. Bei Walzen nimmt KizamuBeam an, dass der Gegenstand auf seinem dickeren Ende aufliegt.

## Tipps

- Lege den Entwurf so an, dass seine Höhe (Y) nicht größer ist als der Umfang des Gegenstands (Durchmesser × π).
- Fokussiere auf den höchsten Punkt des Gegenstands, direkt unter dem Kopf.
- Fahre zuerst einen Rahmen: Der Kopf bewegt sich entlang X, und der Gegenstand dreht sich.
- Schreib den Objektdurchmesser in die [Projektnotizen](materials-tests.md#project-notes), dann geht der nächste Durchlauf schnell.
