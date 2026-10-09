# Anforderungskatalog

Werkzeug zum Erstellen und Überwachen von Anforderungskatalogen. Läuft vollständig im Browser, ohne eigenen Server.

Live: https://hvonelling.github.io/anforderungskatalog/

## Was es kann

- Mehrere Projekte, je Projekt ein eigener Katalog.
- Mehrere Frontends je Projekt (etwa Admin, Kunde, Dienstleister), jedes mit eigenem Menübaum. Eine Anforderung kann weitere Frontends als betroffen markieren.
- Farben für Menüpunkte, sichtbar in Seitenleiste, Liste, Board und Tabelle.
- Teilanforderungen (eine Ebene) mit Unternummern wie REQ-012.1.
- Menüstruktur als Baum, Anforderungen je Menüpunkt, Priorität nach MoSCoW, Status Offen / In Arbeit / Erledigt.
- Ansichten: Übersicht (Fortschritt je Version und Phase, Lücken im Katalog), Liste, Board mit Ziehen zwischen Phasen, Tabelle, Voraussetzungen.
- Je Anforderung: Beschreibung, User Story, Akzeptanzkriterien, Voraussetzungen, Anhänge, Verlauf der Verschiebungen.
- Versionen mit Phasen, Lastenheft je Version zum Drucken oder als PDF.
- Papierkorb für gelöschte Anforderungen.
- Steckbrief je Projekt mit den Rahmenbedingungen für die Umsetzung.
- Umsetzung mit Claude Code: eine Phase als Auftrag exportieren (ZIP mit auftrag.json, AUFTRAG.md und Anhängen), Rückmeldung mit Vorschau einlesen. Vierter Status „Zu prüfen“, Kennzeichen „geändert seit Umsetzung“.
- Export und Import je Projekt als JSON-Datei.
- Helle und dunkle Darstellung.
- Am Handy: erfassen, bearbeiten, nachsehen. Board, Tabelle, Versionen-Verwaltung und Lastenheft gibt es nur am PC.

## Daten und Abgleich

Die Daten liegen im Browser des Geräts (Projekte im localStorage, Anhänge in IndexedDB).

Der Abgleich zwischen Geräten läuft über ein privates GitHub-Repo. Projekte und Anhänge werden vor dem Hochladen
mit einem Passwort verschlüsselt (AES-256-GCM, Schlüssel per PBKDF2). Einrichtung unter ⚙ Einstellungen:

1. Fine-grained Token für das Daten-Repo erzeugen (Contents: Read and write).
2. Auf dem ersten Gerät ein Passwort erzeugen und im Passwort-Manager ablegen.
3. Auf jedem weiteren Gerät denselben Token-Zugang und dasselbe Passwort eintragen.

Ablage im Daten-Repo:

    projekte/<Name>--<Projekt-ID>.enc.json
    anhaenge/<Projekt-ID>/<Anhang-ID>.bin

Zusammengeführt wird je Datensatz: Die jüngere Änderung gewinnt, Löschungen bleiben erhalten.
Dieses Code-Repo ist öffentlich. Es enthält keine Katalogdaten, keine Schlüssel und keine Passwörter.

## Entwicklung

    npm install
    npm run dev       # lokal starten
    npm test          # Tests
    npm run build     # Typprüfung und Build nach dist/
    npm run deploy    # Tests, Build, Veröffentlichung über den gh-pages-Zweig

Technik: Vite, TypeScript, Preact, Vitest.

    src/domain    Datenmodell, Zusammenführen, abgeleitete Sichten (ohne Oberfläche)
    src/storage   Speicher auf dem Gerät, Verschlüsselung, GitHub, Abgleich
    src/app       Zustand und Aktionen
    src/ui        Oberfläche

Probe des Abgleichs gegen das echte Repo (arbeitet in einem eigenen Unterordner und räumt auf):

    AK_LIVE_TOKEN=$(gh auth token) npx vitest run tests/live.test.ts
