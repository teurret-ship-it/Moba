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

`build:single` daje `dist-single/arena.html` — całą grę w jednym pliku (~541 kB,
zero zewnętrznych żądań). To jest format do wysłania pięciu obcym osobom
z kroku 7 Fazy 0: otwiera się na cudzym telefonie bez instalacji, konta
i bez serwera. Ten sam plik przyjmują portale web z sekcji 8.

---

## Co to jest

Arena „last man standing" dla 12 uczestników, 2,5D izometryczna, runda do
4 minut, lobby wypełnione botami. Gracz porusza się pływającą gałką na lewej
połowie ekranu, atak podstawowy jest **automatyczny** (wymóg jednej ręki),
a trzy przyciski po prawej to trzy decyzje.

### Trzy klasy

Wszystkie dzielą tę samą strukturę kitu — trzy sloty, zawsze te same trzy
przyciski. Gracz uczy się sterowania raz, a mimo to każda klasa gra inaczej;
przy jednej ręce na telefonie to warunek, nie wygoda.

| Klasa | Sylwetka | RUCH | SZTUCZKA | MOC |
|---|---|---|---|---|
| **Łowca** | koło, 100 HP | ➤ Skok | ◍ Cień | ⁙ Salwa — 3 strzały z dystansu |
| **Kolos** | sześciokąt, 120 HP | ⏵ Szarża — tratuje i odrzuca | ❖ Tarcza — pochłania 40 obrażeń | ✸ Fala — wybuch dookoła |
| **Widmo** | grot, 102 HP | ⇢ Mgnienie — teleport przez mur | ◍ Cień | ✦ Rozdarcie — stożek, z ukrycia ×2 |
| **Kuglarz** | dwa koła, 112 HP | ⇄ Zamiana — zamiana miejsc z kopią | ⧉ Zwód — kopia rzucana przed siebie | ❋ Sidła — obszarowe spowolnienie |

**Kuglarz nie walczy o pozycję — walczy o to, gdzie przeciwnik myśli, że jesteś.**
Cała jego trójka działa razem: stawiasz kopię, wróg bije w nią, ty zamieniasz się
z nią miejscami i lądujesz mu za plecami. **Kopia leci tam, dokąd idziesz** —
uciekasz, to zostaje na drodze ucieczki i zamiana wyrywa cię z kontaktu;
nacierasz, to ląduje między wami i zamiana jest wejściem. Kopia jest dla botów nieodróżnialna od
gracza — konkuruje o ich auto-atak na tych samych zasadach, więc dają się nabrać
tak samo jak człowiek. Jako jedyna klasa nie ma mocy zadającej obrażenia, więc
rekompensatą jest najwyższe obrażenie na sekundę z auto-ataku: spowolniony
przeciwnik nie ucieknie przed ciągłym ostrzałem.

**Ukrycie wycisza auto-atak.** Atak jest automatyczny, więc gracz nie może go
powstrzymać — a strzelając w ukryciu sam by się zdradzał w chwili podejścia do
celu. Cień jest więc stanem decyzji: wychodzisz z niego własnym ciosem,
w wybranym momencie, a nie dlatego, że wróg wszedł w zasięg.

**Cecha klasy.** Widmo ma jedyną cechę działającą bez przycisku: *eliminacja
natychmiast odnawia Cień*. Powód jest w pomiarze, nie w fikcji — patrz sekcja
o balansie niżej.

### Sterowanie

Gałka jest **pływająca** — pojawia się tam, gdzie kciuk dotknie swojej połowy
ekranu. Porównania wariantu pływającego ze stałym dają im podobną użyteczność,
z lekką przewagą pływającego w łatwości nauki; przy bramce, która mierzy
pierwsze wrażenie obcych ludzi, to rozstrzyga.

**Martwa strefa jest skalowana promieniowo.** Wcześniej siła wychylenia
liczyła się jako `odległość / promień` z twardym odcięciem poniżej progu —
czyli tuż za krawędzią martwej strefy postać ruszała od razu z ~10%
prędkości zamiast od zera. To jest dokładnie ten uskok, przed którym
ostrzegają opisy martwych stref: pełny zakres 0..1 ma być rozciągnięty
**od krawędzi martwej strefy** do krawędzi gałki, a nie od jej środka.
Promień gałki jest ułamkiem krótszego boku ekranu (przyciętym do przedziału),
a martwa strefa ułamkiem promienia — wartości stałe w pikselach rozjeżdżają
się między telefonem a tabletem.

