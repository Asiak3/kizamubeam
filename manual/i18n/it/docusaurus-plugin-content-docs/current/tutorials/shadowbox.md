---
sidebar_position: 4
title: Una shadowbox a strati
description: Costruire una shadowbox con un paesaggio da più strati tagliati con motivi dalla libreria, controllare la profondità in 3D e incollarla.
---

# Una shadowbox a strati

Una shadowbox è un’immagine fatta di più strati sovrapposti, ognuno con un’apertura, così la scena acquista profondità. In questo tutorial costruisci un piccolo paesaggio con cinque strati: pannello posteriore, cielo con la luna, montagne, alberi e una cornice frontale.

**Ti serve:** cinque pezzi di compensato da 3 mm o cartone spesso, di circa 150 × 150 mm ciascuno, e colla vinilica. Cartoncino colorato o strati dipinti fanno un effetto particolarmente bello.

## 1. Pianificare gli strati

Ogni strato ha la stessa cornice esterna, così la pila resta a filo. Dal fondo verso il davanti:

| Strato | Contenuto |
|---|---|
| 1 | Pannello posteriore, chiuso |
| 2 | Cielo: una cornice con una luna rotonda ritagliata |
| 3 | Montagne |
| 4 | Alberi |
| 5 | Cornice frontale |

## 2. Disegnare la cornice

1. Disegna un quadrato di 150 × 150 mm (strumento **Rettangolo**, Ctrl+R, poi inserisci la misura nella barra delle modifiche numeriche).
2. Disegna un secondo quadrato di 130 × 130 mm e centralo sul primo (**C** ed **E**).
3. Copia prima il quadrato esterno (Ctrl+C, Ctrl+V) e sposta la copia di lato: diventerà il pannello posteriore.
4. Seleziona i due quadrati della cornice e scegli **Differenza booleana** (**Strumenti → Operazioni booleane**). Ora hai una cornice.

## 3. Costruire gli strati

Copia la cornice per gli strati da 2 a 5 (Ctrl+C, Ctrl+V) e metti le copie una accanto all’altra.

1. **Cielo**: disegna un quadrato che riempie l’apertura e si sovrappone alla cornice, e sopra un cerchio per la luna. Sottrai il cerchio con **Differenza booleana**, poi **unisci** il risultato alla cornice con **Unisci**.
2. **Montagne**: disegna una catena montuosa attraverso l’apertura con lo strumento **Disegna linee** (Ctrl+L), chiudila lungo il bordo inferiore della cornice e uniscila alla cornice con **Unisci**.
3. **Alberi**: apri **Finestra → Libreria**, cerca “tree” (la ricerca conosce i nomi inglesi e tedeschi) e trascina alcuni alberi sull’area di lavoro. Mettili su una collina disegnata lungo il bordo inferiore e unisci tutto alla cornice con **Unisci**.
4. **Cornice frontale**: la cornice da sola, oppure con qualche ramo dalla libreria che pende nell’apertura.

Mantieni ogni strato come un unico contorno chiuso: controlla che le parti che devono restare unite tocchino davvero la cornice. Le isole staccate cadrebbero.

## 4. Sovrapporli

1. Seleziona tutti e cinque gli strati.
2. Scegli **Casella degli strumenti → Modelli 3D a incastro → Lavoro multistrato**.
3. Ordina gli strati dal basso verso l’alto: prima il pannello posteriore, per ultima la cornice frontale. Dai a ognuno un nome e uno spessore di 3 mm.
4. Fai clic su **Crea**.

Apri **Finestra → Vista 3D**. Gli strati sono impilati a filo, e puoi ruotare la vista per giudicare la profondità. Se uno strato copre troppo quello dietro, modifica le forme e guarda di nuovo. Per cambiare in seguito ordine o spessore, seleziona gli strati e avvia di nuovo **Lavoro multistrato**. Altro in [Lavoro multistrato](../generators/multilayer.md).

## 5. Tagliare e incollare

1. Metti tutti i contorni su un livello di taglio ed esegui **Laser → Controlla progetto**: trova contorni aperti e parti troppo piccole.
2. Taglia gli strati. I dettagli fini come i rami richiedono una velocità più bassa o un passaggio in più per tagliare in modo pulito.
3. Se vuoi, dipingi o colora gli strati prima di incollarli.
4. Incolla la pila dal fondo verso il davanti, premendo le cornici esterne a filo. Tienila con morsetti o un peso mentre la colla asciuga.

## Idee

- Una striscia LED tra il pannello posteriore e il cielo la trasforma in una luce notturna.
- Incidi delle stelle sul pannello posteriore con un livello di riempimento prima di tagliare.
- Per un rilievo da un modello 3D invece che da un tuo disegno, usa il [modello a strati](../generators/models-3d.md).
