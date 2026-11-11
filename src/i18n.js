// Interface text. Portuguese (Brazil) is the default; add `?lang=en` to the
// URL for English. The personal gift text lives in config.js, not here.

const STRINGS = {
  'pt-BR': {
    solfege: ['Dó', 'Ré', 'Mi', 'Fá', 'Sol', 'Lá', 'Si'],
    sharp: '♯',
    start: 'Toque para começar',
    hint: 'Toque em qualquer lugar da tela no ritmo da música',
    combo: 'combo',
    perfect: 'Perfeito!',
    good: 'Boa!',
    miss: 'Ops!',
    statPerfect: 'Perfeitas',
    statGood: 'Boas',
    statMiss: 'Perdidas',
    statCombo: 'Maior combo',
    replay: 'Jogar de novo',
    ranks: { superb: 'Maravilhoso!', ok: 'Que lindo!', try: 'Bis!' },
    rounds: { listen: 'Rodada 1 · Escute', sing: 'Rodada 2 · Cante', echo: 'Rodada 3 · Eco', finale: 'Grande final' },
    prompts: {
      howTo: 'Toque na tela quando a bolinha chegar ao anel',
      listen: 'Ela canta — você toca nas bolinhas!',
      sing: 'Agora é com você — toque em cada nota!',
      echo: 'Hora do eco — primeiro escute…',
      yourTurn: 'Sua vez!',
      listenShort: 'Escute…',
      finale: 'Todos juntos — subindo a escala!',
    },
  },
  en: {
    solfege: ['Do', 'Re', 'Mi', 'Fa', 'So', 'La', 'Ti'],
    sharp: '♯',
    start: 'Tap to begin',
    hint: 'Tap anywhere in time with the music',
    combo: 'combo',
    perfect: 'Perfect!',
    good: 'Good',
    miss: 'Oops',
    statPerfect: 'Perfect',
    statGood: 'Good',
    statMiss: 'Missed',
    statCombo: 'Best combo',
    replay: 'Play again',
    ranks: { superb: 'Superb!', ok: 'Lovely!', try: 'Encore!' },
    rounds: { listen: 'Round 1 · Listen', sing: 'Round 2 · Sing', echo: 'Round 3 · Echo', finale: 'Finale' },
    prompts: {
      howTo: 'Tap anywhere when a bubble reaches the ring',
      listen: 'She sings — you tap the bubbles!',
      sing: 'Now you sing — tap every note!',
      echo: 'Echo time — listen first…',
      yourTurn: 'Your turn!',
      listenShort: 'Listen…',
      finale: 'All together — up the scale!',
    },
  },
};

export const DEFAULT_LOCALE = 'pt-BR';

export function pickLocale() {
  let q = null;
  try { q = new URLSearchParams(globalThis.location?.search || '').get('lang'); } catch { /* no URL */ }
  if (q && q.toLowerCase().startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

export function strings(locale = pickLocale()) {
  return STRINGS[locale] || STRINGS[DEFAULT_LOCALE];
}