**Układ da się odbić lustrzanie.** „Lewy kciuk rusza, prawy działa" to
założenie o ręce gracza, nie fakt o człowieku; poradniki sterowania dotykowego
wymieniają wsparcie dla odbicia jako wymóg. Przełącznik jest na ekranie
startowym, razem z wibracją i wstrząsem. Przyciski akcji mają 66 i 84 px przy
wytycznej 48 dp — z zapasem.

### Progresja w trakcie rundy

Za walkę i przetrwanie zbierasz doświadczenie. Na każdym poziomie dostajesz
**trzy karty do wyboru** — dwanaście ulepszeń wspólnych, każde do wzięcia kilka
razy (siła, wampiryzm, drugie życie, impet…), plus **dwie karty klasowe**
widoczne tylko dla swojej klasy. Wybory się kumulują, więc pod koniec rundy
ta sama klasa gra inaczej niż na starcie.

| Klasa | Karty klasowe |
|---|---|
| **Łowca** | ⁘ Grad — Salwa strzela częściej · ☾ Czajenie — dłuższy i szybszy Cień |
| **Kolos** | ⛨ Pancerz — grubsza Tarcza · ⏻ Taran — mocniejsza Szarża |
| **Widmo** | ☠ Zasadzka — Rozdarcie z ukrycia bije jeszcze mocniej · ⇶ Przeskok — częstsze Mgnienie |
| **Kuglarz** | ⧈ Trwała kopia — twardszy Zwód · ❊ Ciasne sidła — silniejsze spowolnienie |

Wspólne dwanaście podnosi liczby; klasowe zmieniają to, co postać robi. Karta
klasowa nie trafia do obcej klasy — dla niej byłaby martwa, a martwa karta
w ofercie trzech to w praktyce oferta dwóch.

Trzy decyzje projektowe, wszystkie wymuszone przez cel Fazy 1:

1. **Gra się nie zatrzymuje.** Pauza jest niemożliwa w meczu z ludźmi, więc nie
   wolno jej zakładać już teraz. Karty czekają na tapnięcie, runda leci dalej.
2. **Wybór ma termin.** Po 9 sekundach ulepszenie wybiera się samo.
3. **Serwer rozstrzyga.** Klient przysyła numer karty, nigdy efektu — indeks
   jest walidowany wobec oferty, którą serwer sam wystawił.

### Rdzeń — struktura środkowej fazy

Między pierwszymi potyczkami a domknięciem przez strefę runda nie miała
własnego pytania. Zrzuty zaopatrzenia dawały powód, żeby gdzieś pójść, ale nie
powód, żeby się o coś bić — drop podnosi pierwszy, kto dobiegnie.

**Rdzeń** to punkt przejęcia ogłaszany wszystkim, i cały zamysł siedzi
w regułach:

- **stoisz w miejscu, żeby go przejąć** — a stanie w miejscu na arenie jest
  najdroższą rzeczą, jaką można zrobić,
- **dwóch graczy zatrzymuje postęp** — nie wygrywa szybszy, tylko ten, kto
  zostanie sam,
- **ukryty nie przejmuje** — inaczej Cień dawałby przejęcie nie do
  zakwestionowania,
- **zmiana zdobywcy zeruje postęp** — nagrodą jest utrzymanie miejsca, nie
  dobiegnięcie na ostatnią sekundę cudzej pracy,
- **nagrodą jest awans**, czyli karta ulepszenia — mechanika, którą gracz już
  zna, i realna szansa dla przegrywającego, bo to on ma najwięcej powodów, żeby
  zaryzykować.

Rdzeń pojawia się dopiero, gdy zostało ≤8 graczy: punkt sporny przy dwunastu
żywych nie jest starciem, tylko młynkiem. Ma strukturyzować środek rundy,
a nie przyspieszać jej początek.

### Czytelność walki

