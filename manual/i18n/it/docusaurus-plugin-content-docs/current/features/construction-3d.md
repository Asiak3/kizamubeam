---
sidebar_position: 10
title: Giunzioni, cerniere e vista 3D
description: Aggiungi giunzioni a dita, tenoni, incastri a scatto e cerniere a qualsiasi forma, adatta le asole al materiale e controlla gli assiemi nella vista 3D.
---

# Giunzioni, cerniere e vista 3D

KizamuBeam trasforma forme normali in pezzi che si incastrano o si incollano. I [generatori](../generators/index.md) creano scatole, cassetti e scaffali completi; gli strumenti di questa pagina lavorano sulle forme che hai disegnato o importato tu.

## Lo strumento Giunzione

Lo strumento **Giunzione** (il pulsante Giunzione nella barra Strumenti, o **Casella degli strumenti → Giunzioni e piegatura → Giunzioni**) aggiunge una giunzione tra due bordi rettilinei:

1. Scegli lo strumento. La barra di stato chiede il primo bordo.
2. Fai clic sul primo bordo rettilineo. Riceve le dita o i tenoni.
3. Fai clic sul secondo bordo rettilineo. Riceve la controparte o le asole. Se il secondo “bordo” è una singola linea disegnata, la linea viene sostituita dalle asole: così metti una mortasa in mezzo a un pannello.
4. Imposta le opzioni nella finestra e conferma.

