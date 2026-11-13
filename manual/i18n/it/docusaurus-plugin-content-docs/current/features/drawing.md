---
sidebar_position: 1
title: Disegnare e modificare
description: Disegna linee, curve, forme e tratti a mano libera, seleziona e trasforma gli oggetti e modifica i nodi.
---

# Disegnare e modificare

Tutto ciò che disegni in KizamuBeam è una forma vettoriale modificabile. Questa pagina descrive gli strumenti di disegno, la selezione e la trasformazione e la modifica dei nodi. Come combinare e rimodellare i percorsi è spiegato in [Percorsi e forme](paths.md), il posizionamento preciso in [Aggancio, guide e misure](precision.md).

## Strumenti di disegno

Gli strumenti di disegno si trovano nella barra Strumenti a sinistra e nel menu **Strumenti**.

| Strumento | Scorciatoia | Come si usa |
|---|---|---|
| **Disegna linee** | Ctrl+L | Fai clic per gli angoli; fai clic e trascina per una curva di Bézier. Un clic sul punto iniziale chiude la forma; doppio clic, Invio o clic destro termina. |
| **Mano libera / Matita** | | Trascina un tratto; al rilascio viene convertito in curve morbide e modificabili. Nelle opzioni dello strumento imposti la tolleranza e se il tratto va chiuso. |
| **Rettangolo** | Ctrl+R | Trascina un rettangolo. Maiusc disegna un quadrato, Ctrl parte dal centro. Il raggio degli angoli si imposta nella barra delle modifiche numeriche. |
| **Ellisse** | Ctrl+E | Trascina un’ellisse. Maiusc disegna un cerchio, Ctrl parte dal centro. |
| **Poligono** | | Trascina dal centro. Numero di angoli e **Stella** nella barra delle modifiche numeriche. |
| **Testo** | Ctrl+T | Vedi [Testo e codici](text.md). |

Rettangoli, ellissi, poligoni e testi restano modificabili come tali: raggio degli angoli, numero di angoli o testo si possono cambiare in seguito. **Converti in percorso** (Ctrl+Maiusc+C) li trasforma in percorsi normali.

## Selezionare

- Un **clic** seleziona un oggetto, **Maiusc+clic** ne aggiunge o ne toglie uno.
- Un **riquadro verso destra** seleziona gli oggetti completamente al suo interno, un **riquadro verso sinistra** anche quelli che attraversa soltanto.
- **Selezione a lazo** (**Strumenti → Percorso**): disegna intorno agli oggetti per selezionare quelli racchiusi completamente. Maiusc aggiunge, Ctrl inverte.
- **Ctrl+A** seleziona tutto nella pagina corrente; **Esc** annulla la selezione.
- Un clic destro apre un menu contestuale con i comandi adatti a ciò che si trova sotto il puntatore: forme, immagini, nodi o area di lavoro vuota.

Quando molti oggetti sono sovrapposti, aiuta **Strumenti → Isola selezione**: solo gli oggetti selezionati si possono cliccare e agganciare, tutto il resto resta visibile ma irraggiungibile. Un’etichetta in alto indica che l’isolamento è attivo. L’isolamento non influisce sul lavoro; tutto viene comunque lavorato. Si esce con **Esci dall’isolamento** o Esc.

## Spostare, ridimensionare e ruotare

- Trascina una selezione per spostarla. I tasti freccia la spostano di 1 mm (Maiusc 10 mm, Alt 0,1 mm).
- Trascina una maniglia per ridimensionare. Maiusc passa tra ridimensionamento proporzionale e libero, Ctrl ridimensiona dal centro.
- **Fai clic una seconda volta sulla selezione** (o trascina appena fuori da un angolo) per ruotare. Il centro di rotazione si può spostare. Maiusc aggancia a 15°, Ctrl a 5°, Esc annulla.
- `.` e `,` ruotano di 90°. **Ctrl+Maiusc+H** e **Ctrl+Maiusc+V** specchiano.

### Valori esatti

La **barra delle modifiche numeriche** in alto mostra posizione, dimensioni e rotazione della selezione. Un riferimento a 9 punti stabilisce a quale punto si riferiscono i valori. I campi accettano formule e unità, come `100/3`, `2in` o `25.4*3`, e parametri del progetto come `{Larghezza}/2` (vedi [Modelli e libreria](templates-library.md)).

## Raggruppare, allineare e disporre

- **Ctrl+G** raggruppa, **Ctrl+U** separa il gruppo.
- Con più oggetti selezionati, **L R T B** allineano a sinistra, destra, in alto e in basso, **C** ed **E** allineano i centri. Il gruppo di pulsanti di allineamento nella barra principale distribuisce anche gli oggetti in modo uniforme.
- **Disponi → Ordine di sovrapposizione** porta gli oggetti in primo piano o li manda sullo sfondo.
- Array, nesting e riempimenti con motivo sono descritti in [Disporre e ripetere](arranging.md).

## Modificare i nodi

Scegli **Modifica nodi** (Ctrl+`) per cambiare la forma dei percorsi. Con più percorsi o forme selezionati, i nodi di tutti si modificano insieme.

| Azione | Come |
|---|---|
| Selezionare nodi | Clic, Maiusc+clic, riquadro (o **lazo dei nodi**) o Ctrl+A |
| Spostare nodi | Trascinali o spostali con i tasti freccia |
| Eliminare un nodo | D o Canc |
| Inserire un nodo | I, o doppio clic su un segmento |
| Segmento come linea / curva | L / C |
| Nodo come angolo / morbido | E / S |
| Spezzare il percorso nel nodo | B |
| Accorciare il bordo fino alle intersezioni | T |

Eliminando un segmento, il percorso si divide in quel punto. Ogni operazione è un passo di annullamento.

## Annulla e cronologia

**Ctrl+Z** annulla, **Ctrl+Y** (o Ctrl+Maiusc+Z) ripete. La finestra **Cronologia** (accanto a Oggetti) elenca le ultime 200 modifiche per nome, come “Sposta” o “Offset”; un clic su una riga salta di più passi avanti o indietro in una volta.