`docs/FAZA0.md` wymienia „nie wiem, co mnie zabiło" jako osobną skargę
playtestera — gra może być dobrze zbalansowana i nadal nieczytelna. Na ekranie
sześciu cali obraz nie zdąży przekazać trzech rzeczy, więc każda ma własny
sygnał:

- **skąd** — łuk przy krawędzi ekranu wskazuje źródło obrażeń; napastnik bywa
  poza kadrem,
- **ile** — liczby obrażeń, w dwóch kolorach: zadane i otrzymane,
- **gdzie** — kompas do strefy, gdy jesteś poza kręgiem i nie widzisz jego
  krawędzi na ziemi.

Do tego zatrzymanie obrazu na kilkadziesiąt milisekund przy mocnym ciosie
(trafienie ma „ważyć") i stała obwódka przy niskim zdrowiu — obwódka mówi
„jesteś o krok od śmierci", a błysk mówi „właśnie oberwałeś"; to dwie różne
informacje i mają dwa różne sygnały.

**Trzy kanały naraz.** Opisy „game feel" zgadzają się co do jednego: sygnał
zwrotny działa wtedy, gdy trafia w oczy, uszy i dłonie jednocześnie. Dwa
pierwsze były od początku (efekty i syntezowany dźwięk), trzeciego nie było.
Trafienie daje teraz krótki impuls wibracji — dławiony, bo obrywa się kilka
razy na sekundę, i przełączalny, bo część ludzi wibracji nie znosi, a część
jej nie czuje. Haptyka jest dodatkiem do obrazu i dźwięku, nigdy jedynym
nośnikiem informacji.

**Wstrząs kamery ma kierunek.** Wcześniej był losowy w obie strony i mówił
tylko „coś się stało". Teraz idzie wzdłuż wektora ciosu — kamera jest
odpychana OD napastnika — więc sam ruch obrazu niesie tę samą informację, co
łuk na krawędzi. Wygaszanie zostało wykładnicze: kamera musi wracać szybko,
inaczej traci się czytelność. Całość respektuje `prefers-reduced-motion`
i ma własny przełącznik, który nadpisuje ustawienie systemowe w obie strony.

**Czego świadomie nie wziąłem:** prawdziwego hitstopu w rozumieniu bijatyk,
czyli zatrzymania *symulacji*. Symulacja jest autorytatywna i ma stały krok
czasowy, a w Fazie 1 stanie na serwerze — zatrzymanie jej po stronie klienta
to rozjazd stanu. Zatrzymywana jest wyłącznie klatka obrazu (do 120 ms),
podczas gdy świat leci dalej.

### Dźwięk

Cała ścieżka dźwiękowa jest **syntezowana przez WebAudio w locie** — zero
plików, tak samo jak grafika. Dźwięk nie jest tu ozdobą: niesie informację,
której obraz na małym ekranie nie zdąży przekazać — że trafiono właśnie
CIEBIE, że ktoś obok wyszedł z ukrycia, że strefa rusza. Zdarzenia w świecie
są tłumione odległością i panoramowane względem gracza, komunikaty interfejsu
(awans, zrzut) grają bez tłumienia.

Kontekst audio budzi się dopiero przy tapnięciu „Graj" (polityka
autoodtwarzania), milknie przy przejściu w tło, a wyciszenie zapisuje się
w `localStorage` i jest odwracalne jednym tapnięciem w trakcie rundy.

### Teren

Arena nie jest już gołym dyskiem: filary i mury są **generowane z ziarna
meczu**, więc każda runda ma inny układ osłon. Przeszkody blokują ruch i linię
strzału — zza muru nie da się trafić ani zostać trafionym, więc osłona jest
decyzją, a nie dekoracją.

Teren **nie jest wysyłany w snapshocie**: klient generuje go z tego samego
ziarna tą samą funkcją, więc statyczny układ mapy kosztuje zero bajtów na
ramkę. To jest w duchu sekcji 15 — manifest treści wersjonowany osobno od
stanu, nie doklejany do każdej ramki.

Mgnienie Widma **przechodzi przez mur**. To jedyna rzecz, która obraca teren
na jego korzyść: osłona z natury pomaga temu, kto chce zerwać kontakt,
a zabójca musi go nawiązać.

