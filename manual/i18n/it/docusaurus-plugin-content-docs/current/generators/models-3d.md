---
sidebar_position: 5
title: Modelli a strati e a nervature
description: Trasformare un file STL o OBJ in strati sovrapposti da incollare o in nervature su un dorso.
---

# Modelli a strati e a nervature

KizamuBeam trasforma un modello 3D (STL, binario o testo, oppure OBJ) in parti piatte che puoi tagliare al laser. Ci sono due modi, entrambi in **Casella degli strumenti → Modelli 3D a incastro**. Quando apri o importi un file STL o OBJ, o lo trascini sull’area di lavoro, KizamuBeam chiede quale vuoi.

Il modello viene salvato una sola volta nel file del progetto, così le parti si possono modificare di nuovo in seguito con un doppio clic.

## Modello a strati

Il modello viene tagliato in pannelli sovrapposti che poi incolli insieme: teste, figure, rilievi, terreni.

| Impostazione | Significato |
|---|---|
| **Su nel modello** | Quale asse del file punta verso l’alto. |
| **Livello** | Direzione di impilamento: dal basso verso l’alto, da davanti a dietro o da sinistra a destra. |
| **Dimensione (lato più lungo)** | Dimensione del modello finito in mm. |
| **Spessore del materiale** | Spessore di ogni pannello. |
| **Sezione trasversale** | Dove ogni pannello prende il suo contorno: al centro del livello; **esterno** (non manca nulla, i gradini si carteggiano via); oppure **interno** (nessuno strato sporge). |
| **Incidi numeri** | Ogni pannello riceve il suo numero, contato dal basso, come incisione sottile su un livello a parte “Etichette”. |
| **Area minima (mm²)** | Le isole più piccole vengono scartate, i fori più piccoli riempiti (Avanzate). |
| **Kerf** | Larghezza del taglio laser. |

Più corpi sovrapposti nel file vengono uniti per ogni strato. I buchi nella mesh fino a 0,5 mm vengono chiusi e segnalati. Il controllo avvisa di strati vuoti, strati in più pezzi e un numero molto alto di strati. La vista 3D mostra la pila.

**Consiglio:** con un modello largo, scegli la direzione di impilamento (**Livello**) in modo che gli strati siano il più grandi possibile: meno strati, meno incollaggi.

## Modello a nervature

Le nervature stanno trasversali a un asse e si infilano su un dorso con mezzi incastri, come nei kit di animali in legno.

| Impostazione | Significato |
|---|---|
| **Su nel modello** | Quale asse del file punta verso l’alto. |
| **Asse** | Da sinistra a destra, da davanti a dietro o dal basso verso l’alto: la direzione che seguono le nervature. |
| **Posizione del dorso** | Verticale, rivolto verso il davanti o di lato. |
| **Dimensione (lato più lungo)** | Dimensione del modello finito. |
| **Spessore del materiale** | Spessore del pannello. |
| **Distanza tra le nervature (centro-centro)** | Distanza tra le nervature. |
| **Incasso del dorso** | Evita che il dorso sporga tra le nervature (0 = contorno pieno). |
| **Gioco di accoppiamento** | Larghezza in più delle asole; negativo = accoppiamento a pressione. |
| **Incidi numeri** | Ogni nervatura riceve il suo numero; il dorso, sotto ogni asola, il numero della nervatura corrispondente. |
| **Piano di assemblaggio come pagina propria** | Aggiunge una pagina (che non viene tagliata) con la vista, tutti i numeri delle parti, l’ordine di montaggio e la distinta. |
| **Kerf** | Larghezza del taglio laser. |

Dove nervatura e dorso si incrociano, la linea comune viene divisa: la nervatura è incisa dal basso, il dorso dall’alto, così le nervature si infilano sul dorso dall’alto. I pezzi di nervatura che non raggiungono alcun dorso vengono scartati con un avviso.

### Sezioni

Animali e figure hanno bisogno di più di un dorso: corpo, zampe, testa, coda. Nell’area di disegno della finestra (viste frontale, laterale e dall’alto con la silhouette del modello) disegni delle **Sezioni**, ognuna con il suo asse. Un asse può essere una polilinea; le nervature stanno allora trasversali alla curva.

Ogni sezione ha una posizione del piano (**Centro** la mette a metà del materiale), una propria distanza tra le nervature, un raggio per la zona che le appartiene e un’estensione del suo dorso oltre l’asse, così il pannello di una zampa entra nel corpo e si incastra nelle nervature del corpo. Il pulsante di copia specchia una sezione, per esempio per la seconda zampa. Trascina punti e linee per modificarli; in un’altra vista il trascinamento sposta il piano.

**Suggerisci** trova automaticamente le sezioni come punto di partenza: il piano di simmetria del modello diventa il dorso del corpo, le zampe vengono seguite dal pavimento verso l’alto e le estremità sottili come una coda ricevono sezioni proprie e curve. Controlla e correggi il suggerimento prima di creare.

Altre opzioni:

- **Più denso nei dettagli, fino a**: dove il contorno cambia rapidamente (naso, orecchie), le nervature si avvicinano fino a questa distanza.
- **Dividi le piastre sopra** (Avanzate): i pannelli del dorso più lunghi, per esempio più lunghi del piano di lavoro, vengono divisi e uniti con una coda di rondine.
- **Spostamento del dorso** (Avanzate): sposta il dorso dal centro.

La vista 3D mostra il modello montato e lo controlla per le collisioni; il [controllo del progetto](../features/construction-3d.md#check-the-design-before-cutting) verifica inoltre se le parti si possono montare in un qualche ordine.

**Consiglio:** le parti sottili come le zampe hanno bisogno di una distanza tra le nervature che dia loro almeno due o tre nervature, altrimenti non hanno presa. Un materiale più spesso rende il modello più robusto, ma più grossolano.
