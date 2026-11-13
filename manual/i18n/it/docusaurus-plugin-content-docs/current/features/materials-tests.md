---
sidebar_position: 11
title: Materiali e test
description: Conserva le impostazioni collaudate nella libreria dei materiali e trovale con test del materiale, test del fuoco e calibrazione dell’accoppiamento.
---

# Materiali e test

Un buon risultato dipende dalla velocità, dalla potenza e dal fuoco giusti per ogni materiale. KizamuBeam ti aiuta a trovare questi valori con motivi di prova e li conserva in una libreria dei materiali, così devi trovarli una volta sola.

## Libreria dei materiali {#material-library}

La finestra **Materiale** conserva le impostazioni di taglio per materiale e spessore, a scelta anche con le impostazioni immagine. Per usare una voce, seleziona un livello e applicala: il livello riprende tutte le sue impostazioni.

- **Salvare**: imposta un livello come ti piace e salvalo come nuova voce (materiale, spessore, titolo).
- **Scambiare**: esporta e importa le voci come file `.kzm`. I vecchi file `.lwm` si importano ancora, e le librerie LightBurn (`.clb`) vengono importate per quanto i loro campi hanno un equivalente.
- Anche le **estensioni** possono aggiungere voci di materiale (vedi [Modelli, libreria ed estensioni](templates-library.md#extensions)).

Le voci di materiale contengono anche l’[aspetto 3D](construction-3d.md#material-look) e i risultati di una [calibrazione dell’accoppiamento](#calibrate-fit).

## Test del materiale {#material-test}

**Laser → Test e calibrazione → Test del materiale …** (o **Casella degli strumenti → Laser e calibrazione**) crea una griglia di celle di prova con due valori a gradini, per esempio la velocità nelle righe e la potenza nelle colonne, con etichette. Ogni cella riceve un proprio livello di prova.

Il test non modifica il tuo documento: invialo direttamente al laser dalla finestra con Anteprima, Frame, Avvia o Salva GCode. Le celle vengono eseguite in ordine di energia crescente, così un test interrotto in anticipo ha già fatto le celle più leggere.

Usi tipici:

- **Incisione**: trovare velocità e potenza che danno la tonalità desiderata senza bruciare.
- **Taglio**: trovare la velocità massima che taglia ancora da parte a parte (imposta i passaggi nella finestra).
- **Marcatura**: trovare una linea visibile ma poco profonda.

## Valutare un test del materiale da una foto

**Laser → Test e calibrazione → Valuta test del materiale …** (o **Valuta foto …** nella finestra del test) ti aiuta a leggere il risultato:

1. Scatta una foto con la fotocamera collegata, o apri una foto (per esempio dal telefono).
2. Fai clic sui quattro angoli della griglia. Con fotocamera calibrata e avvio assoluto, la griglia viene posizionata automaticamente.
3. Fai clic sulla cella migliore nella foto e applica i suoi valori al livello attivo o salvali nella libreria dei materiali.

KizamuBeam misura quanto è scura ogni cella rispetto al materiale nudo negli spazi tra le celle e, per le incisioni, propone la cella quasi scura quanto la più scura ma con meno energia. Se una cella è bruciata o tagliata da parte a parte resta da giudicare a te.

## Test del fuoco

**Laser → Test e calibrazione → Test laser …** aiuta a trovare la distanza giusta tra testa laser e materiale.

- **Rampa** funziona con ogni laser. Inclina il materiale su uno spessore, incidi una lunga linea con segni di altezza sotto, poi fai clic nella finestra sul punto più nitido. KizamuBeam ti dice di quanto è spostato il fuoco.
- **Serie Z** richiede un asse Z motorizzato. Incide una fila di brevi linee, ognuna con un offset Z diverso. Fai clic sulla più nitida per inserire il suo offset nel livello o portare Z direttamente lì.

Come il test del materiale, anche il test del fuoco non tocca mai il documento.

## Calibrare l’accoppiamento {#calibrate-fit}

I pezzi a incastro si accoppiano solo se kerf e gioco sono giusti. **Laser → Test e calibrazione → Calibra accoppiamento …** (anche nella Casella degli strumenti e nella finestra Materiale) crea pezzi di prova su una nuova pagina:

- un quadrato di 20 × 20 mm per misurare il kerf,
- un pettine di asole con larghezze a gradini,
- una piastra con fori e un pettine di linguette con gioco a gradini.

I numeri vengono incisi su un livello separato. Dopo la lavorazione, misura il quadrato e inserisci la misura, insieme al numero della linguetta e dell’asola che si accoppiano meglio. KizamuBeam calcola kerf, gioco per lato e maggiorazione delle asole e li salva con il materiale nella libreria. Un offset kerf del livello viene considerato.

Da quel momento nuove scatole, cassetti, inserti e scaffali prendono spessore, kerf e gioco dalla calibrazione del materiale del livello, e lo strumento Giunzione propone valori adatti. I pezzi esistenti ricevono un pulsante per applicare i valori calibrati, e il [controllo del progetto](construction-3d.md#check-the-design-before-cutting) confronta le giunzioni con la calibrazione.

## Note del progetto {#project-notes}

**Finestra → Note** conserva note sul materiale (tipo, spessore, fornitore), sulla configurazione (fuoco, piano, origine, come è fissato il pezzo) e sull’elaborazione (ordine, passaggi, finitura, cosa cambiare la prossima volta). Le note vengono salvate nel file del progetto e nei modelli, così la volta successiva parti da ciò che hai imparato.
