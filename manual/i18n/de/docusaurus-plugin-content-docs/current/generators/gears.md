---
sidebar_position: 1
title: Zahnräder und Zahnstangen
description: Evolventen-Stirnräder, Zahnradpaare im richtigen Achsabstand und passende Zahnstangen.
---

# Zahnräder und Zahnstangen

Die Zahnrad-Generatoren erzeugen echte Evolventenzähne, so berechnet, wie ein Wälzfräser sie schneidet, mit exakter Fußrundung und Unterschnitt bei kleinen Zähnezahlen. Die Konturen sind Bézierkurven mit höchstens 0,004 mm Abweichung von der wahren Form. Du findest sie unter **Werkzeugkasten → Mechanik**.

## Zahnrad

| Feld | Bedeutung |
|---|---|
| **Zähnezahl** | 5 bis 400. |
| **Modul** | Teilkreisdurchmesser geteilt durch die Zähnezahl. Ineinandergreifende Räder brauchen dasselbe Modul. Der Teilkreisdurchmesser ist Modul × Zähnezahl: 24 Zähne bei Modul 2 ergeben 48 mm. |
| **Eingriffswinkel** | Üblich sind 20°. Ineinandergreifende Räder brauchen denselben Winkel. |
| **Flankenspiel** | Spiel der Zahnradpaarung auf dem Teilkreis; die Zähne jedes Rads werden um die Hälfte dünner. |
| **Schnittfuge (Kerf)** | Breite des Laserschnitts; die Kontur wird um die Hälfte nach außen versetzt, die Bohrung nach innen. |
| **Bohrung** | Keine, **Rund**, **D-Profil (abgeflacht)** mit dem Maß über Abflachung oder **Mit Passfedernut** mit Nutbreite und Nuttiefe. |

Unter **Erweitert**:

- **Profilverschiebung x**: Positive Werte machen die Zähne am Fuß kräftiger und vermeiden Unterschnitt bei kleinen Rädern; der Achsabstand ändert sich um x × Modul.
- **Fußrundung** und **Kopfspiel** (× Modul): Normwerte sind 0,38 und 0,25.

Flankenspiel und Schnittfuge sind bewusst getrennt: Das Flankenspiel schafft Platz zwischen den Zähnen zweier Räder, die Schnittfuge gleicht das Material aus, das der Laser wegnimmt.

## Zahnradpaar

**Zahnradpaar** erzeugt zwei passende Räder im richtigen Achsabstand, als eine Baugruppe. In der [3D-Ansicht](../features/construction-3d.md#3d-view) greifen sie ineinander und lassen sich drehen.

| Feld | Bedeutung |
|---|---|
| **Zähnezahl Rad 1** / **Zähnezahl Rad 2** | Die Übersetzung ist Zähne 2 ÷ Zähne 1. |
| **Modul**, **Eingriffswinkel**, **Flankenspiel**, **Schnittfuge (Kerf)** | Wie beim einzelnen Zahnrad. |
| **Grundplatte mit Achslöchern** | Fügt eine Platte mit beiden Achslöchern im richtigen Abstand hinzu, mit **Achslochdurchmesser** und **Rand der Grundplatte** um die Kopfkreise. |
| **Bohrung** | Je Rad. |

**Profilverschiebung Rad 1** (Erweitert) verschiebt das kleine Rad; Rad 2 bekommt die entgegengesetzte Verschiebung, sodass der Achsabstand gleich bleibt.

## Zahnstange

Eine **Zahnstange** ist ein gerades Zahnrad, das mit einem Stirnrad kämmt: Aus Drehung wird eine geradlinige Bewegung.

| Feld | Bedeutung |
|---|---|
| **Zähnezahl** | Länge der Zahnstange in Zähnen (die Länge ist Zähne × Modul × π). |
| **Modul**, **Eingriffswinkel** | Müssen zum Zahnrad passen. |
| **Flankenspiel** | Wird zwischen Zahnstange und Rad aufgeteilt. |
| **Rückenhöhe** | Material unter dem Zahnfuß. |
| **Schnittfuge (Kerf)** | Wie beim Zahnrad. |

## Tipps

- Sperrholz und Acryl ab 3 mm funktionieren gut ab Modul 1,5. Kleinere Module brauchen einen dünnen, genauen Strahl.
- Schneide ein Zahnradpaar und probiere es auf zwei Stiften aus, bevor du einen größeren Mechanismus baust; klemmt es, erhöhe das Flankenspiel.
- Steck einen Stift durch die Mittelbohrung, statt dich nur auf die Bohrung im Sperrholz zu verlassen: Holz nutzt sich schnell ab.
