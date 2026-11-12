## Fehlerbeschreibung

Im Fenster **Schnitte / Layer** aktualisiert sich die sichtbare Layer-Reihenfolge nach einem Klick auf **▲ / ▼** nicht unmittelbar. Erst ein weiterer Klick auf die Layer-Liste bzw. ein Fokuswechsel macht die Änderung sichtbar. Intern sind die Prioritäten bereits geändert; die Anzeige kann daher von der tatsächlichen Ausgabereihenfolge abweichen.

## Umgebung und Reproduktion

- Windows, KizamuBeam 2.7.0; beobachtet in einem lokalen Testbuild auf Basis von `480d5b1` mit zusätzlichen Editor-Prototypen.
- Die betroffene Fokusbedingung ist unverändert bereits im zugrunde liegenden Upstream-Code vorhanden.

1. Neues Projekt mit Objekten auf mindestens zwei Layern erstellen.
2. Unter **Schnitte / Layer** einen Layer auswählen.
3. Den Button **▲** oder **▼** anklicken.
4. Ohne weiteren Klick die Liste beobachten.

**Erwartet:** Die Layer-Liste zeigt die neue Reihenfolge sofort.

**Tatsächlich:** Die Liste wirkt unverändert, bis erneut in die Liste geklickt bzw. der Fokus geändert wird.

## Eingrenzung als Implementierungshinweis

In `src/ui.ts`, Funktion `buildLayers()`, verhindert die Bedingung im geplanten Refresh den Neuaufbau, solange **irgendein** Element innerhalb des Panels fokussiert ist:

```ts
if (!root.contains(document.activeElement)) render();
```

Auch der gerade angeklickte Pfeilbutton liegt im Panel. Der Schutz für laufende Eingaben greift dadurch zu weit. Als möglicher Ansatz sollte nur eine tatsächlich aktive Bearbeitung in Eingabe-/Auswahlfeldern den Refresh zurückhalten, nicht ein Aktionsbutton. Dabei weiterhin prüfen, dass Name-/Zahleneingaben nicht während der Bearbeitung verloren gehen.

Es wird bewusst nur ein Issue gemeldet, kein PR vorgeschlagen; die konkrete Implementierung kann der Maintainer übernehmen. Keine Änderung an Jobgenerierung oder Maschinenbefehlen erforderlich.

## Lokal geprüfter Ansatz

Ein kleiner lokaler Fokus-Guard-Fix wurde mit einer isolierten Browser-Fixture gegen die tatsächliche Panel-Funktion und Layer-Reihenfolgemethoden geprüft (deterministische Frame-/Timer-Queues):

- Gegenprobe mit alter Bedingung reproduziert den fehlenden Refresh beim fokussierten Aufwärtsbutton.
- Mit eingeschränktem Eingabeschutz werden Auf/Ab sofort sichtbar; aktiver Layer bleibt erhalten, ein Undo-Snapshot je Verschiebung.
- Aktive Texteingabe und Modusauswahl bleiben erhalten; verzögerte Übernahme nach Fokuswechsel geprüft.
- Frontend-Build, Prüfungs-, Interaktions- und G-Code-Tests sowie Übersetzungsprüfung bestanden.

Das sind lokale synthetische Prüfungen, keine unabhängige menschliche Review und keine native WebView-Abnahme des Fixes. Kein Hardwaretest. Für die Reproduktion sind keine privaten Projektdateien erforderlich.

## KI-Unterstützung

Analyse, lokaler Testansatz und dieser Bericht wurden wesentlich mit **GPT 6.1 Sol (OpenAI) via OpenCode** erstellt.