Do tego: kurcząca się strefa, trzy rodzaje dropów (leczenie, prędkość,
obrażenia), zrzuty zaopatrzenia co 45 s jako generator starć, regeneracja poza
walką oraz wejście do nowej rundy od razu po eliminacji — bramka Fazy 0 mierzy
chęć zagrania jeszcze raz, nie długość pojedynczej rundy.

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
rankingu, sklepu, TWA ani CI/CD deploymentu. To nie jest
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
│   ├── classes.ts      trzy klasy i parametry umiejętności
│   ├── combat.ts       walka, umiejętności, regeneracja
│   ├── upgrades.ts     dwanaście ulepszeń i statystyki wynikowe
│   ├── progression.ts  doświadczenie, awanse, wybór kart
│   ├── terrain.ts      przeszkody z ziarna, kolizje, linia strzału
│   ├── objective.ts    Rdzeń — punkt przejęcia
│   ├── zone.ts         kurcząca się strefa
│   ├── pickups.ts      dropy i zdarzenia mapy
│   ├── bots.ts         AI wypełniające lobby
│   └── snapshot.ts     filtr widoku: AoI + stealth, 15 Hz
├── client/      NETCODE — predykcja, interpolacja, transport
├── render/      Three.js, tekstury proceduralne, efekty
├── audio/       syntezowane efekty (WebAudio, bez plików)
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
| Initial download | ≤15 MB (limit 20) | **~569 kB** (~148 kB gzip) |
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

Tempo mierzone jest teraz na **24 seedach**, a próg dotyczy dziesiątego
percentyla, nie minimum: pojedynczy przebieg, w którym wszystko zbiegło się
naraz, jest ogonem rozkładu, a nie wadą formatu. Stan obecny:
**p10 149 s, mediana 191 s, maks. 240 s** — mediana po raz pierwszy mieści się
w przedziale 3–6 minut z sekcji 1.

Tempo urosło jeszcze raz, ubocznie: po naprawieniu weta strefy (niżej) boty
przestały ginąć na własne życzenie i **mediana wynosi 186 s, p10 159 s**.

Druga sonda, `classes.probe`, pilnuje równowagi klas na **240 rundach**.
Decyzje o strojeniu podejmuję jednak na osobnym pomiarze 400-rundowym
z policzonym błędem — sonda w repozytorium jest bramką regresji, nie
narzędziem strojenia.

Zmierzony stan (400 rund, błąd standardowy przy rozkładzie Poissona):

| | początek iteracji 10 | koniec |
|---|---|---|
| Łowca | 1,49 ± 0,12 | **1,15 ± 0,11** |
| Kolos | 1,28 ± 0,11 | **1,21 ± 0,11** |
| Widmo | 0,56 ± 0,07 | **0,87 ± 0,09** |
| Kuglarz | 0,69 ± 0,08 | **0,78 ± 0,09** |

Rozrzut spadł z 0,93 do 0,43.

> **Sonda na 120 rundach mnie okłamywała.** Odczyt „1,14 / 1,28 / 0,62 / 0,96",
> na podstawie którego zamknąłem poprzednią iterację, przy 400 rundach okazał
> się „1,49 / 1,28 / 0,56 / 0,69" — myliłem się co do tego, która klasa
> dominuje. Błąd ±0,22 przy 120 rundach był w kodzie opisany od dawna; i tak
> odczytywałem z tej próby różnice mniejsze niż on. Próba jest teraz
> dwukrotnie większa, a każda decyzja o strojeniu ma przy sobie błąd.

> Próba jest duża celowo. Przy 60 rundach na klasę wypada ~20 zwycięstw,
> a szum Poissona na takiej liczbie to ±0,22 na współczynniku — strojenie
> różnic mniejszych niż 0,4 na takiej próbie to gonienie własnego ogona.
> Przekonałem się o tym, przerzucając „dominację" między Łowcą a Kolosem
> trzy razy z rzędu, zanim zwiększyłem próbę.

> **Otwarta kwestia do rozstrzygnięcia w playteście.** Mediana 2:44 wciąż jest
> poniżej dolnej granicy 3 minut z sekcji 1. Dalszego wydłużania celowo nie
> robiłem: wymagałoby dalszego obniżania obrażeń, a to robi walkę „gąbczastą" —
> uderzając w jedyne kryterium Fazy 0. Dodatkowo to pomiar samych botów;
> człowiek gra ostrożniej. Decyzja należy do playtestu, nie do strojenia liczb
> w próżni.

