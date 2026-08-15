import { describe, expect, it } from 'vitest';
import html from '../../../index.html?raw';
import manifestRaw from '../../../public/manifest.webmanifest?raw';
import iconRaw from '../../../public/icon.svg?raw';

/**
 * Kod pyta o elementy, których w dokumencie może nie być.
 *
 * `required(root, '#coś')` rzuca dopiero w przeglądarce, przy starcie gry —
 * czyli literówka w identyfikatorze przechodzi przez typy, testy jednostkowe
 * i budowanie, a wywala się dopiero graczowi. Ten test czyta oba źródła
 * i porównuje: co kod pobiera po identyfikatorze wobec tego, co jest w HTML.
 *
 * Celowo jest tekstowy, a nie oparty na DOM — nie dokładam jsdom do projektu,
 * którego cały sens polega na tym, że da się go zbudować i uruchomić
 * na telefonie z jednego pliku. Źródła wciąga `import.meta.glob`, więc test
 * nie potrzebuje też dostępu do systemu plików.
 */

const sources = import.meta.glob('../../**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('zgodność kodu z dokumentem', () => {
  it('każdy pobierany identyfikator istnieje w index.html', () => {
    const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));

    const missing: string[] = [];
    for (const [path, code] of Object.entries(sources)) {
      if (path.includes('__tests__')) continue;
      const wanted = code.matchAll(
        /(?:required\([^,]+,\s*|querySelector<[^>]*>\(|querySelector\()'#([\w-]+)'/g,
      );
      for (const m of wanted) {
        const id = m[1]!;
        if (!declared.has(id)) missing.push(`${path} → #${id}`);
      }
    }

    expect(missing, `brakujące elementy:\n${missing.join('\n')}`).toEqual([]);
  });

  it('przełączniki ustawień mają etykietę, wartość i stan', () => {
    for (const id of ['set-handed', 'set-haptics', 'set-motion']) {
      const block = html.slice(html.indexOf(`id="${id}"`));
      const button = block.slice(0, block.indexOf('</button>'));
      expect(button, `${id} bez nazwy`).toContain('setting-name');
      expect(button, `${id} bez wartości`).toContain('setting-value');
      // Stan przełącznika musi być czytelny dla czytnika ekranu, nie tylko
      // dla oka — kolor obramowania nie jest informacją.
      expect(button, `${id} bez aria-pressed`).toContain('aria-pressed');
    }
  });
});

/**
 * Manifest decyduje o tym, czy grę da się zainstalować na ekranie domowym —
 * a to jest pierwszy krok playtestu z sekcji 19, bo tak gra trafia na telefon
 * obcej osoby. Zepsuty manifest nie daje żadnego objawu poza tym, że
 * przycisk „zainstaluj" się nie pojawia.
 */
describe('manifest', () => {
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;

  it('ma pola wymagane do instalacji', () => {
    for (const field of [
      'name', 'short_name', 'start_url', 'display',
      'theme_color', 'background_color', 'icons',
    ]) {
      expect(manifest[field], `brak pola ${field}`).toBeDefined();
    }
  });

  it('jest pionowy i pełnoekranowy — tak jak zbudowany jest HUD', () => {
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.display).toBe('fullscreen');
  });

  it('ma ikonę zwykłą i maskowalną', () => {
    const icons = manifest.icons as Array<{ src: string; purpose?: string }>;
    expect(icons.length).toBeGreaterThan(0);
    // Bez wariantu „maskable" system przycina ikonę do własnego kształtu
    // i obcina jej zawartość.
    expect(icons.some((i) => i.purpose?.includes('maskable'))).toBe(true);
    for (const icon of icons) expect(icon.src).toBe('./icon.svg');
  });

  it('kolory manifestu zgadzają się z motywem strony', () => {
    // Rozjazd daje biały błysk przy uruchamianiu zainstalowanej gry.
    expect(manifest.background_color).toBe('#0b0e15');
    expect(html).toContain('name="theme-color" content="#0b0e15"');
  });

  it('ikona mieści treść w bezpiecznym obszarze', () => {
    // „Maskable" znaczy, że system może przyciąć ikonę do koła o 80%
    // szerokości. Sprawdzamy, że największy okrąg się w nim mieści.
    const radius = Number(/<circle[^>]*r="(\d+)"/.exec(iconRaw)?.[1]);
    expect(radius).toBeLessThanOrEqual(512 * 0.4);
  });
});
