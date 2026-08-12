# Faza 0 — protokół playtestu i bramka

Faza 0 ma **jedno** kryterium (sekcja 14 planu):

> 5 obcych osób gra ≥3 rundy z rzędu bez proszenia.

„Obcych" jest tu istotne. Znajomi i rodzina zagrają trzecią rundę z
uprzejmości i dadzą fałszywy sygnał — a to jest bramka, która ma chronić
przed zbudowaniem Fazy 1 na grze, w którą nikt nie chce grać.

„Bez proszenia" jest równie istotne. Liczy się runda rozpoczęta samodzielnie,
nie na pytanie „zagrasz jeszcze raz?".

---

## Zanim zaczniesz — krok 1 z sekcji 19

Napisz jedno zdanie i wklej je tutaj:

```
Gracz robi ..........., żeby wygrać ..........., i wraca jutro, bo ...........
```

Bez tego playtest nie ma czego mierzyć. Człon **Z** („wraca, bo") jest
najtrudniejszy i to on decyduje o retencji D1 — czyli o kryterium wyjścia
z Fazy 1. Jeśli po playteście nie umiesz go napisać, to jest wynik testu,
a nie brak wyniku.

---

## Krok 5 — 20 rund samodzielnie

Sekcja 19 pkt 5: *„Zagraj 20 rund samodzielnie; zanotuj moment, w którym
się nudzisz"*.

Notuj **sekundę**, nie wrażenie. Tabela do wypełnienia:

| Runda | Sekunda znudzenia | Co się wtedy działo |
|---|---|---|
| 1 | | |
| … | | |

Typowe odpowiedzi i co z nimi zrobić:

| Objaw | Prawdopodobna przyczyna | Gdzie szukać |
|---|---|---|
| nuda w 30–60 s | za długa faza bez kontaktu | `bots.ts` — `AGGRO_START_TICKS` |
| nuda po śmierci | brak powodu, by oglądać koniec | kamera po śmierci, `renderer.ts` |
| frustracja, nie nuda | za krótkie TTK albo brak wyjścia z opresji | `ATTACK_DAMAGE`, `DASH_COOLDOWN_TICKS` |
| „nie wiem, co robić" | brak czytelnego celu na ekranie | HUD, zapowiedź strefy |
| „nie wiem, co mnie zabiło" | killfeed nie wystarcza | `hud.ts`, kierunek obrażeń |

---

## Krok 7 — bramka na 5 osobach

**Nie tłumacz sterowania.** Ekran startowy ma to zrobić za Ciebie. Jeśli
musisz cokolwiek dopowiedzieć, zapisz co — to jest wynik testu.

Dla każdej osoby notuj:

| # | Rundy z rzędu | Sam zaczął kolejną? | Co powiedział bez pytania | Kiedy odłożył telefon |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

Dwa pytania po sesji, zadane dokładnie w tej kolejności:

1. *„Co się właśnie stało?"* — sprawdza czytelność, nie zabawę.
   Jeśli nie umie opisać, dlaczego zginął, gra jest nieczytelna niezależnie
   od tego, czy była fajna.
2. *„Zagrałbyś jutro?"* — sprawdza człon **Z**. Odpowiedź „może" liczy się
   jako „nie".

### Osobno: test botów (sekcja 7)

> „Bot musi być nie do odróżnienia przez pierwsze 60 s."

Nie pytaj *„czy to były boty?"* — to pytanie sugeruje odpowiedź. Zapytaj:
*„ilu ludzi z tobą grało?"*. Jeśli ktoś sam z siebie powie „to były boty"
w pierwszej minucie — bramka botów jest niezaliczona, niezależnie od reszty.

W kodzie odpowiadają za to trzy rzeczy, wszystkie w `sim/bots.ts`:
opóźnienie reakcji (decyzje co 250–550 ms), dryf toru (bot nie idzie prosto)
i wahanie (losowe przystanki). Bot celujący idealnie czyta się jako bot
w kilkanaście sekund.

---

## Test na urządzeniu — czego CI nie zmierzy

Uruchom `?debug=1` na **fizycznym** średniej klasy Androidzie. Nakładka
pokazuje FPS, najgorszą klatkę, transfer i błąd predykcji.

| Metryka (sekcja 4) | Cel | Twardy limit |
|---|---|---|
| FPS | 60 | 30 |
| Time to interactive | ≤2,5 s | 4 s |
| RAM | ≤250 MB | 400 MB |
| Dane / mecz | ≤1,5 MB | 3 MB |

Transfer i rozmiar bundla są już zmierzone i mieszczą się z zapasem
(patrz README). **FPS, TTI i RAM nie są zmierzone** — wymagają prawdziwego
urządzenia, bo pomiar z programowego renderowania w CI nie mówi nic.

Sprawdź też cykl życia (sekcja 4: „mobile jest wrogi"):

- [ ] przełączenie aplikacji w tło w trakcie meczu i powrót po <30 s
- [ ] powrót po >30 s — powinien pokazać „Ponowna synchronizacja"
- [ ] zablokowanie i odblokowanie ekranu
- [ ] przychodzące połączenie w trakcie rundy
- [ ] obrót ekranu
- [ ] gra przy `?net=lte` i `?net=bad` — czy sterowanie nadal jest znośne

---

## Decyzja po playteście

Możliwe wyniki są trzy i tylko trzy:

1. **Bramka zaliczona** → Faza 1. Zakres w sekcji 14 planu; `sim/` przenosi
   się na serwer, `LocalTransport` ustępuje miejsca WebSocketowi.
2. **Bramka niezaliczona, ale wiadomo dlaczego** → popraw ten jeden element
   i powtórz playtest. Nie dokładaj funkcji.
3. **Bramka niezaliczona i nie wiadomo dlaczego** → wróć do sekcji 1 planu
   i zmień format. To nie jest porażka projektu, tylko jego najtańszy możliwy
   moment na zmianę zdania.

Czego **nie** wolno zrobić w żadnym z tych trzech przypadków: przejść do
Fazy 1 „mimo wszystko, bo szkoda pracy". Sekcja 16 wskazuje ryzyka 1–3
(gra nie jest fajna / pusty serwer / wypalenie) jako dominujące — i żadnego
z nich nie rozwiązuje architektura.
