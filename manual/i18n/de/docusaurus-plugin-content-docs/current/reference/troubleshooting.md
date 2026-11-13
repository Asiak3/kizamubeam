---
sidebar_position: 4
title: Fehlerbehebung
description: Lösungen für häufige Probleme bei der Installation von KizamuBeam und beim Verbinden eines Lasers.
---

# Fehlerbehebung

## Installation

**macOS meldet, die App könne nicht überprüft werden oder sei beschädigt.**
Die App ist noch nicht von Apple beglaubigt. Öffne **Systemeinstellungen → Datenschutz & Sicherheit** und klicke auf **Dennoch öffnen**, oder gib im Terminal `xattr -cr /Applications/KizamuBeam.app` ein. Siehe [Installation](../getting-started/installation.md#macos).

**Windows SmartScreen blockiert den Installer.**
Klicke auf **Weitere Informationen → Trotzdem ausführen**. Der Installer ist noch nicht code-signiert.

## Verbindung

**Der USB-Anschluss taucht nicht auf.**
- Probiere ein anderes Kabel: Manche USB-Kabel laden nur und übertragen keine Daten.
- Schließe andere Programme, die den Anschluss belegen könnten (eine andere Lasersoftware, ein serielles Terminal).
- Windows: Installiere den USB-Treiber für deinen Controller (oft CH340 oder CP210x).
- Linux: Füge deinen Benutzer zur Gruppe `dialout` hinzu und melde dich ab und wieder an.

**Der Laser wird im WLAN nicht gefunden.**
- Computer und Laser müssen im selben Netzwerk sein.
- Gib die IP-Adresse des Controllers statt eines Namens wie `fluidnc.local` ein.
- Bei FluidNC hilft **Suchen …** neben dem Adressfeld, oder der Wechsel zwischen Telnet und WebSocket.

**Die Maschine meldet nach dem Verbinden einen Alarm.**
Viele Controller starten im Alarmzustand, bis eine Referenzfahrt gemacht oder entsperrt wurde. Fahre die Referenz an, wenn die Maschine Endschalter hat, sonst entsperre sie im Fenster Verschieben. Das Fenster Laser erklärt den Alarm in Klartext.

## Lasern

**Der Laser fährt, feuert aber nicht, oder nur mit voller Leistung.**
Die Leistungsskala in KizamuBeam (S-Wert für 100 %) muss zum Controller passen (`$30` bei GRBL), und der Lasermodus muss an sein (`$32=1`). Der [Einrichtungsassistent](../getting-started/connect-laser.md) erkennt beides und bietet eine Korrektur an.

**Eine Achse fährt in die falsche Richtung.**
Führe Schritt 4 („Bewegen“) des Einrichtungsassistenten aus. Er erkennt eine umgekehrte Achse und schlägt die passende Einstellung vor.

**KizamuBeam meldet, der Job passe nicht aufs Bett.**
Vor jedem Job prüft KizamuBeam alle Bewegungen gegen den Arbeitsbereich. Prüfe im Fenster Laser den Job-Ursprung und den Startmodus (absolute Koordinaten, Benutzer-Ursprung oder aktuelle Position) und den Arbeitsbereich in den Geräteeinstellungen.

**Der Job bricht ab, wenn das WLAN abreißt.**
Lade den Job bei FluidNC auf den Controller und starte ihn dort (**Laser → FluidNC**).

## Immer noch nicht weiter?

Frag auf [Discord](https://discord.gg/SSr8VHh7EJ) oder eröffne ein [GitHub-Issue](https://github.com/negurvulkan/kizamubeam/issues). Nenne dabei Betriebssystem, KizamuBeam-Version, Laser und Firmware.
