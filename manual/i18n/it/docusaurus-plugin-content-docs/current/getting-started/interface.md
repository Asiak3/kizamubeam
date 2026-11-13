---
sidebar_position: 2
title: L’interfaccia
description: Un giro nella finestra principale di KizamuBeam, con barre degli strumenti, finestre e menu.
---

# L’interfaccia

![Finestra principale di KizamuBeam](/img/design-en.png)

## La finestra principale in breve

| Area | Cosa trovi |
|---|---|
| **Barra dei menu** (in alto) | File, Modifica, Strumenti, Disponi, Pagine, Laser, Visualizza, Finestra e Aiuto. |
| **Barra degli strumenti principale** (sotto il menu) | Nuovo, apri, salva, importa ed esporta, annulla, appunti, zoom, vista 3D, fotocamera, impostazioni del dispositivo, controllo del progetto, anteprima, raggruppa, specchia e allinea. |
| **Barra delle modifiche numeriche** | Posizione, dimensioni e rotazione della selezione. I campi accettano formule con unità, come `100/3` o `2in`. Con un testo selezionato compare la barra del testo con font, altezza e spaziatura. |
| **Barra Strumenti** (a sinistra) | Selezione e modifica dei nodi, linee, curve, rettangoli, ellissi, poligoni e testo, codici QR, la **Casella degli strumenti** con tutti i generatori, operazioni booleane, offset, array, nesting e misura. |
| **Schede dei progetti** (sopra l’area di lavoro) | Più progetti aperti insieme, ognuno con pagine, selezione e cronologia di annullamento propri. |
| **Area di lavoro** (al centro) | Il piano del laser del dispositivo selezionato. Trascina le guide dai righelli. |
| **Finestre** (a destra) | Tagli / Livello, Oggetti e Cronologia; in basso a destra Laser, Sposta e Console. |
| **Tavolozza** (in basso) | Un colore per livello. Fai clic su un colore per spostare la selezione su quel livello. |
| **Barra di stato** (in basso) | Posizione del puntatore, aggancio (“Aggancia”) e griglia (“Griglia”). |

Le finestre si possono spostare, agganciare, raggruppare in schede e nascondere. Il menu **Finestra** le mostra e le nasconde, e le barre degli strumenti si possono personalizzare.

## Il colore è il livello

Ogni oggetto appartiene a un livello, e ogni livello ha un colore. Il livello decide **come** viene lavorato l’oggetto: modalità (linea o riempimento), velocità, potenza, passate e altro. Gli oggetti non hanno mai impostazioni laser proprie; per lavorare qualcosa in modo diverso, spostalo su un altro livello.

Un doppio clic su un livello nella finestra Tagli / Livello apre le sue impostazioni di taglio.

## Selezionare e spostare

- Un clic seleziona un oggetto, Maiusc+clic lo aggiunge alla selezione.
- Un riquadro tracciato verso **destra** seleziona gli oggetti completamente al suo interno, uno verso **sinistra** anche quelli che tocca soltanto.
- Un secondo clic su un oggetto selezionato passa da ridimensionamento a rotazione.
- I tasti freccia spostano la selezione di 1 mm (Maiusc 10 mm, Alt 0,1 mm).
- Barra spaziatrice + trascinamento, il tasto centrale del mouse o la rotellina spostano e ingrandiscono la vista.

Tutte le scorciatoie sono in [Scorciatoie da tastiera](../reference/keyboard-shortcuts.md) e nell’app con **F1**.

## Lingua e tema

- **Visualizza → Lingua**: italiano, inglese, tedesco e altre. Di default segue la lingua del sistema.
- **Visualizza → Tema**, o il pulsante all’estrema destra della barra principale: chiaro o scuro. Di default segue il sistema.

## Impostazioni

**Modifica → Impostazioni …** raccoglie tutte le preferenze dell’applicazione in un’unica finestra con un campo di ricerca: generale, aspetto, area di lavoro e aggancio, mouse e tastiera, macchine e servizi, estensioni e font.
