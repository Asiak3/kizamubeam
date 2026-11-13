---
sidebar_position: 1
title: Una scatola con il coperchio inciso
description: Costruire una scatola chiusa con giunzioni a dita in compensato, con un nome inciso sul coperchio, che sta insieme senza colla.
---

# Una scatola con il coperchio inciso

In questo tutorial costruisci una scatola chiusa in compensato da 3 mm, di circa 100 × 80 × 50 mm, con un nome inciso sul coperchio. Le dita devono tenere insieme la scatola senza colla.

**Ti serve:** compensato da 3 mm (un ritaglio per il test e un pezzo di circa 300 × 200 mm per la scatola) e un calibro o un righello.

## 1. Calibrare l’accoppiamento (una volta per materiale)

Una scatola tiene solo se kerf e gioco sono adatti al tuo laser e al tuo materiale. Lo misuri una volta e KizamuBeam se lo ricorda.

1. Misura il compensato con il calibro in più punti e annota la media, per esempio 2,9 mm.
2. Scegli il materiale del livello di taglio nella finestra dei livelli, oppure aggiungilo nella [libreria dei materiali](../features/materials-tests.md#material-library).
3. Scegli **Laser → Test e calibrazione → Calibra accoppiamento …**. I pezzi di prova compaiono su una nuova pagina.
4. Taglia i pezzi di prova su un ritaglio con le tue impostazioni di taglio.
5. Misura il quadrato, trova la linguetta e l’asola che si accoppiano meglio e inserisci i valori. KizamuBeam salva kerf e gioco con il materiale.

I dettagli sono in [Calibrare l’accoppiamento](../features/materials-tests.md#calibrate-fit). Se salti questo passo, parti con un kerf di 0,15 mm e un gioco di accoppiamento di 0 e correggi dopo la prima scatola.

## 2. Creare la scatola

1. Apri la **Casella degli strumenti** e scegli **Scatole e mobili → Scatola con giunzioni a dita**.
2. Imposta **Dimensioni** su **Dimensioni esterne** e inserisci larghezza `100`, profondità `80` e altezza `50`.
3. Inserisci lo **Spessore del materiale** che hai misurato.
4. Imposta **Su** su **Chiusa (coperchio con dita)**.
5. Con un materiale calibrato, la finestra usa già il suo kerf e il suo gioco. Altrimenti inseriscili tu.
6. Fai clic su **Crea**.

Le sei pareti compaiono sulla pagina in una disposizione compatta. Sono un’unica parte parametrica: un doppio clic su una parete qualsiasi ne cambia la misura in seguito.

## 3. Incidere il nome sul coperchio

1. Trova il coperchio: è il pannello con la stessa larghezza e profondità del fondo.
2. Scegli lo strumento testo (Ctrl+T), fai clic sul coperchio e scrivi un nome. Scegli un carattere e un’altezza di circa 12 mm.
3. Metti il testo su un livello a parte: fai clic su un altro colore della tavolozza, poi imposta quel livello su **Riempimento** nella finestra dei livelli.
4. Seleziona il testo e il coperchio e centrali l’uno sull’altro con **C** ed **E**.
5. Raggruppa il testo con il coperchio (Ctrl+G), così si sposta insieme quando la scatola viene ridisposta.

## 4. Controllare la scatola in 3D

Apri **Finestra → Vista 3D**. La scatola appare montata, con il nome sul coperchio (spunta **Incisioni**). Trascina il cursore **Esplodi** per vedere come si incastrano le pareti. Le zone rosse indicano che due pezzi si compenetrano; in quel caso controlla spessore e gioco.

**Laser → Controlla progetto** confronta inoltre ogni giunzione con la calibrazione e trova contorni aperti o linee doppie.

## 5. Lavorare al laser

1. Imposta velocità e potenza su entrambi i livelli. Usa i valori del tuo [test del materiale](../features/materials-tests.md#material-test) o della libreria dei materiali.
2. Assicurati che il livello di incisione venga prima del livello di taglio nell’elenco dei livelli, così le pareti vengono incise prima di essere tagliate.
3. Controlla il lavoro nell’anteprima (Alt+P), posiziona il compensato, esegui il frame e avvia.

## 6. Montare

Unisci le pareti a mano: prima i fianchi sul fondo, poi il coperchio. Se l’accoppiamento è troppo stretto, batti le giunzioni con un pezzo di legno invece di forzarle. Per la prossima scatola:

- **Troppo stretta:** aumenta il gioco di accoppiamento di 0,05 mm.
- **Troppo lenta:** riducilo di 0,05 mm, oppure usa qualche goccia di colla vinilica.

## Per andare oltre

- Rendi apribile il coperchio con una [cerniera del coperchio](../features/construction-3d.md#lid-hinge).
- Aggiungi scomparti con la **Scatola con giunti a pettine e divisori** o un [inserto divisorio](../generators/drawers-shelves.md).
- Salva il progetto come modello con un parametro per il nome: vedi [Targhette con nome da un elenco](name-tags-from-a-list.md).