Runda jest też z założenia „przednio obciążona": po minucie żyje ok. 4,5 z 12.
Próby sztucznego spowalniania wczesnej fazy psuły tempo całej rundy, więc
odpowiedzią jest natychmiastowe wejście do następnej rundy po eliminacji,
a nie rozciąganie tej trwającej.

### Widmo — jak pomiar zmienił projekt, a nie liczby

Widmo długo siedziało na 0,46. Odruch mówi „dodaj mu obrażeń", ale zanim
cokolwiek ruszyłem, doraźna instrumentacja policzyła, *gdzie* ta klasa traci
rundę. Wynik był jednoznaczny i zaskakujący:

| | Łowca | Widmo |
|---|---|---|
| średnie miejsce | 6,01 | 6,50 |
| w pierwszej trójce | 31% | 29% |
| **zwycięstwa** | **46** | **12** |

Widmo dociera do finałowej trójki praktycznie tak samo często — i tam przegrywa.
To nie jest problem siły, tylko końcówki: w finale nie ma się gdzie schować,
a Cień odnawia się 14 sekund, więc klasa oparta na zaskoczeniu wchodzi
w decydujące 30 sekund bez swojego jedynego narzędzia.

Stąd cecha **Zniknięcie**: eliminacja natychmiast odnawia Cień. Oddaje Widmu
końcówkę i nagradza dokładnie to, do czego jest zbudowane, zamiast podnosić mu
obrażenia w otwartym polu, którego i tak nie ma wygrywać. Efekt: **0,39 → 0,72**
w tym samym pomiarze, przy jednoczesnym ściągnięciu Łowcy z 1,55 (karta *Grad*
w pierwszej wersji dawała mu +40 obrażeń w jednym przycisku).

Cecha jest przypisana klasie, nie umiejętności — Łowca też ma Cień i też by ją
dostał, a jest po drugiej stronie tabeli.

**Dwa błędy znalezione przez sondy, nie przez granie:**

- *Slot RUCH dawał darmowy pęd.* Mgnienie ma prędkość 210, a prędkość po
  zakończeniu skoku nie była ucinana — hamowanie z takiej wartości trwa ~3 s.
  Widmo leciało więc długo po teleporcie i wynosiło je średnio 7,5 jednostki
  poza kurczący się krąg: **74 śmierci od strefy na 40 rund wobec 3 u Kolosa**.
  Wyglądało to na problem równowagi klas, a było błędem kinematyki. Po
  poprawce: 4 śmierci od strefy.
- *Boty zbiegały się na jedną ofiarę.* Pół lobby brało ten sam cel, który ginął
  w sekundy niezależnie od tempa rampy agresji. Kara za tłok w wyborze celu
  przywróciła wczesnej fazie kształt potyczek.

### Trzy mechanizmy, które działały tylko na papierze

Iteracja 10 nie dołożyła treści — obeszła to, co już było, i sprawdziła
pomiarem, czy naprawdę działa. Trzy rzeczy nie działały.

**1. Zamiana Kuglarza nie zdarzała się nigdy.** Klasa jest opisana zdaniem
„stawiasz kopię, wróg bije w nią, ty zamieniasz się z nią miejscami". Pomiar
na 6807 tickach, w których bot miał postawioną kopię i gotową Zamianę:
opłacalna zamiana istniała w **0,9%** z nich. Powód był geometryczny — kopia
stawała dokładnie pod nogami właściciela, więc zamiana z nią nie zmieniała
niczego. Mediana różnicy odległości (kopia→cel) − (ja→cel) wynosiła 0,2.

Kopia leci teraz **tam, dokąd idziesz** (a gdy stoisz — tam, gdzie patrzysz).
Jedna reguła, bez trybu: uciekasz — kopia zostaje na twojej drodze ucieczki
i zamiana wyrywa cię z kontaktu; nacierasz — kopia ląduje między wami i
zamiana jest wejściem. Zamiany na postawioną kopię: 0,54 → 1,0.

