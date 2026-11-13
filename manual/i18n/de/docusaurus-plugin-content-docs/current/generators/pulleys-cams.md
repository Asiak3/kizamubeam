---
sidebar_position: 2
title: Riemenscheiben und Nocken
description: Zahnriemenscheiben für GT2- und HTD-Riemen und Kurvenscheiben mit wählbarem Bewegungsgesetz und Stößel.
---

# Riemenscheiben und Nocken

Beide Generatoren stehen unter **Werkzeugkasten → Mechanik**.

## Riemenscheibe

Eine **Riemenscheibe** für Zahnriemen, deren Außendurchmesser aus Teilung und Wirklinienabstand des Riemens berechnet wird.

| Feld | Bedeutung |
|---|---|
| **Riemenprofil** | GT2 (2, 3 oder 5 mm Teilung) oder HTD (3M, 5M). |
| **Zähnezahl** | 8 bis 400. |
| **Spiel der Zahnlücke** | Weitet jede Zahnlücke, damit der Riemen leicht einläuft (negative Werte machen sie enger). |
| **Schnittfuge (Kerf)** | Breite des Laserschnitts. |
| **Bohrung** | Keine, rund, D-Profil oder mit Passfedernut, wie bei Zahnrädern. |

Die Zahnlücken sind rund, mit der für das Profil üblichen Tiefe und Breite. Eine Riemenscheibe wird meist aus mehreren verleimten Lagen geschnitten, mit einer größeren Scheibe auf jeder Seite als Bord.

## Nocken

Ein **Nocken** (eine Kurvenscheibe) macht aus einer Drehung eine Hubbewegung eines Stößels: für Automaten, Spielzeug und einfache Mechanismen. Eine Umdrehung teilt sich in Hub, Rast oben, Rückhub und Rast unten.

| Feld | Bedeutung |
|---|---|
| **Grundkreisradius** | Kleinster Radius des Nockens: Hier steht der Stößel am tiefsten. |
| **Hub** | Wie weit der Stößel steigt. |
| **Hubwinkel** | Drehwinkel, über den der Stößel steigt. |
| **Rast oben** | Drehwinkel, über den er oben bleibt. |
| **Rückhubwinkel** | Drehwinkel, über den er wieder sinkt. Der Rest der Umdrehung ist die Rast unten. |
| **Bewegungsgesetz** | **Zykloide (ruckarm)**, **Polynom 5. Grades** oder **Harmonisch**. Die Zykloide läuft am ruhigsten. |
| **Stößel** | **Mit Rolle** (mit **Rollendurchmesser**) oder **Spitze**. |
| **Schnittfuge (Kerf)** | Breite des Laserschnitts. |
| **Bohrung** | Wie bei Zahnrädern. |

Der Dialog prüft Druckwinkel und Rollengröße: Ist der Nocken für den Stößel zu steil oder die Rolle zu groß für eine Mulde im Nocken, erscheint eine Warnung. Ein größerer Grundkreis oder ein längerer Hubwinkel hilft.
