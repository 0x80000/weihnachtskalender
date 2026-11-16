# Adventskalender Studio

Web-App zum Gestalten eines Bilder-Türchen-Adventskalenders: 24 Fotos auf A3 oder A4 anordnen und die Druck- und Schnittdateien für den Plotter erzeugen. Die App läuft vollständig im Browser – die Bilder verlassen den eigenen Rechner nicht.

## Starten

**Online:** <https://0x80000.github.io/weihnachtskalender/> (nach Aktivierung von GitHub Pages). In Chrome oder Edge lässt sich die Seite über „App installieren“ in der Adressleiste als eigenes Programmfenster einrichten und danach auch offline nutzen.

**Portabel:** Repository über *Code → Download ZIP* herunterladen, entpacken und `index.html` per Doppelklick in Chrome oder Edge öffnen. Keine Installation, kein Internet nötig.

## Funktionen

- Format A3 oder A4, Hoch- oder Querformat
- Türchen frei verschieben und skalieren (mit Einrasten) oder automatisch anordnen – als Raster oder als Mosaik
- Bildausschnitt je Türchen verschieben und zoomen, Bilder tauschen, mischen oder nach Aufnahmedatum verteilen
- Metadaten beim Überfahren mit der Maus: Aufnahmedatum, Ort (GPS), Kamera, Belichtung, Druckauflösung
- Perforation für Türchenkante und Knickkante getrennt einstellbar (Schnittlänge und Steglänge), Scharnierseite global oder je Türchen
- Text für die Rückseite jedes Türchens, passend gespiegelt für den beidseitigen Druck
- Türchen-Nummern mit wählbarer Schrift, Größe, Farbe und Position
- Projekt speichern und öffnen (inklusive Bildern), Rückgängig/Wiederholen

## Exportierte Dateien

| Datei | Format | Inhalt |
| --- | --- | --- |
| 1 · Bilderbogen | PDF | Die 24 Bilder in Originalauflösung, 600 oder 300 dpi |
| 2 · Schnittdatei | SVG | Schnittlinien für Brother ScanNCut / CanvasWorkspace |
| 3 · Rückseite | PDF | Texte für die Rückseite der Türchen |
| 4 · Deckblatt | PDF | Vorderseite mit Nummern, Farbe oder Hintergrundbild |
| 5 · Zahlen | SVG | Türchen-Nummern als Schnittkonturen zum Plotten, platzsparend in Klebe-Reihenfolge |
| 6 · Textkärtchen | SVG | Schnittlinien für die Rückseitentexte, etwas kleiner als die Türchen, zum Ausschneiden und Einkleben |

## Hinweise zur Brother ScanNCut

- Die SVG-Datei in CanvasWorkspace importieren oder per USB-Stick an der Maschine laden.
- Jeder Perforationsschnitt ist eine einzelne echte Linie; eine Strichlinien-Funktion der Maschine wird nicht benötigt.
- Der optionale Blattrahmen dient als Ausrichthilfe. Nach dem Import muss er exakt dem Papierformat entsprechen; vor dem Schneiden löschen.
- A4 passt auf die 12″×12″-Matte, A3 benötigt die 12″×24″-Matte.
- Zuerst an einem Probeblatt testen und die Steglänge anpassen.

## Technik

Reines HTML, CSS und JavaScript ohne Abhängigkeiten und ohne Build-Schritt. HEIC-Bilder werden vom Browser nicht unterstützt und müssen vorher als JPG exportiert werden. Die optionale Ortsnamen-Suche sendet ausschließlich GPS-Koordinaten an nominatim.openstreetmap.org und ist standardmäßig ausgeschaltet.

## Simple Mode und Profi Mode

Die App startet im Simple Mode mit den wichtigsten Schritten. Der Profi Mode blendet zusätzlich Detailwerte für Layout, Schnitt, Schrift und Rückseiten ein. Der Modus wird lokal im Browser gemerkt; ein Wechsel verändert keine Projekteinstellungen.

Unter **Deckblatt personalisieren** ein Hintergrundbild wählen und mit Zoom sowie horizontaler/vertikaler Position den Ausschnitt einstellen. Vorschau und Deckblatt-PDF verwenden denselben Ausschnitt.

In der Ansicht **Deckblatt → Zahlen verschieben** ein Türchen ziehen, um nur dessen Zahl innerhalb des Türchens zu verschieben. Alternativ ein Türchen auswählen und rechts die beiden Positionsregler bedienen. **Zahlenposition zurücksetzen** stellt die globale Position wieder her. Individuelle Positionen werden im Projekt gespeichert und im Druck übernommen; der platzsparende Zahlen-Schnittbogen bleibt automatisch angeordnet.

### Browserprüfung

Mit installiertem Node.js, Playwright und Chromium: lokalen Server mit `python3 -m http.server 8010 --bind 127.0.0.1` starten, dann `node tests/browser.cjs http://127.0.0.1:8010` ausführen. Bei anderem Chromium-Pfad `CHROMIUM_PATH` setzen. Die Prüfung testet Modi, Deckblattbild und Ausschnitt, Zahlenposition, Undo/Redo, Projektdateien (auch ältere) und PDF-Erzeugung.

Die Option **Türchen-Umrandung auf dem Deckblatt** ist in beiden Modi verfügbar. Ausschalten entfernt die Umrisse in Vorschau und Deckblatt-PDF; die separate Schnittdatei enthält weiterhin die Perforation.
