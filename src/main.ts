import './styles.css';
import { Game } from './app/game.ts';

/**
 * Punkt wejścia.
 *
 * Faza 0 nie ma konta, backendu ani telemetrii — świadomie (sekcja 19).
 * Jedyne, co tu jest poza uruchomieniem gry, to przełączniki do playtestu:
 *
 *   ?net=lte      — symulacja opóźnienia i jitteru (profile w transport.ts)
 *   ?debug=1      — nakładka z pomiarami budżetów z sekcji 4
 *   ?seed=12345   — powtarzalny mecz, do porównywania zmian balansu
 */

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const uiRoot = document.querySelector<HTMLElement>('#ui');

  if (!canvas || !uiRoot) {
    throw new Error('Brak #scene lub #ui w dokumencie');
  }

  const params = new URLSearchParams(window.location.search);

  const game = new Game({
    canvas,
    uiRoot,
    netProfile: params.get('net') ?? 'local',
    debug: params.get('debug') === '1',
  });

  const seedParam = params.get('seed');
  if (seedParam !== null) {
    const seed = Number.parseInt(seedParam, 10);
    if (Number.isFinite(seed)) {
      // Powtarzalny mecz startuje od razu — pomija ekran startowy,
      // bo służy do porównywania zmian, a nie do grania.
      game.startMatch(seed >>> 0);
    }
  }

  // WebGL potrafi zgubić kontekst przy przełączeniu aplikacji na Androidzie.
  // Bez tego gracz wraca do czarnego ekranu i zamyka kartę.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('Utracono kontekst WebGL — wymagane przeładowanie');
    document.body.dataset.contextLost = '1';
  });

  canvas.addEventListener('webglcontextrestored', () => {
    window.location.reload();
  });

  window.addEventListener('pagehide', () => game.dispose());
}

try {
  boot();
} catch (err) {
  console.error(err);
  document.body.innerHTML =
    '<div style="padding:24px;font:14px system-ui;color:#e8edf6">' +
    'Nie udało się uruchomić gry. Sprawdź, czy przeglądarka obsługuje WebGL2.' +
    '</div>';
}
