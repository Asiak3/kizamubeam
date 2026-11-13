---
sidebar_position: 2
title: Percorsi e forme
description: Combina le forme con operazioni booleane, applica offset e deformazioni, arrotonda angoli, unisci, ritaglia e semplifica percorsi.
---

# Percorsi e forme

Gli strumenti per le forme di KizamuBeam restituiscono sempre curve di Bézier pulite: angoli e tratti rettilinei restano tali, le parti arrotondate vengono approssimate con al massimo 0,02 mm di scostamento. I risultati restano modificabili come tutto ciò che disegni.

## Operazioni booleane

Seleziona due o più forme e scegli una delle operazioni in **Strumenti → Operazioni booleane** o nel gruppo di pulsanti della barra principale:

| Operazione | Scorciatoia | Risultato |
|---|---|---|
| **Unisci** | Alt++ | Fonde le forme in un unico contorno. Su un singolo gruppo o testo fonde le sue parti sovrapposte. |
| **Differenza booleana** | Alt+- | Ritaglia una forma dalle altre. |
| **Intersezione booleana** | Alt+* | Mantiene solo l’area in cui le forme si sovrappongono. |

Le **Opzioni booleane** (nel gruppo di pulsanti o in **Strumenti → Operazioni booleane**) stabiliscono quale forma fa da base (la prima selezionata, quella più in fondo o quella più in primo piano) e se gli originali vengono mantenuti. Lo stesso menu contiene anche **Sottrai il primo piano dallo sfondo** e **Sottrai lo sfondo dal primo piano**.

Da sapere:

- Le forme in un gruppo contano come un’unica area, quindi le sovrapposizioni all’interno di un gruppo non diventano fori.
- Testi e gruppi vengono trattati automaticamente come contorni.
- Le linee aperte, come i tagli di una cerniera vivente, vengono accorciate esattamente sulle forme sottratte.
- Le immagini vengono ignorate.

## Offset

**Scosta forme** (Alt+O) disegna un nuovo contorno a una distanza data, verso l’esterno, verso l’interno o in entrambe le direzioni, con angoli arrotondati, vivi o smussati e anteprima dal vivo. Le linee aperte ricevono un contorno chiuso intorno. Usi tipici: un bordo intorno a un testo, una piastra di base o una tasca per un intarsio.

## Deformare

**Strumenti → Deforma …** piega la selezione sul suo riquadro: arco, arco superiore, arco inferiore, rigonfiamento, bandiera o prospettiva con punto di fuga, da −100 a 100 %, eventualmente ruotata di 90°. Forme, testi e immagini vengono deformati insieme. Forme e testi diventano percorsi di Bézier, le immagini vengono ricalcolate alla loro risoluzione originale.

## Strumenti per i percorsi

In **Strumenti → Percorso**:

- **Chiudi percorso** chiude i percorsi aperti le cui estremità distano al massimo 0,5 mm. **Chiudi percorsi con tolleranza …** arriva fino a 20 mm e mostra quante forme verranno chiuse.
- **Unisci automaticamente le forme selezionate** (Alt+J) unisce in un unico percorso i percorsi aperti le cui estremità si incontrano (entro 0,05 mm).
- **Separa** (Alt+B) divide percorsi, forme e testi nelle singole linee e curve.
- **Ritaglia forme** (Ctrl+K): passando sopra una curva, il tratto fino alle intersezioni successive diventa rosso e viene rimosso con un clic. I pezzi rimanenti vengono uniti nelle intersezioni, così due cerchi sovrapposti diventano un unico contorno con due clic. Ctrl+clic non unisce, Maiusc+clic conserva il pezzo rimosso.
- **Imposta punto iniziale**: fai clic su un nodo perché il taglio inizi lì, o su un bordo per inserire un nuovo nodo iniziale. Maiusc+clic inverte la direzione. Finché lo strumento è attivo, l’area di lavoro mostra tutti i punti iniziali, le direzioni, le entrate e le uscite esattamente come li taglierà il lavoro.
- **Inverti direzione** inverte la direzione di taglio.
- **Marca centri** aggiunge una piccola croce al centro di ogni cerchio e arco, per bulinare o forare.

## Altri strumenti per i percorsi

- **Strumenti → Estrai contorno esterno e isole …** ricava la silhouette esterna degli oggetti selezionati, eventualmente con aree interne scelte, per esempio come piastra di base.
- **Strumenti → Percorso → Separa isole di tracciato…** divide un percorso composto da più pezzi separati in oggetti indipendenti; ogni pezzo conserva i propri fori.
- **Strumenti → Percorso → Modifica percorso a mano libera …** prolunga un percorso aperto da una delle sue estremità o ridisegna a mano un tratto tra due nodi.
- **Strumenti → Offset locale del contorno…** sposta verso l’esterno o l’interno solo una parte di un contorno.

## Arrotondare e smussare gli angoli

**Strumenti → Percorso → Arrotonda o smussa angoli …** arrotonda gli angoli di qualsiasi forma vettoriale con un raggio esatto, li arrotonda verso l’interno o li smussa. Nell’editor dei nodi agisce sui nodi selezionati, altrimenti su tutti gli angoli delle forme selezionate. Se un lato è troppo corto, il raggio viene ridotto.

## Semplificare i percorsi {#simplifying-paths}

**Strumenti → Semplifica / smussa percorsi…** ricostruisce i percorsi selezionati con meno nodi, come curve o come linee rette, entro una tolleranza in mm. Gli angoli vivi possono essere mantenuti. Un’anteprima arancione mostra il risultato prima di applicarlo. Utile per immagini ricalcate e file importati con molti nodi.
