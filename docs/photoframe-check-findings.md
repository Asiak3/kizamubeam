# Lokale Untersuchung: Prüfmeldungen in photoframe.kzb

Abgeschlossen auf ausdrücklichen Wunsch: alle Fragen beantwortet. Die folgenden
Untersuchungsnotizen sind historische Befunde, keine offene Arbeitsanforderung.

Die bereitgestellte Datei wurde nur gelesen und nicht verändert oder
veröffentlicht. Keine automatische Linienbereinigung, kein Jobversand und kein
Maschinentest. Auswertung mit `checkDesign()` und den Standard-Prüfeinstellungen.

## Reproduziert

29 Objekte; 12 Fehler, 164 Warnungen, 1 Hinweis:

- 12 rote Stegbefunde;
- 152 weitere Stegwarnungen;
- 12 Warnungen zu doppelten Linien;
- 1 Importhinweis.

Die ersten Doppelmeldungen (34,5 mm bzw. 5,50 mm) stimmen mit dem Screenshot
überein. Alle Doppel-/Stegbefunde betreffen C00, `mode: line`, 350 mm/min,
60 % Leistung, Kerf 0. C01 ist Füllgravur, 18000 mm/min, 55 %; C02 ist ebenfalls
als Füllmodus gespeichert, hat auf der aktiven Seite aber keine Objekte.

## Gravur gegenüber Schnitt

Die Füllkonturen werden von der Doppel-Schnittlinienprüfung bereits ausgeschlossen.
Kontrollrechnung nur mit den C00-Objekten liefert **identische Doppel- und
Stegbefunde**, auch wenn sämtliche Füllgravur-Objekte weggelassen werden.
Die vorliegenden Warnungen entstehen also nicht durch Schnitt/Füllgravur-
Überlagerung, sondern durch als Schnitt gespeicherte Konturen.

Beispiele: Doppelbefund `33:32` (34,5 mm), `43:33` (5,50 mm), beide auf C00.
Vor einer Bereinigung muss geklärt werden, ob diese C00-Konturen tatsächlich
alle schneiden sollen. Nicht aufgrund der Meldung pauschal Linien entfernen.

## Stegbreite und Schnittfuge

Standardwerte unter „Prüfung“ → Zahnrad:

- Mindeststeg: 1 mm;
- Schnittfuge: 0,15 mm;
- Toleranz für verbundene/deckungsgleiche Linien: 0,05 mm.

Die Prüfung misst von geschlossenen Schnittkonturen ins vermutete Material.
Verbleibende Breite = geometrischer Abstand − halbe Schnittfuge beider Seiten
+ Kerf-Ausgleich beider Seiten. Ein positiver Rest unter dem Mindeststeg wird
gelb, ein Rest ≤ 0 rot gemeldet. Die Schnittfugenbreite ist eine Annahme und muss
zum tatsächlichen Material/Prozess passen; Leistung allein bestimmt sie nicht.

Die kleinsten hervorgehobenen Querabstände der zwölf roten Befunde liegen etwa
zwischen 0,055 und 0,086 mm, also unter 0,15 mm. Das erklärt die Einstufung bei
Standardwerten, belegt aber keine vollständige Trennung eines tragenden Stegs.
Mehrere Befunde liegen zwischen Abschnitten derselben Kontur. Die Prüfung nutzt
lokale Abstände und Gerade-Ungerade-Schachtelung, keine vollständige Simulation
der verbleibenden Materialzusammenhänge. Spitzen/überlappende Konturen können
deshalb zusätzliche Interpretation erfordern. Ein einzelner sehr schmaler Wert
macht den gesamten zusammengefassten Befund rot, auch wenn viele angezeigte
Querstriche wesentlich breitere Stellen zeigen.

Die tatsächlichen benutzerspezifischen Prüfeinstellungen liegen separat im
lokalen Einstellungsbereich, nicht in der KZB-Datei. Sie wurden nicht ausgelesen.
Keine Warnungen oder Grenzwerte wurden aufgrund dieser Untersuchung abgeschaltet.

## Nachvollziehbarkeit und nächste Prüfung

Read-only Diagnose:
`node scripts/run-ts.mjs scripts/check-project-diagnostic.ts <datei.kzb>`.
Lokales Ergebnis: `artifacts/local-prototypes/photoframe-check.json`.
Das Ergebnis enthält Projektkoordinaten und ist kein öffentlicher Issue-Anhang.

Noch erforderlich: C00-Zuordnung mit dem Entwurfszweck abgleichen und die
roten Engstellen anhand der tatsächlichen Schnittfuge beurteilen. Material,
Dicke und gemessene Schnittfuge sind aus dieser Datei nicht zuverlässig ableitbar.
Es wurde deshalb kein spekulativer Fix an der sicherheitsrelevanten Prüfung
vorgenommen. Substanzielle Unterstützung: GPT 6.1 Sol (OpenAI) via OpenCode.
