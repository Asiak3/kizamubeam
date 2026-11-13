---
sidebar_position: 3
title: Funzioni e strumenti
description: Panoramica di ciò che KizamuBeam sa fare, dal disegno al controllo della macchina.
---

# Funzioni e strumenti

Questo capitolo avrà una pagina per ogni argomento. Finché non saranno scritte, ogni sezione qui sotto riassume l’argomento e rimanda alla parte corrispondente dell’[elenco completo delle funzioni](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md), che descrive ogni funzione con il percorso nei menu.

## Disegno e modifica

Linee e curve di Bézier, rettangoli con raggio degli angoli, ellissi, poligoni, stelle e testo con qualsiasi font. Combina le forme con operazioni booleane, applica offset, modifica i nodi (anche su più oggetti insieme), semplifica e leviga i percorsi, disponi il testo lungo un percorso e arrotonda gli angoli. Aggancio, guide, relazioni come concentrico o parallelo e schizzi quotati mantengono i progetti precisi.
→ [Disegno e modifica](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#disegno-e-modifica), [Testo, forme e percorsi](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#testo-forme-e-percorsi)

## Livelli e oggetti

Il colore di un oggetto è il suo livello, e il livello contiene tutte le impostazioni laser: modalità, velocità, potenza, passate, riempimento, compensazione del kerf, ponticelli e altro. La finestra Oggetti mostra tutti gli oggetti per livello, con visibilità, blocco e “non incidere”. I progetti possono avere più pagine.
→ [Livelli, materiali e test](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#livelli-materiali-e-test), [Progetti e pagine](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#progetti-e-pagine)

## Importazione ed esportazione

Apri file SVG, DXF, PDF e Illustrator, progetti LightBurn (`.lbrn2`) e tutti i formati immagine comuni. Le foto hanno dithering e altre modalità immagine, rimozione dello sfondo, ritaglio e maschere, e si possono ricalcare in vettori. Esporta in SVG, DXF, PDF, Illustrator e G-code. Vedi anche [Formati di file](../reference/file-formats.md).
→ [Importazione, immagini e ricalco](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#importazione-immagini-e-ricalco)

## Nesting

**Disponi → Nesting …** dispone le parti secondo i loro contorni reali per risparmiare materiale, sull’area di lavoro, su un formato di materiale o dentro un ritaglio. Le parti piccole possono finire nei fori di quelle grandi.
→ [Disegno e modifica](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#disegno-e-modifica)

## Vista 3D e costruzione

**Finestra → Vista 3D** mostra scatole, cassetti, scaffali e coppie di ingranaggi assemblati, con materiale e incisioni, e segnala le parti che si compenetrano. Giunzioni, fessure e cerniere flessibili si possono aggiungere a qualsiasi forma, e i modelli 3D (STL/OBJ) diventano modelli a strati, a costole o a dischi. Vedi anche [Generatori](../generators/index.md).
→ [Giunzioni, generatori e 3D](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#giunzioni-generatori-e-3d)

## Materiali e profili macchina

La libreria materiali conserva le impostazioni collaudate per materiale e spessore. Test del materiale, test di messa a fuoco e calibrazione degli incastri aiutano a trovarle. Ogni laser è un dispositivo con area di lavoro, connessione e impostazioni proprie, creato a partire da modelli per i laser più diffusi.
→ [Livelli, materiali e test](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#livelli-materiali-e-test), [Laser e macchina](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#laser-e-macchina)

## G-code e controllo della macchina

Connettiti via USB o Wi-Fi, esegui il frame, avvia, metti in pausa e regola potenza e velocità durante il lavoro, riparti da qualsiasi punto. Prima di ogni lavoro KizamuBeam controlla che entri nel piano. Assi rotanti, asse Z motorizzato e assistenza aria sono supportati. Vedi [Collegare un laser](../getting-started/connect-laser.md).
→ [Laser e macchina](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#laser-e-macchina)

## Macchina virtuale

La KizamuBeam Virtual Machine è un programma separato che si comporta come un laser FluidNC o GRBL. Mostra il lavoro in 3D, lo incide su materiale virtuale e ha una fotocamera virtuale, così puoi provare lavori, funzioni della fotocamera e Print and Cut senza hardware.
→ [Laser e macchina](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.it.md#laser-e-macchina)
