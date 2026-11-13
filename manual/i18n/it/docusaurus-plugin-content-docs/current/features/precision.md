---
sidebar_position: 3
title: Aggancio, guide e misure
description: Aggancia a nodi e griglia, usa le guide, misura, applica relazioni e disegna schizzi quotati.
---

# Aggancio, guide e misure

## Aggancio

**Aggancia** nella barra di stato attiva e disattiva l’aggancio. Oggetti e puntatore si agganciano a nodi, punti medi, centri, intersezioni, linee e punti dei quadranti dei cerchi. **Griglia** nella barra di stato aggancia alla griglia.

- **Ctrl** durante il trascinamento disattiva (o attiva) l’aggancio per il momento.
- **Alt** durante il trascinamento aggancia più forte e mostra guide di allineamento sugli altri oggetti.

Cerchi e archi vengono riconosciuti anche all’interno dei percorsi, per esempio i fori di una piastra o i cerchi DXF importati, così si aggancia il loro vero centro. **Visualizza → Mostra centri** mostra le croci dei centri sempre, solo per la selezione o mai.

## Griglia

**Visualizza → Griglia** mostra o nasconde la griglia. In **Impostazioni griglia …** imposti la spaziatura (per esempio 25,4 per i pollici), le suddivisioni, una linea ogni n in grassetto, colore e opacità, e puoi usare la spaziatura più fine come griglia di aggancio.

## Guide

Trascina una guida dal righello superiore (orizzontale) o da quello sinistro (verticale). Le guide stanno su un livello proprio, **Guide**: non vengono mai lavorate né esportate, e Ctrl+A, la tavolozza e le operazioni sulle forme le ignorano. Trascina una guida per spostarla, o riportala nel righello per eliminarla. Il livello Guide si può nascondere e bloccare nella finestra Oggetti. Le guide valgono per tutte le pagine.

## Misurare

**Strumenti → Misura** (o il pulsante del righello): fai clic su un punto iniziale e uno finale, con aggancio. KizamuBeam mostra lunghezza, Δx, Δy e angolo; sopra un cerchio, diametro e raggio. Esc cancella la misura.

## Relazioni

**Disponi → Relazioni** (o il gruppo di pulsanti delle relazioni nella barra Strumenti) sposta o ruota un oggetto in modo che sia in relazione con un altro. Fai clic prima sul riferimento (resta fermo), poi sull’elemento dell’oggetto che deve adattarsi.

| Relazione | Effetto |
|---|---|
| **Concentrico** | Due cerchi, ellissi o poligoni condividono il centro (anche fori all’interno di percorsi). |
| **Stessa dimensione** | Stesso raggio per due cerchi, stessa lunghezza per due lati. |
| **Parallelo** / **Perpendicolare** | Il secondo oggetto ruota dell’angolo minimo. |
| **Orizzontale** / **Verticale** | Raddrizza un lato in orizzontale o in verticale. |
| **Tangente** | Il secondo oggetto si sposta finché non tocca. |
| **Distanza** | Chiede una distanza tra lati, punti o cerchi. |

Le relazioni si applicano una volta, come un comando; ognuna è un passo di annullamento.

## Schizzi con quote {#sketches-with-dimensions}

Per pezzi che devono mantenere misure esatte mentre li modifichi, usa **Casella degli strumenti → Schizzi con relazioni → Nuovo schizzo** (o **Converti in schizzo**). In uno schizzo, linee, rettangoli, cerchi e archi mantengono relazioni e quote in modo permanente, come in un programma CAD.

- Relazioni dalla barra in alto o da tastiera: coincidente (O), orizzontale (H), verticale (V), parallelo (P), perpendicolare (N), uguale (E), tangente (T), concentrico (X), punto medio (M), simmetrico (Y), fisso (F).
- **Quota** (D): una linea riceve una lunghezza, due linee un angolo, un cerchio un diametro, un arco un raggio, due punti una distanza. Un doppio clic su una quota la modifica. Le quote possono essere formule con parametri del progetto, come `Larghezza / 2`.
- Colori: blu = ancora libero, scuro = completamente definito, rosso = conflitto.
- La geometria di costruzione (G) è tratteggiata e non viene mai lavorata.

Un doppio clic riapre uno schizzo, Invio o **Completato** lo chiude, **Annulla** scarta tutte le modifiche dall’apertura.
