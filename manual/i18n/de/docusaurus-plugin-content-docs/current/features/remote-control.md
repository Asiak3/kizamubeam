---
sidebar_position: 17
title: Fernsteuerung
description: Einen Laser nutzen, der an einem anderen Rechner mit KizamuBeam hängt, über das Heimnetz oder ein VPN.
---

# Fernsteuerung

Der Laser steht oft in der Werkstatt, während du am Schreibtisch entwirfst. Mit der Fernsteuerung läuft KizamuBeam auf dem Rechner neben dem Laser im **Host-Modus**, und andere Rechner nutzen diesen Laser, als wäre er bei ihnen angeschlossen.

## Host einrichten

Auf dem Rechner, an dem der Laser hängt:

1. Verbinde den Laser wie gewohnt (siehe [Laser verbinden](../getting-started/connect-laser.md)).
2. Wähle **Laser → Fernsteuerung → Host-Modus …** und schalte den Host-Modus ein. Standardmäßig ist er aus.
3. Kreuze bei Bedarf **Fernstarts an diesem Rechner bestätigen** an, dann muss jeder Fernstart am Laser bestätigt werden.

Der Host lauscht auf Port 47900. Die Verbindung ist verschlüsselt.

## Einen Rechner koppeln

Auf dem anderen Rechner:

1. Lege ein Gerät an (**Laser → Gerät → Geräte …**) mit der Verbindung **Anderer KizamuBeam (Netzwerk)**.
2. Klicke auf **Host suchen …**, um Hosts im Netz zu finden, oder gib die Adresse des Hosts ein (über ein VPN wie Tailscale oder WireGuard von Hand).
3. Klicke auf **Koppeln …**. Der Host zeigt einen 6-stelligen Code; tippe ihn auf diesem Rechner ein.

Der Host listet alle gekoppelten Rechner und kann sie entfernen oder ihre Rolle ändern:

| Rolle | Darf |
|---|---|
| **Bediener** | verfahren, Rahmen fahren, starten, pausieren und stoppen |
| **Zuschauer** | nur Status, Fortschritt und Konsole ansehen |

## Jobs aus der Ferne starten

**Start** schickt keinen G-Code. Es schickt das Projekt (Layer, Schnitteinstellungen, Bilder) und die verwendeten Schriften. Der Host berechnet den Job mit seinen eigenen Geräteeinstellungen und führt ihn über seine eigene Verbindung aus. Bevor der Laser startet, siehst du die Vorschau des Hosts, die geschätzte Zeit und etwaige Warnungen (Arbeitsbereich, fehlende Schriften, Air Assist).

Rahmen, Kontur-Rahmen, Materialtest, Fokustest und der Testjob der Einrichtung funktionieren genauso. Verfahren, Referenzfahrt, Konsole, Nachsteuern, Pause und Stopp gehen direkt an die Maschine des Hosts. Status und Fortschritt erreichen jeden verbundenen Rechner, und ein Netzwerkaussetzer unterbricht nie einen laufenden Job: Der Host macht weiter. Wer am Host steht, kann jederzeit pausieren oder stoppen.

Ein Fernstart wird abgelehnt, solange die Maschine des Hosts beschäftigt oder nicht verbunden ist. **Hier starten** und roher G-Code vom Client sind noch nicht möglich.

## Fernaufträge auf dem Host

**Laser → Fernsteuerung → Fernaufträge …** zeigt auf dem Host die letzten 20 empfangenen Jobs mit Vorschau, Absender und Uhrzeit. Starte einen erneut (er wird mit den aktuellen Einstellungen neu berechnet) oder **Im Editor öffnen** als normales Projekt.

## Einstellungen vom Host übernehmen

**Laser → Fernsteuerung → Vom Host übernehmen …** kopiert die Geräteeinstellungen des Hosts auf dein Gerät (Name und Verbindung bleiben), führt die Material-Bibliothek des Hosts zusammen und fügt die Kameras des Hosts mit ihrer Kalibrierung hinzu. Das Kamerabild kommt dann über die Verbindung, mit einigen Bildern pro Sekunde.
