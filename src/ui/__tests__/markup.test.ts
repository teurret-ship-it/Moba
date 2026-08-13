import { describe, expect, it } from 'vitest';
import html from '../../../index.html?raw';

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
