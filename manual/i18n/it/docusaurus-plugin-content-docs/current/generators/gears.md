---
sidebar_position: 1
title: Ingranaggi e cremagliere
description: Ingranaggi cilindrici a evolvente, coppie di ingranaggi alla giusta distanza tra gli assi e cremagliere abbinate.
---

# Ingranaggi e cremagliere

I generatori di ingranaggi creano veri denti a evolvente, generati come li taglia un creatore, con raccordi del piede esatti e sottotaglio per pochi denti. I contorni sono curve di Bézier entro 0,004 mm dalla forma vera. Li trovi in **Casella degli strumenti → Meccanica**.

## Ingranaggio

| Campo | Significato |
|---|---|
| **Numero di denti** | Da 5 a 400. |
| **Modulo** | Diametro primitivo diviso per il numero di denti. Gli ingranaggi che ingranano devono avere lo stesso modulo. Il diametro primitivo è modulo × denti: 24 denti con modulo 2 danno 48 mm. |
| **Angolo di pressione** | 20° è il valore comune. Gli ingranaggi che ingranano devono avere lo stesso angolo. |
| **Gioco** | Gioco della coppia sul cerchio primitivo; i denti di ogni ingranaggio diventano più sottili della metà. |
| **Kerf** | Larghezza del taglio laser; il contorno viene spostato verso l’esterno della metà, l’alesaggio verso l’interno. |
| **Alesaggio** | Nessuno, **Arrotondato**, **Albero a D (piatto)** con la misura sul piatto, oppure **Con cava per linguetta** con larghezza e profondità della cava. |

In **Avanzate**:

- **Spostamento del profilo x**: i valori positivi rinforzano il piede dei denti ed evitano il sottotaglio sugli ingranaggi piccoli; la distanza tra gli assi cambia di x × modulo.
- **Raccordo del piede** e **Gioco inferiore** (× modulo): i valori standard sono 0,38 e 0,25.

Gioco e kerf sono separati di proposito: il gioco crea spazio tra i denti di due ingranaggi, il kerf compensa il materiale che il laser asporta.

## Coppia di ingranaggi

**Coppia di ingranaggi** crea due ingranaggi abbinati alla giusta distanza tra gli assi, come un unico assieme. Nella [vista 3D](../features/construction-3d.md#3d-view) ingranano e possono girare.

| Campo | Significato |
|---|---|
| **Denti ingranaggio 1** / **Denti ingranaggio 2** | Il rapporto è denti 2 ÷ denti 1. |
| **Modulo**, **Angolo di pressione**, **Gioco**, **Kerf** | Come per un singolo ingranaggio. |
| **Piastra di base con fori per assi** | Aggiunge una piastra con entrambi i fori degli assi alla giusta distanza, con **Diametro foro asse** e **Margine piastra di base** attorno ai cerchi di testa. |
| **Alesaggio** | Per ogni ingranaggio. |

**Spostamento profilo ingranaggio 1** (Avanzate) sposta l’ingranaggio piccolo; l’ingranaggio 2 riceve lo spostamento opposto, così la distanza tra gli assi resta uguale.

## Cremagliera

Una **Cremagliera** è un ingranaggio dritto che ingrana con un ingranaggio cilindrico: la rotazione diventa un moto lineare.

| Campo | Significato |
|---|---|
| **Numero di denti** | Lunghezza della cremagliera in denti (la lunghezza è denti × modulo × π). |
| **Modulo**, **Angolo di pressione** | Devono corrispondere all’ingranaggio. |
| **Gioco** | Diviso tra cremagliera e ingranaggio. |
| **Altezza di supporto** | Materiale sotto il piede dei denti. |
| **Kerf** | Come per l’ingranaggio. |

## Consigli

- Compensato e acrilico da 3 mm funzionano bene da modulo 1,5 in su. Moduli più piccoli richiedono un raggio sottile e preciso.
- Taglia una coppia di ingranaggi e provala su due perni prima di costruire un meccanismo più grande; regola il gioco se si inceppa.
- Fai passare un perno nell’alesaggio centrale invece di affidarti al solo foro nel compensato: il legno si consuma in fretta.
