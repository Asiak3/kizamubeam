---
sidebar_position: 2
title: Formati di file
description: Quali file KizamuBeam apre, importa ed esporta.
---

# Formati di file

## Importazione

**File → Importa** (Ctrl+I), trascinando dal gestore file o incollando con Ctrl+V.

| Formato | Note |
|---|---|
| Immagini: PNG, JPG, BMP, GIF, WebP, TIFF | Dimensioni dalla risoluzione del file (254 DPI se non indicata). TIFF a più pagine: prima pagina. |
| SVG | Percorsi, forme di base, trasformazioni, immagini incorporate. I testi vengono ignorati; convertili in percorsi prima di salvare l’SVG. |
| DXF | Linee, polilinee con archi, cerchi, archi, ellissi, spline e blocchi. Unità dal file. |
| PDF | I percorsi restano curve, i colori vengono assegnati ai livelli, immagini incorporate e testo (come contorni). Ogni pagina finisce su una pagina di progetto propria. |
| Adobe Illustrator (`.ai`) | File da Illustrator 9 in poi (contengono una versione PDF); importati come PDF. |
| Progetti LightBurn (`.lbrn2`) | Forme, immagini, gruppi e impostazioni dei livelli. **File → Apri** crea un nuovo progetto, **Importa** inserisce in quello attuale. |
| Modelli 3D: STL, OBJ | Diventano un modello a strati o a costole fatto di parti piane. |

## Esportazione

**File → Esporta**, anche come pulsanti nella barra principale.

| Formato | Note |
|---|---|
| SVG | Pagina attuale, con immagini |
| DXF | Pagina attuale, un layer DXF per ogni livello di KizamuBeam, curve come spline esatte. Le immagini non possono entrare nel DXF. |
| PDF | Tutte le pagine in scala 1:1 del piano, un livello PDF per ogni livello di KizamuBeam, immagini incorporate |
| Adobe Illustrator (`.ai`) | Lo stesso file compatibile PDF; si apre in Illustrator, Inkscape e Affinity |
| G-code (`.gcode`, `.nc`) | **Laser → Salva GCode …** per il dispositivo selezionato |
| PNG | **Salva bitmap elaborato …**: un’immagine esattamente come verrebbe incisa |

I testi vengono esportati come contorni.

## File propri di KizamuBeam

| Estensione | Contenuto |
|---|---|
| `.kzb` | Progetto (i vecchi file `.lwk` si aprono ancora) |
| `.kzt` | Modello con parametri |
| `.kzm` | Libreria materiali (si possono importare anche i vecchi file `.lwm` e le librerie LightBurn `.clb`) |
| `.kza` | Elemento della libreria (motivo, immagine, elemento grafico) |
| `.kzp` | Pacchetto di estensione, vedi [Estensioni](../extensions/index.md) |
| `.kzb-camera` | Calibrazione della fotocamera |
