---
sidebar_position: 3
title: Maschinenkompatibilität
description: Welche Laser und Controller mit KizamuBeam funktionieren.
---

# Maschinenkompatibilität

KizamuBeam spricht direkt mit dem Controller deines Lasers und sendet G-Code oder binäre Ruida-`.rd`-Aufträge. Es funktioniert mit den meisten Diodenlasern und CO₂-Lasern, deren Controller eine dieser Firmwares nutzt:

| Firmware | Verbindung | Hinweise |
|---|---|---|
| **FluidNC** | USB, WLAN (Telnet, WebSocket) | Konfigurationseditor, Jobs von SD-Karte oder Flash des Controllers, Netzwerksuche |
| **GRBL 1.1** | USB, WLAN, wenn der Controller es anbietet | Echtzeitstatus und Overrides |
| **grblHAL** | USB, Netzwerk | Wie GRBL |
| **Marlin** | USB | Zeilenweise gesendet; Position über M114 |
| **Smoothieware** | USB | Zeilenweise gesendet; Leistung von 0 bis 1 |
| **xTool (USB)** | USB | xTool-D1-Familie; erkennt der Einrichtungsassistent. Den Status liest KizamuBeam nur im Leerlauf, daher gilt der Job als fertig, sobald die letzte Zeile angenommen ist. Noch nicht am Gerät getestet |
| **Ruida DSP** | Netzwerk (UDP 50200/50207), USB-Seriell, `.rd`-Dateiexport | RDC6442G/S, RDC6445G, RDC6332G, KT332N und kompatible CO₂-Controller; binärer `.rd`-Export/-Import, Direktsteuerung, Speichern benannter Jobs im Controller-Speicher, Rahmen und Joggen |

Drehachsen (Rollen oder Futter, am Y-Anschluss oder als eigene Achse), motorisierte Z-Achse und Air Assist werden unterstützt.

## Gerätevorlagen

Beim Anlegen eines Geräts füllen Vorlagen für verbreitete Laser Arbeitsbereich und Einstellungen aus, zum Beispiel Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees, Longer, Comgrow, OMTech und Ruida. Für jeden anderen Laser wählst du die allgemeine Vorlage für seinen Controller. Der [Einrichtungsassistent](../getting-started/connect-laser.md) liest dann die echten Werte aus der Maschine.

## (Noch) nicht unterstützt

- **Andere DSP-Controller** (etwa Trocen/AWC, TopWisdom oder Leetro): noch nicht unterstützt.
- **Galvo-Laser**: nicht unterstützt.
- **Laser mit proprietärem Protokoll**, etwa manche xTool-Modelle, die nur über das Netzwerkprotokoll des Herstellers sprechen.

## Von Nutzern getestet

Berichte von echten Maschinen helfen anderen. Erzähl uns auf [Discord](https://discord.gg/SSr8VHh7EJ) oder in einem [GitHub-Issue](https://github.com/KizamuBeam/kizamubeam/issues), welchen Laser du mit KizamuBeam nutzt und wie gut es klappt.
