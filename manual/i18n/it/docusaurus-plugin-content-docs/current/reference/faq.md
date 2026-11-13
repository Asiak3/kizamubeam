---
sidebar_position: 5
title: Domande frequenti
description: Risposte alle domande più comuni su KizamuBeam.
---

# Domande frequenti

## KizamuBeam è davvero gratuito?

Sì. KizamuBeam è distribuito con licenza GPL-3.0-or-later: nessun costo di licenza, nessun abbonamento, nessun account, uso commerciale incluso.

## Funziona con il mio laser?

Se usa FluidNC, GRBL, grblHAL, Marlin o Smoothieware, molto probabilmente sì; questo copre la maggior parte dei laser a diodo. I laser galvo e i controller Ruida/DSP non sono supportati. Vedi [Compatibilità delle macchine](machine-compatibility.md).

## Perché il computer mostra un avviso durante l’installazione?

I programmi di installazione non sono ancora firmati digitalmente, cosa comune per i giovani progetti open source. Vedi [Installazione](../getting-started/installation.md).

## Posso portare con me le mie impostazioni dei materiali e i miei progetti?

Sì. Le librerie materiali di LightBurn (`.clb`) si possono importare dove i campi hanno un equivalente, e i progetti LightBurn (`.lbrn2`) si aprono con forme, immagini e impostazioni dei livelli. I file SVG, DXF, PDF e Illustrator (`.ai`) si importano come al solito. Vedi [Formati di file](file-formats.md).

## KizamuBeam è abbastanza stabile per progetti reali?

Sì. Dalla versione 2.2.0 esistono versioni stabili, e KizamuBeam viene usato ogni giorno su hardware reale. Come con qualsiasi software laser: controlla i nuovi lavori con anteprima e frame, e fai un backup dei progetti importanti.

## A cosa serve il server MCP?

Permette agli agenti IA di leggere e modificare i tuoi progetti. È disattivato di default, solo locale e protetto da token, e nulla arriva alla tua macchina senza la tua conferma in KizamuBeam.

## Come posso aiutare?

Prova KizamuBeam sul tuo laser, segnala bug e idee su [GitHub](https://github.com/negurvulkan/kizamubeam/issues), fai domande e condividi i tuoi progetti su [Discord](https://discord.gg/SSr8VHh7EJ), traduci l’interfaccia o [questo manuale](../contributing.md), oppure invia una pull request.
