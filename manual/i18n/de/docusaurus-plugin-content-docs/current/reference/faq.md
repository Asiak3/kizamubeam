---
sidebar_position: 5
title: Häufige Fragen
description: Antworten auf häufige Fragen zu KizamuBeam.
---

# Häufige Fragen

## Ist KizamuBeam wirklich kostenlos?

Ja. KizamuBeam steht unter der GPL-3.0-or-later: keine Lizenzgebühr, kein Abo, kein Konto, auch nicht für gewerbliche Nutzung.

## Funktioniert es mit meinem Laser?

Wenn dein Laser FluidNC, GRBL, grblHAL, Marlin oder Smoothieware nutzt, sehr wahrscheinlich; das betrifft die meisten Diodenlaser. Galvo-Laser und Ruida-/DSP-Controller werden nicht unterstützt. Siehe [Maschinenkompatibilität](machine-compatibility.md).

## Warum warnt mein Rechner bei der Installation?

Die Installer sind noch nicht code-signiert. Das ist bei jungen Open-Source-Projekten üblich. Siehe [Installation](../getting-started/installation.md).

## Kann ich meine bisherigen Materialeinstellungen und Projekte mitnehmen?

Ja. LightBurn-Materialbibliotheken (`.clb`) lassen sich importieren, soweit es passende Felder gibt, und LightBurn-Projekte (`.lbrn2`) öffnest du mit Formen, Bildern und Layer-Einstellungen. SVG, DXF, PDF und Illustrator-Dateien (`.ai`) importierst du wie gewohnt. Siehe [Dateiformate](file-formats.md).

## Ist KizamuBeam stabil genug für echte Projekte?

Ja. Seit Version 2.2.0 gibt es stabile Versionen, und KizamuBeam wird täglich auf echter Hardware genutzt. Wie bei jeder Lasersoftware gilt: neue Jobs mit Vorschau und Rahmen prüfen und wichtige Projekte sichern.

## Was hat es mit dem MCP-Server auf sich?

Damit können KI-Agenten Entwürfe lesen und bearbeiten. Er ist standardmäßig aus, läuft nur lokal mit Token, und an die Maschine geht nichts ohne deine Bestätigung in KizamuBeam.

## Wie kann ich mithelfen?

Teste KizamuBeam mit deinem Laser, melde Fehler und Wünsche auf [GitHub](https://github.com/negurvulkan/kizamubeam/issues), stell Fragen und zeig deine Projekte auf [Discord](https://discord.gg/SSr8VHh7EJ), übersetze die Oberfläche oder [dieses Handbuch](../contributing.md), oder schick einen Pull Request.
