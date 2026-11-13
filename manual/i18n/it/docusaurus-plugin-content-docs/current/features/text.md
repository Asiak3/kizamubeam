---
sidebar_position: 4
title: Testo e codici
description: Scrivi testo con qualsiasi font, mettilo su un percorso, usa testo variabile e numeri di serie e crea codici QR e codici a barre.
---

# Testo e codici

## Scrivere testo

Scegli lo strumento **Testo** (Ctrl+T) e fai clic sull’area di lavoro per iniziare a scrivere. Se invece di fare clic trascini un riquadro, ottieni una casella di testo con a capo automatico. Fai clic su un testo esistente per modificarlo.

La **barra del testo** sotto la barra delle modifiche numeriche contiene tutte le opzioni del testo: font, altezza, grassetto, corsivo, maiuscolo, spaziatura tra lettere e righe, allineamento, larghezza e altezza massime, unione, testo su percorso e testo variabile.

| Opzione | Effetto |
|---|---|
| **Unisci** | Fonde le lettere sovrapposte in un unico contorno, per font corsivi o spaziatura stretta. |
| **A capo** / **Larghezza massima** | Manda a capo alle parole alla larghezza della casella; la casella cresce verso il basso. Trascinando le maniglie laterali il testo si ridistribuisce. |
| **Altezza max.** | Riduce in modo uniforme un blocco che diventa troppo alto. |
| **Riduci** | Rimpicciolisce un testo troppo largo invece di comprimerlo. |

Il testo resta modificabile. **Converti in percorso** (Ctrl+Maiusc+C) lo trasforma nei contorni reali del font, per esempio prima di modificarne i nodi.

## Font

Si possono usare tutti i font installati sul computer. **File → Font …** (o **Altri font …** in fondo all’elenco dei font) apre il gestore dei font:

- Cerca tra tutti i Google Fonts con anteprima dal vivo del tuo testo di esempio, filtra per tipo e ordina per popolarità o nome.
- **Installa** scarica il font in KizamuBeam, così funziona offline e senza installarlo nel sistema. **Usa** lo applica al testo selezionato.
- Allo stesso modo importi i tuoi file TTF o OTF.
- Con la stella un font diventa preferito; i preferiti compaiono in cima all’elenco.

Se un progetto usa un font che manca su questo computer, KizamuBeam propone di scaricarlo da Google Fonts.

## Testo su un percorso

Seleziona un testo e una forma, poi scegli **Strumenti → Funzioni testo → Applica percorso al testo** (o **Sul percorso** nella barra del testo). Il testo segue la linea, la curva, il rettangolo, l’ellisse o il poligono. Nella barra del testo imposti lo scostamento lungo la curva, la distanza dalla curva e il lato su cui sta il testo.

Testo e forma restano collegati: se modifichi o sposti la forma, il testo la segue. Anche la forma viene lavorata, a meno che non si trovi su un livello strumento (T1/T2) o sia nascosta. **Strumenti → Funzioni testo → Rimuovi percorso dal testo** li separa di nuovo.

## Testo variabile e numeri di serie

Il testo variabile compila dei segnaposto quando viene creato il lavoro, per numeri di serie, date o nomi da un elenco. Attiva **Variabile** nella barra del testo e usa questi segnaposto:

| Segnaposto | Diventa |
|---|---|
| `%#` | Numero di serie; `%4#` con zeri iniziali (`0042`) |
| `%d.%m.%Y`, `%H:%M` … | Data e ora |
| `%0`, `%1` … o `%{Intestazione}` | Colonna di un file CSV (separato da virgola, punto e virgola o tabulazione) |

La finestra **Testo variabile** (**Strumenti → Funzioni testo → Testo variabile …**) imposta il numero corrente, inizio, fine, passo e se avanza automaticamente dopo ogni lavoro o file G-code salvato. Il numero è anche la riga del file CSV. Ogni oggetto può avere un proprio scostamento, così una pagina può contenere più numeri consecutivi.

**Consolida testo variabile** trasforma il contenuto attuale in testo fisso.

Per un’intera serie di pagine da una tabella vedi [Modelli e libreria](templates-library.md#series-from-a-table).

## Codici QR

Fai clic sul pulsante QR nella barra Strumenti (o cercalo nella Casella degli strumenti). Un codice QR può contenere:

- testo o un indirizzo web,
- i dati di accesso a una rete Wi-Fi,
- un biglietto da visita (vCard).

Scegli la correzione degli errori (L, M, Q, H) e la dimensione in mm. **Immagine negativa** lavora lo sfondo inclusa la zona di rispetto, per materiali scuri. I moduli vengono fusi in contorni chiusi, quindi metti il codice su un livello **Riempimento** per inciderlo. Un doppio clic su un codice QR lo modifica.

## Codici a barre

**Casella degli strumenti → Testo e dati → Codice a barre** crea codici Code 128, EAN-13, EAN-8, UPC-A, Code 39 e ITF, con cifra di controllo dove il formato la prevede. Imposta larghezza e altezza delle barre, mostra il testo leggibile sotto le barre e riduci la larghezza delle barre per compensare la larghezza del raggio. **Immagine negativa** lavora gli spazi invece delle barre. La finestra avvisa quando le barre diventano troppo sottili per il laser.

Anche codici QR e codici a barre accettano testo variabile e parametri del progetto, per esempio un numero di serie come Code 128.
