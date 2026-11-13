---
sidebar_position: 20
title: KI-Agenten (MCP)
description: Einen KI-Assistenten wie Claude über das Model Context Protocol deinen Entwurf lesen und ändern lassen, während du den Laser in der Hand behältst.
---

# KI-Agenten (MCP)

KizamuBeam lässt sich über das **Model Context Protocol (MCP)** von einem KI-Assistenten steuern. Der Assistent kann dein Projekt lesen, zeichnen, Generatoren ausführen, die Konstruktion prüfen und, wenn du es erlaubst, den Laser um einen Start bitten. Jede Maschinenaktion braucht weiterhin deine Bestätigung in KizamuBeam.

## Einschalten

Öffne **Datei → KI-Agenten (MCP) …**. Der Zugang ist standardmäßig aus.

1. Schalte den Server ein. Er läuft nur auf deinem eigenen Rechner unter `http://127.0.0.1:47800/mcp` und ist aus dem Netz nicht erreichbar.
2. Wähle die Zugriffsstufe (siehe unten).
3. Übernimm Token und Konfiguration in deinen KI-Client.

Für Clients, die nur stdio sprechen, startest du die Brücke mit `kizamubeam --mcp-stdio`.

## Zugriffsstufen

| Stufe | Der Assistent darf |
|---|---|
| **Nur lesen** | Dokument, Layer, Materialien, Geräte und Schriften lesen, ein Vorschaubild und eine Zeitschätzung abrufen |
| **Lesen und entwerfen** | zusätzlich Objekte erzeugen und ändern: Formen, Text, QR-Codes und Strichcodes, boolesche Operationen, Offset, Pfadwerkzeuge, Arrays, Verschachteln, Verbindungen, Biegeschnitte, Musterfüllung, Generatoren, 3D-Modelle, Parameter, Vorlagen, die Bibliothek, Serien, Layer, Seiten und Dateien |
| **Zusätzlich G-Code erzeugen** | zusätzlich G-Code erzeugen, ohne ihn an die Maschine zu senden |
| **Zusätzlich Laser bedienen** | zusätzlich verbinden, pausieren, stoppen und einen Job, einen Rahmen oder eine Referenzfahrt anfordern |

Die Laser-Stufe gilt nur, bis KizamuBeam beendet wird.

## Sicherheit

- Ein Assistent schickt nie rohen G-Code an den Laser. Er kann einen Job, einen Rahmen oder eine Referenzfahrt nur *anfordern*; ausgeführt wird erst nach deiner Bestätigung in KizamuBeam.
- Jobs müssen im Arbeitsbereich und in den Grenzen des Geräts bleiben.
- Pause und Stopp funktionieren immer.
- Jede Maschinenaktion wird protokolliert.

## Rückgängig

Jeder Aufruf des Assistenten ist ein Schritt im Rückgängig-Verlauf, benannt nach dem verwendeten Werkzeug. Mit **Ctrl+Z** oder dem Fenster Verlauf gehst du zurück.

## Ideen

- „Mach eine Box mit Fingerzinken, innen 120 × 80 × 60 mm, aus 3 mm Sperrholz.“
- „Prüf die Konstruktion und behebe, was du kannst.“
- „Setz die Namen aus dieser Liste auf Namensschilder, jeweils eine Seite.“
- „Mach aus dieser STL-Datei ein Rippenmodell.“
