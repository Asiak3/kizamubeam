---
sidebar_position: 4
title: Laser verbinden
description: Einen Laser mit GRBL, grblHAL, FluidNC, Marlin oder Smoothieware per USB oder WLAN mit dem Assistenten verbinden.
---

# Laser verbinden

KizamuBeam arbeitet mit Lasern, deren Controller **FluidNC, GRBL, grblHAL, Marlin oder Smoothieware** nutzt. Das sind die meisten Diodenlaser. Einzelheiten unter [Maschinenkompatibilität](../reference/machine-compatibility.md).

## Der Assistent „Laser einrichten“

Am einfachsten geht es mit dem Assistenten: **Laser → Laser einrichten …** oder der Knopf im Fenster Laser. Beim allerersten Start der App öffnet er sich von selbst. Er führt dich in fünf Schritten von der ersten Verbindung bis zu einem ersten, sicheren Testjob.

```mermaid
flowchart LR
  A[1. Verbinden] --> B[2. Erkennen]
  B --> C[3. Prüfen]
  C --> D[4. Bewegen]
  D --> E[5. Testjob]
```

1. **Verbinden**: Wähle eine Gerätevorlage für deinen Laser oder eine allgemeine für deinen Controller, dann USB oder Netzwerk, und verbinde. KizamuBeam fährt beim Verbinden nie eine Referenzfahrt.
2. **Erkennen**: KizamuBeam fragt den Controller nach Firmware und Version und liest seine Einstellungen, etwa Arbeitsbereich, Leistungsskala und Lasermodus.
3. **Prüfen**: Probleme werden verständlich aufgelistet, zum Beispiel ein abweichender Arbeitsbereich, ausgeschalteter Lasermodus oder Referenzfahrt ohne Endschalter. Einstellungen in KizamuBeam übernimmst du mit einem Klick. Änderungen am Controller werden nur vorgeschlagen, zusammen mit dem Befehl zum Rückgängigmachen, und erst nach deiner Bestätigung gesendet.
4. **Bewegen**: Der Kopf fährt mit ausgeschaltetem Laser in X und Y, und du sagst, wohin er gefahren ist. Für eine vertauschte Achse gibt es einen Korrekturvorschlag.
5. **Testjob**: ein kleines Quadrat mit Kreis bei niedriger Leistung, mit Vorschau und Rahmen. Er startet erst, wenn du Material und Fokus, Rahmen, Schutzbrille und Absaugung bestätigt hast.

## USB

Verbinde den Laser per USB-Kabel, wähle im Assistenten oder im Fenster Laser **USB** und den Anschluss. Die Baudrate steht in den Geräteeinstellungen (115200 bei den meisten Controllern).

- **Windows**: Manche Controller brauchen einen USB-Treiber (oft CH340 oder CP210x) vom Hersteller des Lasers.
- **Linux**: Dein Benutzer braucht Zugriff auf serielle Schnittstellen, siehe [Installation](installation.md#linux).

## WLAN

Controller mit WLAN, etwa FluidNC, erreichst du übers Netzwerk:

- **Telnet** auf Port 23 oder
- **WebSocket** auf Port 81 (FluidNC; antwortet 81 nicht, wird Port 80 versucht).

Gib die Adresse des Controllers ein, zum Beispiel `192.168.1.50` oder `fluidnc.local`. **Suchen …** neben dem Adressfeld findet FluidNC-Controller in deinem Netzwerk.

:::tip Wackeliges WLAN
Bei FluidNC kannst du einen Job auf die SD-Karte oder den Flash-Speicher des Controllers laden und dort starten (**Laser → FluidNC**). Ein WLAN-Abbruch stoppt den Job dann nicht mehr.
:::

## Mehrere Geräte

Jeder Laser wird als Gerät mit eigenem Arbeitsbereich, eigener Verbindung und eigenen Einstellungen gespeichert. Du wechselst oben im Fenster Laser oder unter **Laser → Gerät → Geräte …**. Gerätevorlagen gibt es für viele verbreitete Laser (zum Beispiel Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees, Longer und Comgrow); die Arbeitsfläche zeigt immer das Bett des gewählten Geräts.

## Ohne Laser

Die **KizamuBeam Virtual Machine** ist ein eigenes Programm, das sich wie ein FluidNC- oder GRBL-Controller verhält und den Job in 3D zeigt, eingebrannt in virtuelles Material. Lade sie von der [Release-Seite](https://github.com/negurvulkan/kizamubeam/releases?q=vm-v) und verbinde dich über die Gerätevorlage „KizamuBeam Virtual Machine“.
