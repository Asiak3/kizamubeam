---
sidebar_position: 3
title: Scatole con giunzioni a dita
description: Scatole aperte o chiuse con giunzioni a dita, per misure interne o esterne, con kerf e gioco di accoppiamento, e scatole con divisori.
---

# Scatole con giunzioni a dita

Entrambi i generatori di scatole si trovano in **Casella degli strumenti → Scatole e mobili**. Per un coperchio che si apre su un perno, aggiungi poi una [cerniera del coperchio](../features/construction-3d.md#lid-hinge).

## Scatola con giunzioni a dita

| Campo | Significato |
|---|---|
| **Dimensioni** | **Dimensioni esterne** o **Dimensioni interne**: se larghezza, profondità e altezza si misurano all’esterno o all’interno delle pareti. |
| **Larghezza**, **Profondità**, **Altezza** | Dimensioni della scatola in mm. |
| **Spessore del materiale** | Spessore del pannello. Misuralo: i pannelli sono raramente spessi quanto dichiarato. |
| **Su** | **Aperta** o **Chiusa (coperchio con dita)**. |
| **Larghezza delle dita** | Larghezza minima delle dita. Ogni bordo riceve un numero dispari di dita della stessa larghezza. |
| **Gioco di accoppiamento** | Ogni dito diventa più stretto di questo valore; negativo = accoppiamento a pressione. |
| **Kerf** | Larghezza del taglio laser; i contorni vengono spostati verso l’esterno della metà. |

Le pareti anteriore e posteriore possiedono gli angoli. Le parti sono oggetti separati in una disposizione compatta: le parti uguali restano vicine. Un doppio clic su una parte qualsiasi modifica l’intera scatola, su tutti i lati. Le parti ancora nella disposizione generata si allontanano quando la scatola cresce; quelle che hai disposto tu restano dove sono.

### Incisione su una parete

Metti testo o immagini su una parete e raggruppali con essa, oppure appoggiali semplicemente sopra: nella vista 3D le incisioni compaiono sulla parete su cui si trovano. Il modello **Scatola con etichetta** (**File → Nuovo dal modello …**) è un esempio pronto con una scritta sul davanti.

### Ottenere un buon accoppiamento

1. Misura lo spessore del materiale con un calibro in più punti e inserisci la media.
2. Parti con gioco 0 e il kerf del tuo laser (da 0,1 a 0,2 mm per un laser a diodo su compensato).
3. Taglia la scatola. Se è troppo stretta, aumenta il gioco a passi di 0,05 mm; se è lenta, riducilo.

La [calibrazione dell’accoppiamento](../features/materials-tests.md#calibrate-fit) trova questi valori per un materiale con un solo test, e le nuove scatole li adottano poi automaticamente.

## Scatola con giunti a pettine e divisori

Una scatola aperta o chiusa con divisori che si incrociano. Questo generatore è **sperimentale**: controlla le parti nella vista 3D e su un ritaglio prima di tagliare il materiale buono.

| Campo | Significato |
|---|---|
| **Larghezza**, **Profondità**, **Altezza**, **Spessore del materiale**, **Su** | Come per la scatola. |
| **Scomparti in larghezza** / **Scomparti in profondità** | Numero di scomparti in ogni direzione. |
| **Distribuzione in larghezza** / **Distribuzione in profondità** | Misure interne degli scomparti come rapporti o in mm, separate da due punti. `1:2:1` rende lo scomparto centrale largo il doppio; `36mm:1` rende il primo largo 36 mm e il secondo prende il resto. Funzionano anche `+ - * /` e le parentesi. Vuoto = scomparti uguali. |
| **Divisori più bassi della scatola** | Di quanto i divisori sono più bassi delle pareti. |
| **Kerf** | Larghezza del taglio laser. |

**Larghezza delle dita** e **Gioco di accoppiamento** si trovano in **Avanzate**. Le parti e i loro fori stanno su un livello comune.
