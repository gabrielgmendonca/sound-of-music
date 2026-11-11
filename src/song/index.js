// The stage list. Each stage is one song (its own file) plus the mood the
// meadow wears while it plays. Stage names live in src/i18n.js.

import { strings } from '../i18n.js';
import * as doremi from './doremi.js';
import * as edelweiss from './edelweiss.js';
import * as favorite from './favorite.js';

export const SONGS = [
  { id: 'doremi', mood: 'day', color: '#5fb760', build: doremi.build },
  { id: 'edelweiss', mood: 'sunset', color: '#f28c38', build: edelweiss.build },
  { id: 'favorite', mood: 'night', color: '#5b6fd6', build: favorite.build },
];

export function buildChart(id = SONGS[0].id, text = strings()) {
  const song = SONGS.find((s) => s.id === id) || SONGS[0];
  return song.build(text);
}