**2. Boty popełniały samobójstwa slotem RUCH.** Pomiar końcówki na 200
rundach, w momencie gdy zostaje trzech:

| | w finale | konwersja na wygraną | zgony od strefy |
|---|---|---|---|
| Łowca | 186 | 0,39 | 12 |
| Kolos | 134 | 0,37 | 1 |
| **Widmo** | **169** | **0,20** | **51** |
| Kuglarz | 110 | 0,40 | 0 |

Widmo docierało do finału częściej niż Kolos i Kuglarz, z takim samym
zdrowiem i poziomem — i przegrywało. Mgnienie przenosi 10,5 jednostki w
jednym ticku, a w końcówce krąg ma kilkanaście jednostek średnicy: uciekający
bot wyskakiwał z niego na wylot. Bot ma teraz weto strefy, liczone z tych
samych parametrów co symulacja. Zgony od strefy: 51 → 7, konwersja 0,20 → 0,29.

To był **trzeci raz**, kiedy pozorna nierównowaga klas okazała się błędem
gdzie indziej — i drugi raz, kiedy dotyczyło to tego samego slotu RUCH Widma.

**3. Nerf, który leczył cudzą chorobę.** Zanim znalazłem weto strefy, ściąłem
Tarczę Kolosa (34 → 28), bo miał najwyższy współczynnik. Po naprawieniu
Widma Kolos spadł do 0,77 — jego „dominacja" brała się z tego, że ktoś inny
oddawał finały. Wartość wróciła do 34.

**Jeden błąd znaleziony przez test, który sam był błędny.** Karta *Czajenie*
obiecywała, że „Cień nie spowalnia" — a ukrycie w tej grze nigdy nie
spowalniało, tylko przyspieszało (mnożnik 1,18). Karta nie robiła więc nic
poza wydłużeniem czasu, a test, który miał to sprawdzić, przewracał się na
własnym założeniu. Projekt karty poszedł za kodem, nie odwrotnie.

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

---

## Źródła

Iteracja 11 (sterowanie i odczucie) nie wyszła z mojego gustu — poniżej to,
z czego wyszła. Każda pozycja odpowiada konkretnej zmianie opisanej wyżej.

- [Doing Thumbstick Dead Zones Right — Josh Sutphin](https://joshsutphin.com/blog/doing-thumbstick-dead-zones-right.html)
  oraz [Minimuino/thumbstick-deadzones](https://github.com/Minimuino/thumbstick-deadzones)
  — skalowana promieniowa martwa strefa i uskok, który powstaje bez niej.
- [Touch Input Best Practices for Unity Mobile Games](https://scriptsforunity.com/blog/touch-input-best-practices-unity/)
  — rozmiar martwej strefy względem ekranu, wymóg odbicia lustrzanego układu,
  ograniczenie gałki do jednej połowy ekranu.
- [Interpreting Analog Sticks — Hypersect](http://blog.hypersect.com/interpreting-analog-sticks/)
  — dlaczego wychylenie liczy się promieniowo, a nie po osiach.
- [Maximizing Game Feel in Action Game Development](https://salivity.github.io/game-development/article/maximizing-game-feel-in-action-game-development)
  — hitstop rzędu 40–80 ms, wstrząs zgodny z wektorem uderzenia, wygaszanie
  wykładnicze dla zachowania czytelności.
- [The „Juice" Factor: Designing Game Feel](https://hackread.com/the-juice-factor-designing-game-feel/)
  — sygnał zwrotny ma trafiać w oczy, uszy i dłonie jednocześnie.
- [Haptic Feedback for Web Apps with the Vibration API](https://blog.openreplay.com/haptic-feedback-for-web-apps-with-the-vibration-api/)
  — krótkie impulsy, przełącznik do uszanowania, haptyka jako dodatek,
  nie jedyny kanał.
- [Touch target size — Android Accessibility Help](https://support.google.com/accessibility/android/answer/7101858?hl=en)
  i [Material Design: Accessibility](https://m1.material.io/usability/accessibility.html)
  — minimum 48 × 48 dp dla elementów dotykowych.
- [Design accessible animation and movement](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)
  — `prefers-reduced-motion` i zasada, że informacja niesiona przez ruch musi
  być podana także inaczej.
