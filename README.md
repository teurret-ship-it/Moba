# Arena — Faza 0

Prototyp grywalności areny sesyjnej. Web-first, Three.js, sterowanie jedną ręką.

Realizacja **Fazy 0** z „Kompletnego planu projektu — gra sesyjna mobilna".
Cel fazy jest jeden i wąski: **sprawdzić, czy gra jest fajna**. Nic więcej.

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # symulacja, netcode, sonda balansu
npm run build          # produkcyjny build do dist/
npm run build:single   # jeden samodzielny plik HTML do dist-single/
```

`build:single` daje `dist-single/arena.html` — całą grę w jednym pliku (~519 kB,
zero zewnętrznych żądań). To jest format do wysłania pięciu obcym osobom
z kroku 7 Fazy 0: otwiera się na cudzym telefonie bez instalacji, konta
i bez serwera. Ten sam plik przyjmują portale web z sekcji 8.

---

## Co to jest

Arena „last man standing" dla 12 uczestników, 2,5D izometryczna, runda do
4 minut, lobby wypełnione botami. Gracz porusza się pływającą gałką na lewej
połowie ekranu, atak podstawowy jest **automatyczny** (wymóg jednej ręki),
a trzy przyciski po prawej to trzy decyzje:

| Akcja | Działanie | Odnowienie |
|---|---|---|
| ➤ **Skok** | szybki wyskok w kierunku ruchu, bez możliwości sterowania w locie | 6 s |
| ◍ **Cień** | znikasz — serwer przestaje wysyłać cię innym klientom | 14 s |
| ✸ **Fala** | wybuch obszarowy, odrzuca i wybija z ukrycia (także ciebie) | 10 s |

Do tego: kurcząca się strefa, trzy rodzaje dropów (leczenie, prędkość,
obrażenia), zrzuty zaopatrzenia co 45 s jako generator starć oraz
regeneracja poza walką.

Przełączniki do playtestu:

```
?debug=1      nakładka z pomiarami budżetów (albo klawisz F3)
?net=lte      symulacja opóźnienia: local | wifi | lte | bad
?seed=12345   powtarzalny mecz — do porównywania zmian balansu
```

---

## Czego tu świadomie NIE MA

Sekcja 19 planu: *„Backendu w tym tygodniu nie ma. Świadomie."*
Sekcja 17 (budżet złożoności): moduł wchodzi do fazy tylko wtedy, gdy jest
wymagany do jej działania, chroni pieniądze, chroni dane osobowe, jest
wymagany przez Google Play albo rozwiązuje **zmierzony** problem.

Nie ma więc: serwera, kont, bazy, telemetrii, zgód, ekonomii, zakupów,
rankingu, sklepu, dźwięku, TWA ani CI/CD deploymentu. To nie jest
zaległość — to są pozycje Fazy 1 i 2, które wchodzą **po** bramce Fazy 0.

---

## Architektura — i dlaczego akurat taka

Prototyp jest lokalny, ale nie jest napisany „na wyrzucenie". Sekcja 3 planu
mówi wprost, że retrofit autorytatywnego serwera po starcie ekonomii oznacza
przepisanie gry. Dlatego granice są postawione od razu:

```
src/
├── sim/         SYMULACJA — czysta, deterministyczna, zero DOM i zero Three.js
│   ├── sim.ts          krok symulacji o stałym DT (20 Hz)
│   ├── movement.ts     ruch — jedyne miejsce zmieniające pozycję
│   ├── combat.ts       walka, umiejętności, regeneracja
│   ├── zone.ts         kurcząca się strefa
│   ├── pickups.ts      dropy i zdarzenia mapy
│   ├── bots.ts         AI wypełniające lobby
│   └── snapshot.ts     filtr widoku: AoI + stealth, 15 Hz
├── client/      NETCODE — predykcja, interpolacja, transport
├── render/      Three.js, tekstury proceduralne, efekty
├── input/       gałka dotykowa + przyciski + klawiatura
├── ui/          HUD i ekrany (DOM, nie canvas)
└── app/         pętla gry i cykl życia
```

**Katalog `sim/` przenosi się w Fazie 1 na serwer bez zmian.** Nie importuje
`window`, nie zna renderu i nie wie, który slot jest „graczem lokalnym".
Klient rozmawia z nim przez `Transport` — podmiana `LocalTransport` na
`WebSocketTransport` nie dotyka renderu, predykcji ani HUD-u.

### Trzy rzeczy zrobione „za wcześnie" i dlaczego

1. **Snapshot z filtrem AoI i stealth** (`sim/snapshot.ts`).
   Gracz w ukryciu **nie jest wysyłany do klienta w ogóle** — nie leci
   z flagą `invisible`, tylko go nie ma w ładunku. Dopisanie tego później
   oznaczałoby przeprojektowanie stealth i zasięgu widzenia, bo gra byłaby
   już zbalansowana pod pełną wiedzę klienta.

2. **Predykcja własnego ruchu + interpolacja 100 ms wstecz** (`client/`).
   Ryzyko #4 z sekcji 16. Prototyp bez opóźnienia zawsze jest przyjemny;
   pytanie brzmi, czy jest przyjemny przy 150 ms. Odpowiedź jest mierzalna
   już teraz (`?net=lte`, `?net=bad`).

3. **Determinizm i pomiar pasma.**
   Symulacja nie używa `Math.random` — mecz odtwarza się z `seed`. Budżet
   „≤1,5 MB na mecz" jest liczony od pierwszego dnia, bo po fakcie nie da się
   go poprawić bez przebudowy widoku.

Wszystko troje mieści się w regule z sekcji 17: to nie jest zapas na
przyszłość, tylko rzeczy, których dopisanie później kosztuje przepisanie gry.

---

## Zmierzone wartości

Wobec budżetów z sekcji 4 i 13 planu:

| Metryka | Budżet | Zmierzone |
|---|---|---|
| Initial download | ≤15 MB (limit 20) | **~526 kB** (137 kB gzip) |
| Zużycie danych / mecz | ≤1,5 MB (limit 3) | **~0,22 MB** |
| Snapshot | — | 101 B @ 15 Hz ≈ 1,5 kB/s |
| Tick symulacji | 15–20 Hz | 20 Hz |
| Snapshoty | 15 Hz | 15 Hz (wzorzec 1-1-2) |

Grafika jest generowana proceduralnie w canvasie, więc bundle to praktycznie
sam Three.js. Zero assetów do pobrania, zero pipeline'u, zero licencji.

FPS nie jest tu podany celowo: jedyny pomiar, jaki mam, pochodzi z
programowego renderowania (SwiftShader) w środowisku CI i nie mówi nic
o prawdziwym telefonie. **To trzeba zmierzyć na fizycznym urządzeniu** —
`?debug=1` pokazuje FPS i najgorszą klatkę.

---

## Balans — stan i otwarta kwestia

`src/sim/__tests__/balance.probe.test.ts` mierzy tempo rundy na 10 seedach.
Pierwszy pomiar pokazał, że runda kończy się po **92 sekundach**, a po minucie
żyje 3,5 gracza z 12 — czyli format nie spełniał wymogu „sesja 3–6 minut"
z sekcji 1. Trzy zmiany, każda wymierzona w zmierzoną przyczynę:

1. **regeneracja poza walką** — runda była czystą attrycją bez odzyskiwania HP;
   przy okazji nadaje wartość ucieczce, więc Skok i Cień przestają być tylko
   narzędziami ataku,
2. **obniżone obrażenia** ataku (9 → 5) i Fali (26 → 20),
3. **narastanie agresji botów** — bez tego wszystkie 12 botów ruszało do walki
   w sekundzie zero i runda nie miała wczesnej fazy, tylko masakrę i dogrywkę.

Stan po zmianach: **min 136 s, mediana 145 s, maks. 158 s; po minucie żyje
5,7 z 12**.

> **Otwarta kwestia do rozstrzygnięcia w playteście.** Mediana 2:25 jest wciąż
> poniżej dolnej granicy 3 minut z sekcji 1. Dalszego wydłużania celowo nie
> robiłem: wymagałoby dalszego obniżania obrażeń, a to robi walkę „gąbczastą" —
> uderzając w jedyne kryterium Fazy 0. Dodatkowo to pomiar samych botów;
> człowiek gra ostrożniej. Decyzja należy do playtestu, nie do strojenia liczb
> w próżni.

---

## Czego brakuje, żeby zamknąć Fazę 0

Sekcja 19 planu wymienia siedem kroków pierwszego tygodnia. Kroki 2–4 są
zrobione (jeden tryb, jedna mapa, boty, warunek zwycięstwa). Zostają:

**Krok 1 — zdanie, którego nie mogę napisać za Ciebie.**
Sekcja 1: *„gracz robi X, żeby wygrać Y, i wraca jutro, bo Z"*. Dopóki to nie
jest napisane, Faza 0 nie ma kryterium sukcesu. Prototyp zakłada:
*„gracz walczy o przetrwanie w kurczącej się arenie, żeby zostać ostatnim,
i wraca, bo runda trwa 4 minuty i za każdym razem układa się inaczej"* —
ale **człon Z jest tu najsłabszy i to jest założenie, nie decyzja.**

**Kroki 5–7 — playtest.** Protokół i bramka: [`docs/FAZA0.md`](docs/FAZA0.md).

Bramka wyjścia z Fazy 0: **5 obcych osób gra ≥3 rundy z rzędu bez proszenia.**
Jeśli nie — wracasz do sekcji 1, nie idziesz do Fazy 1. To jest najważniejsza
bramka w całym planie i najczęściej pomijana.
