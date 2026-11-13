---
sidebar_position: 5
title: Livelli e impostazioni di taglio
description: Come funzionano i livelli, le modalità Linea e Riempimento e tutte le impostazioni di taglio, dalle passate alle linguette, alle entrate e ai sotto-livelli.
---

# Livelli e impostazioni di taglio

## Il colore è il livello

Ogni oggetto appartiene a un livello, e ogni livello ha un colore della tavolozza in basso (00–29, più i livelli strumento T1 e T2). Fai clic su un colore della tavolozza per spostare la selezione su quel livello.

Il livello contiene **tutte le impostazioni laser**. Gli oggetti, immagini comprese, non hanno mai una velocità o una potenza proprie: per lavorare qualcosa in modo diverso, mettilo su un altro livello. Così un livello è una fase del lavoro, e le stesse impostazioni valgono per tutto ciò che contiene.

La finestra **Tagli / Livello** elenca i livelli in uso con modalità, velocità, potenza, air assist e uscita. I valori si modificano direttamente nella tabella; trascina le righe per cambiare l’ordine in cui vengono lavorati i livelli.

## Modalità

| Modalità | Cosa succede |
|---|---|
| **Linea** | Il laser segue i contorni: taglio e marcatura. |
| **Riempimento** | Le forme chiuse vengono incise riga per riga (o ad anelli con il riempimento a offset). Le linee aperte vengono saltate. |

Le immagini possono stare su qualsiasi livello. La tabella mostra allora “+ Immagine”, e la finestra del livello riceve una sezione **Immagine** con intervallo tra le linee e impostazioni immagine. Ogni immagine mantiene la propria modalità immagine (vedi [Immagini e ricalco](images.md)); velocità e potenza vengono dal livello.

## Livelli strumento T1 e T2

T1 e T2 non vengono mai lavorati. Usali per linee di costruzione, il contorno di un pezzo, immagini della fotocamera da ricalcare o il percorso di un testo su percorso che non vuoi tagliare.

## Uscita e visibilità

- L’**uscita** decide se un livello viene lavorato. Livelli e oggetti nascosti vengono comunque lavorati se la loro uscita è attiva; KizamuBeam te lo segnala prima del lavoro.
- Nella [finestra Oggetti](objects-pages.md) i singoli oggetti si possono impostare su **Non incidere**: restano visibili (sbiaditi) ma non vengono lavorati, non finiscono nel G-code e non vengono controllati.

## Impostazioni di taglio

Un doppio clic su un livello apre le sue **Impostazioni di taglio**. I campi visibili dipendono dalla modalità.

### Comuni a tutte le modalità

| Impostazione | Significato |
|---|---|
| **Velocità (mm/min)** | Avanzamento con il laser acceso. |
| **Potenza max (%)** / **Potenza min (%)** | La potenza del livello. La potenza min si usa dove la potenza viene abbassata: nelle rampe di potenza e per i toni più chiari delle immagini in scala di grigi. |
| **Passaggi** | Quante volte il livello viene ripetuto. |
| **Air Assist** | Attiva l’aria compressa (M8 o M7) per questo livello. |
| **Offset Z (mm)** e **Più in profondità per passaggio (mm)** | Solo con asse Z motorizzato: sposta il fuoco rispetto all’altezza iniziale e scendi a ogni passaggio. |
| **Materiale** | Collega il livello a una voce della libreria dei materiali; usato anche dalla vista 3D e dalla calibrazione dell’accoppiamento. |

### Linea

| Impostazione | Significato |
|---|---|
| **Offset kerf (mm)** | Sposta il taglio verso l’esterno sui contorni esterni e verso l’interno sui fori, così i pezzi mantengono la misura nominale. Di solito metà della larghezza di taglio. |
| **Linguette** | Lascia piccoli ponti non tagliati perché i pezzi non cadano: numero per forma o distanza, larghezza della linguetta, eventualmente senza forme interne. |
| **Perforazione** | Taglia una lunghezza data, poi lascia uno spazio, per bordi a strappo o linee di piega. |
| **Entrata / Uscita** | Una linea inclinata o un arco verso il contorno e fuori da esso, sempre sul lato di scarto, così il punto iniziale non lascia segni sul pezzo. |
| **Sovrataglio (mm)** | Prosegue oltre il punto iniziale per essere sicuri che il contorno sia chiuso. |
| **Rampa di potenza** | Abbassa la potenza verso gli angoli (da un cambio di direzione impostabile) per evitare bruciature, eventualmente anche all’inizio e alla fine di ogni taglio. |
| **Linee duplicate** | Rimuove le linee sovrapposte prima del taglio, così nulla viene tagliato due volte. |

### Riempimento

| Impostazione | Significato |
|---|---|
| **Intervallo tra le linee (mm)** o **Linee per pollice** | Distanza tra le linee di riempimento. |
| **Angolo di scansione (°)** | Direzione delle linee: 0° orizzontale, 90° verticale. |
| **Tratteggio incrociato** | Un secondo passaggio ruotato di 90°. |
| **Bidirezionale** | Lavora in entrambe le direzioni (più veloce). |
| **Overscan (%)** | Supera i bordi con il laser spento, così la testa è a piena velocità quando si accende. Evita bordi più scuri. |
| **Stile riempimento** | **Riga per riga** o **Riempimento a offset**: anelli che seguono il contorno verso l’interno. |

**Valori predefiniti** riporta i campi ai valori predefiniti della modalità scelta.

## Sotto-livelli

**+ sotto-livello** aggiunge altre lavorazioni sulle stesse forme, ognuna con modalità, velocità, potenza, passaggi e impostazioni proprie. Un uso classico è “riempi, poi taglia il contorno” su un solo livello. I sotto-livelli vengono eseguiti dopo il livello stesso e si possono disattivare uno per uno.

## Aspetto in 3D

**Aspetto in 3D** stabilisce come appaiono i pezzi del livello nella [vista 3D](construction-3d.md): 21 materiali dal compensato all’ardesia, all’acrilico e all’alluminio anodizzato, ognuno con un colore proprio facoltativo.

## Libreria dei materiali

La finestra **Materiale** conserva impostazioni collaudate per materiale e spessore e le applica a un livello con un clic. Vedi [Materiali e test](materials-tests.md).