Il risultato resta un percorso normale e modificabile. La giunzione ricorda lo spessore del materiale, così [Ridimensiona asole](#resize-slots-to-the-material) può aggiornarla in seguito.

| Tipo | Uso |
|---|---|
| **Giunzione a dita** | Angoli delle scatole: dita che si incastrano lungo entrambi i bordi. |
| **Giunzione a mortasa e tenone** | Tenoni su un pannello, asole corrispondenti (mortase) nell’altro, anche in mezzo a un pannello. |
| **Mezzo legno incrociato** | Entrambi i pezzi ricevono asole dello spessore del materiale e si infilano l’uno nell’altro; la profondità si divide tra i due (per esempio 50 % ciascuno). Più asole danno inserti a griglia e divisori per bottiglie. |
| **Giunzione a scatto** | Tenoni con due linguette elastiche e ganci di ritegno; sporgenza, lunghezza del gancio e fessura elastica sono regolabili. Tiene senza colla. |
| **Giunzione a gancio** | Tenoni a gancio a forma di L: inserisci, poi fai scorrere. L’asola viene allungata della lunghezza del gancio. |
| **Tenone a cuneo** | I tenoni attraversano l’altro pannello e hanno un foro per il cuneo; vengono creati anche i cunei. |
| **Asola a T** | Un’asola per vite con finestra per il dado tra ogni coppia di tenoni e un foro per la vite corrispondente nell’altro pannello. |
| **Cerniera del coperchio (con perno)** | Vedi [Cerniera del coperchio](#lid-hinge) sotto. |

Le impostazioni comuni sono lo spessore del materiale, il **kerf** (dita e tenoni vengono disegnati più larghi, spazi e asole più stretti, così i pezzi hanno la misura nominale dopo il taglio) e il **gioco** per lato (valori negativi danno un accoppiamento forzato). Quando il materiale è [calibrato](materials-tests.md#calibrate-fit), lo strumento propone kerf e gioco per il tipo scelto.

## Cerniera del coperchio {#lid-hinge}

Una cerniera con perno permette al coperchio di una scatola di aprirsi oltre 90°. Avviala da **Casella degli strumenti → Scatole e mobili → Cerniera del coperchio**, oppure scegli **Cerniera del coperchio (con perno)** nello strumento Giunzione:

1. Fai clic sul bordo superiore della parete posteriore.
2. Fai clic sul bordo posteriore del coperchio.

Entrambi i pannelli ricevono delle asole, e accanto vengono creati gli anelli con i fori per il perno. Gli anelli esterni appartengono alla scatola, quelli intermedi al coperchio. Incolla gli anelli nelle asole e infila un perno (filo, tondino, chiodo o filamento) in tutti gli occhi. Numero di anelli, diametro del perno, gioco del perno e parete intorno al foro sono regolabili.

## Cerniere viventi {#living-hinges}

**Casella degli strumenti → Giunzioni e piegatura → Cerniera vivente** riempie una forma chiusa selezionata con un motivo di tagli, così il pannello si piega in quel punto. Motivi: tagli dritti, onde, rombi, nido d’ape, triangoli, intreccio e spirale. La finestra mostra un’anteprima dal vivo e parte da valori adatti allo spessore del materiale. I tagli sono linee esatte e curve di Bézier.

Metti l’area della cerniera sul livello di taglio del pezzo. Compensato e MDF si piegano meglio perpendicolarmente alla venatura dello strato esterno; prova prima su un ritaglio.

## Ridimensionare le asole al materiale {#resize-slots-to-the-material}

Il materiale raramente è spesso esattamente quanto dichiarato. **Casella degli strumenti → Giunzioni e piegatura → Ridimensiona asole** trova le asole in cui si infila un’altra lastra, anche in progetti SVG o DXF importati e in pezzi che sono già semplici percorsi:

- ritagli (mortase, anche un rettangolo separato dentro una lastra),
- intagli dal bordo (asole incrociate, mezzo legno),

ciascuno con due lati paralleli e più profondo che largo. Gli spazi delle giunzioni a dita non vengono toccati.

La finestra propone la larghezza di asola più frequente (o lo spessore del materiale del livello), evidenzia in arancione le asole trovate e allarga o restringe ogni asola della differenza rispetto al nuovo spessore, così il gioco resta lo stesso. Cerca nella selezione o, se non è selezionato nulla, in tutta la pagina. Scatole, cassetti, inserti e scaffali dei generatori ricevono invece il nuovo spessore come parametro. Un passo di annullamento.

## Posizionare scanalature e intagli

**Strumenti → Posiziona scanalature / intagli…** inserisce scanalature o intagli rettangolari in una forma chiusa a una distanza esatta:

1. Seleziona un oggetto vettoriale chiuso.
2. Nell’anteprima dello strumento scegli un angolo di riferimento (rosso) e un bordo rettilineo (arancione).
3. Inserisci la distanza lungo il bordo e scegli se misurarla fino al primo bordo esterno, al centro o al secondo bordo esterno della scanalatura.

Puoi preparare più tagli su bordi diversi prima di applicarli. **Applica** è un passo di annullamento, **Annulla** scarta tutto, e un doppio clic sul pezzo riapre lo strumento.

## Vista 3D {#3d-view}

**Finestra → Vista 3D** (o il pulsante 3D nella barra principale) mostra i pezzi montati, come saranno dopo il taglio:

- Scatole, cassetti, inserti, scaffali e coppie di ingranaggi dei generatori vengono montati automaticamente. Gli ingranaggi di una coppia possono girare.
- I pezzi uniti con lo strumento Giunzione vengono montati sui bordi uniti: un pezzo sta in piano, gli altri sono in piedi su di esso.
- Le altre forme chiuse sui livelli di taglio stanno in piano con uno spessore regolabile; le forme annidate diventano fori.
- I modelli a strati, a nervature e a dischi da [modelli 3D](../generators/index.md) vengono mostrati montati.

Ruota la vista con il mouse o usa le viste predefinite (3D, dall’alto, frontale). Il cursore **Esplodi** allontana i pezzi tra loro. Senza selezione la vista mostra tutta la pagina; un pezzo selezionato porta sempre con sé il suo intero assieme.

**Collisioni**: dove due pezzi si compenetrano (per esempio con un accoppiamento forzato o un’asola troppo stretta) l’area diventa rossa, e la riga di stato indica i pezzi e il volume.

**Incisioni**: con la casella **Incisioni**, riempimenti, linee incise, testo e immagini elaborate compaiono sulla faccia che era in alto durante la lavorazione, con una leggera profondità.

### Aspetto del materiale {#material-look}

Ogni livello di taglio può avere un aspetto proprio nella finestra del livello, in **Aspetto in 3D**: 21 preimpostazioni come compensato di pioppo e di betulla, faggio, rovere, noce, bambù, MDF, cartone, sughero, cuoio, ardesia, granito, acrilico trasparente, colorato e opaco, vetro, alluminio anodizzato e acciaio inox, ognuna con un colore proprio facoltativo. Le incisioni appaiono diverse a seconda del materiale: bruciatura scura sul legno, grigio chiaro sull’ardesia, bianco satinato su acrilico e vetro. I livelli senza aspetto proprio lo prendono dal nome della loro voce nella [libreria dei materiali](materials-tests.md#material-library).

Per mostrare un pezzo piano senza taglio (un sottobicchiere in ardesia, per esempio), disegna il suo contorno su un livello con l’uscita disattivata: diventa la lastra.

### Mockup per i clienti

Spunta **Mockup** nella finestra 3D per nascondere la griglia e i segni rossi delle collisioni e ottenere ombre morbide e uno sfondo a scelta (gradiente da studio, bianco, grigio, scuro o come l’interfaccia). **Salva immagine …** salva la vista attuale come PNG a doppia risoluzione.

## Controllare il progetto prima del taglio {#check-the-design-before-cutting}

**Laser → Controlla progetto** (o **Finestra → Controllo del progetto**) cerca problemi nella pagina corrente e segna ogni risultato sull’area di lavoro. Un clic su un risultato seleziona gli oggetti e ingrandisce il punto; dove possibile, un pulsante lo corregge in un passo di annullamento.

Trova, tra l’altro:

- linee che verrebbero tagliate due volte,
- contorni quasi chiusi (spazio fino a 1 mm) e linee singole che formano un contorno ma non sono unite,
- linee aperte su livelli di riempimento, che verrebbero saltate,
- ponti tra due tagli più stretti del ponte minimo (predefinito 1 mm, larghezza di taglio inclusa),
- ritagli troppo piccoli per la larghezza di taglio,
- oggetti fuori dall’area di lavoro,
- elementi che un’importazione SVG o DXF ha dovuto saltare,
- l’**accoppiamento** delle giunzioni a incastro dei generatori e dello strumento Giunzione rispetto a spessore del materiale e kerf (troppo stretto, molto stretto, molto lasco).

Il **controllo di montaggio** va oltre per gli assiemi dei generatori (scatola, cassetto, inserto, scaffale, sfera a dischi, modello a strati e a nervature): ogni pezzo deve essere un’unica parte connessa, e il controllo monta i pezzi uno dopo l’altro. Se nessun ordine funziona con movimenti rettilinei, ricevi un avviso.

Le impostazioni (ponte minimo, larghezza di taglio, ampiezza degli spazi, livelli che incidono soltanto) sono nella stessa finestra, insieme all’opzione di controllare prima di ogni lavoro. Se all’avvio di un lavoro restano problemi, KizamuBeam li elenca e chiede se proseguire.
