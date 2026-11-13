// The idle screen: everyone on the wall in pages, with one person highlighted at a time.
// Now and then the wall clears to the bare sky for a while, then the faces return one by one.
// That pause protects the screen from burn-in: no picture stays in one place all day.

import { cardWidth } from './logic.js';
import { personCard } from './person-card.js';

const PAGE_SIZE = 20;
const CARD_HEIGHT_PER_WIDTH = 1.2;
const PAGE_FADE_MS = 1500; // keep in step with the opacity transition on #grid in tv.css
const NOT_STARTED = -1;

const MIN_WALL_MS = 3 * 60 * 1000; // the wall stays up at least this long between sky pauses
const SKY_PAUSE_MS = 25_000; // how long the sky stays bare
const WALL_FADE_MS = 2000; // keep in step with the opacity transitions under #idle in tv.css
const ARRIVAL_GAP_MS = 180; // time between two faces appearing after a pause

const idleScreen = document.getElementById('idle');
const grid = document.getElementById('grid');
const countLine = document.getElementById('count');

let newestFirst = []; // the people on the wall, newest first
let highlighted = NOT_STARTED; // index into newestFirst
let shownPage = NOT_STARTED;
let skyPause = false; // true from the wall fading out until every face is back
let wallShownAt = Date.now(); // when the wall last appeared
// Goes up on every restart, so a timer that started before the restart can tell it is out of date.
let run = 0;

/** Runs the action after the delay, unless the overview restarted in the meantime. */
function later(delayMs, action) {
  const startedInRun = run;
  setTimeout(() => {
    if (startedInRun === run) action();
  }, delayMs);
}

function cardsOnPage() {
  return [...grid.querySelectorAll('.card')];
}

/** Sizes the cards so the current page fills the screen without overflowing. */
function layout() {
  const count = cardsOnPage().length;
  if (count === 0) return;
  const width = cardWidth(count, grid.clientWidth, grid.clientHeight, CARD_HEIGHT_PER_WIDTH);
  grid.style.setProperty('--cw', `${width}px`);
  grid.style.setProperty('--ch', `${width * CARD_HEIGHT_PER_WIDTH}px`);
}

function countText(pageIndex) {
  const total = newestFirst.length;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const fallen = total === 1 ? '1 HAS FALLEN' : `${total} HAVE FALLEN`;
  if (pageCount === 1) return fallen;
  return `${fallen}   ·   PAGE ${pageIndex + 1} / ${pageCount}`;
}

function showPage(pageIndex) {
  const first = pageIndex * PAGE_SIZE;
  const peopleOnPage = newestFirst.slice(first, first + PAGE_SIZE);

  shownPage = pageIndex;
  grid.replaceChildren(...peopleOnPage.map(personCard));
  layout();
  countLine.textContent = countText(pageIndex);
}

function lightHighlighted() {
  const indexOnPage = highlighted % PAGE_SIZE;
  cardsOnPage().forEach((card, index) => {
    card.classList.toggle('lit', index === indexOnPage);
  });
}

function showEmptyWall() {
  const message = document.createElement('div');
  message.className = 'empty';
  message.textContent = 'NO ONE HAS FALLEN. YET.';
  grid.replaceChildren(message);
  countLine.textContent = '';
}

/** Fades the grid over to another page and highlights the current person there. */
function turnToPage(pageIndex) {
  grid.classList.add('fading');
  later(PAGE_FADE_MS, () => {
    showPage(pageIndex);
    lightHighlighted();
    grid.classList.remove('fading');
  });
}

/* ---------- The sky pause ---------- */

/** A copy of the list in random order. */
function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const other = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[other]] = [copy[other], copy[i]];
  }
  return copy;
}

/** Brings the first page back with its faces appearing one by one, like stars coming out. */
function returnFromSkyPause() {
  highlighted = 0;
  showPage(0);
  const cards = cardsOnPage();
  for (const card of cards) {
    card.classList.add('arriving');
  }
  idleScreen.classList.remove('sky-pause'); // title and count fade back in

  shuffled(cards).forEach((card, order) => {
    later(order * ARRIVAL_GAP_MS, () => card.classList.remove('arriving'));
  });
  later(cards.length * ARRIVAL_GAP_MS, () => {
    lightHighlighted();
    skyPause = false;
    wallShownAt = Date.now();
  });
}

/** Fades the whole wall out and leaves only the sky for a while. */
function startSkyPause() {
  skyPause = true;
  idleScreen.classList.add('sky-pause');
  later(WALL_FADE_MS + SKY_PAUSE_MS, returnFromSkyPause);
}

function skyPauseIsDue() {
  const everyoneWasHighlighted = highlighted === newestFirst.length - 1;
  const wallWasUpLongEnough = Date.now() - wallShownAt >= MIN_WALL_MS;
  return everyoneWasHighlighted && wallWasUpLongEnough;
}

/* ---------- What the rest of the page uses ---------- */

/**
 * Steps to the next person. When they are on another page, fades the grid over to that page.
 * After the last person, the wall may take a sky pause first.
 */
export function highlightNext() {
  if (newestFirst.length === 0 || skyPause) return;

  if (skyPauseIsDue()) {
    startSkyPause();
    return;
  }

  highlighted = (highlighted + 1) % newestFirst.length;
  const pageIndex = Math.floor(highlighted / PAGE_SIZE);

  if (pageIndex === shownPage) {
    lightHighlighted();
  } else if (shownPage === NOT_STARTED) {
    // The first page after a restart appears at once.
    showPage(pageIndex);
    lightHighlighted();
  } else {
    turnToPage(pageIndex);
  }
}

/**
 * Shows the overview from its start: the first page, with the newest person highlighted.
 * Call after the list changes or an announcement ends.
 * @param {Array<object>} people oldest first, as the server keeps them
 */
export function restartOverview(people) {
  run++;
  newestFirst = [...people].reverse();
  highlighted = NOT_STARTED;
  shownPage = NOT_STARTED;
  skyPause = false;
  wallShownAt = Date.now();
  idleScreen.classList.remove('sky-pause');
  grid.classList.remove('fading');

  if (newestFirst.length === 0) {
    showEmptyWall();
    return;
  }
  highlightNext();
}

window.addEventListener('resize', layout);
