// One person as shown on the wall: portrait, name and dates.
// Used by the overview (small) and the announcement (large); tv.css sizes it.

import { formatMonth } from './logic.js';

function element(tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

export function personCard(person) {
  const photo = document.createElement('img');
  photo.src = `/photos/${person.id}.jpg`;
  photo.alt = '';
  const face = element('div', 'face');
  face.append(photo);

  // textContent, never innerHTML: a name is text typed by a person.
  const name = element('div', 'name');
  name.textContent = person.name;

  const dates = element('div', 'dates');
  dates.textContent = `${formatMonth(person.started)}  —  ${formatMonth(person.left)}`;

  const card = element('div', 'card');
  card.append(face, name, dates);
  return card;
}
