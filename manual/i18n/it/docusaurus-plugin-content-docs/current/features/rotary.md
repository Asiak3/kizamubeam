---
sidebar_position: 13
title: Asse rotante
description: Incidi tazze, bicchieri e altri oggetti rotondi con un asse rotante a rulli o a mandrino, anche oggetti conici.
---

# Asse rotante

Un asse rotante fa girare un oggetto rotondo sotto il laser, così puoi incidere tazze, bicchieri, bottiglie o mattarelli. KizamuBeam converte la direzione Y del progetto in rotazione dell’oggetto.

## Configurazione

Apri **Laser → Dispositivo → Configurazione asse rotante …** (o **Asse rotante …** nella finestra Laser). Le impostazioni vengono salvate per dispositivo:

| Impostazione | Significato |
|---|---|
| **Abilita asse rotante** | Attiva la modalità rotante per questo dispositivo. |
| **Rulli / Mandrino** | Rulli: l’oggetto appoggia su rulli motorizzati. Mandrino: l’oggetto viene serrato e fatto girare direttamente. |
| **Asse** | Y (asse rotante collegato al posto del motore Y) o un asse separato A, B, C o Z. |
| **Corsa per rotazione** | Di quanto si muove l’asse (in mm o gradi, di solito 360°) per un giro completo del rullo o del mandrino. |
| **Diametro del rullo** | Diametro del rullo motorizzato (solo con rulli). |
| **Diametro dell’oggetto** | Misurato nel punto più largo dell’incisione. In alternativa puoi inserire la circonferenza, per esempio misurata con un metro a nastro. |
| **Inverti direzione** | Inverte la rotazione se l’incisione esce specchiata. |

**Rotazione di prova** fa girare l’oggetto esattamente una volta con i valori inseriti. Se gira troppo o troppo poco, correggi la corsa per rotazione nella stessa proporzione.

## Come funziona

Con l’asse rotante attivo:

- la direzione Y del progetto diventa rotazione, e la velocità viene adattata in modo che sia corretta sulla superficie,
- questo vale per lavori, immagini, frame, Sposta e Inizia qui,
- solo X viene controllato rispetto al piano, e KizamuBeam avvisa quando il progetto è più alto della circonferenza dell’oggetto,
- con un asse separato, l’asse viene azzerato all’inizio (`G92 A0`, o B, C, Z), e il frame torna all’inizio alla fine,
- con l’asse rotante sulla porta Y, KizamuBeam chiede prima dell’azzeramento (l’azzeramento farebbe girare l’asse rotante).

## Oggetti conici

Le tazze e molti bicchieri sono più sottili in basso che in alto. Inserisci il diametro dell’oggetto al bordo sinistro e destro del lavoro. La rotazione segue allora il diametro in ogni posizione X, così l’incisione mantiene la sua vera dimensione e il centro del lavoro resta dritto. Con i rulli, KizamuBeam presume che l’oggetto appoggi sull’estremità più spessa.

## Suggerimenti

- Disponi il progetto in modo che la sua altezza (Y) non superi la circonferenza dell’oggetto (diametro × π).
- Metti a fuoco sul punto più alto dell’oggetto, direttamente sotto la testa.
- Esegui prima un frame: la testa si muove lungo X e l’oggetto gira.
- Annota il diametro dell’oggetto nelle [note del progetto](materials-tests.md#project-notes), così la volta successiva sei veloce.
