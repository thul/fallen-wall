// The TV page: ties the sky, the overview and the announcements together
// and keeps them in step with the server.

import { fireCannons, playAnnouncement, setMusicVolume } from './announcement.js';
import { setCannonVolume, soundIsUnlocked, unlockSound } from './cannon.js';
import { isNight } from './logic.js';
import { highlightNext, restartOverview } from './overview.js';
import { startSky } from './sky.js';

const HIGHLIGHT_MS = 6000; // time each person stays highlighted in the overview
const NIGHT_CHECK_MS = 30_000;
const AUTOPLAY_CHECK_MS = 300; // gives the browser a moment to report whether sound is allowed
const SOUND_UNLOCK_GIVE_UP_MS = 15_000;
const RETRY_LOAD_MS = 5000;
const RELOAD_AFTER_RECONNECT_MS = 2000; // lets missed announcements arrive first, so they still play

const idleScreen = document.getElementById('idle');
const nightScreen = document.getElementById('night');
const statusLine = document.getElementById('status');
const soundUnlockOverlay = document.getElementById('soundUnlock');

/* ---------- State ---------- */

// Replaced by the server's values on load.
let settings = { volume: 1, nightOn: false, dayStart: '08:00', dayEnd: '18:00' };
let people = [];
let announcing = false; // an announcement is on screen
let waiting = []; // people waiting for their announcement
let reloadWhenIdle = false; // the page is out of date and reloads once nothing is playing

function showStatus(text) {
  statusLine.textContent = text;
  statusLine.hidden = false;
}

function hideStatus() {
  statusLine.hidden = true;
}

/* ---------- Night mode ---------- */

// Black screen outside the day hours. An announcement still wakes the screen and plays.
// shortcut: the TV backlight stays on (black picture only); switch the HDMI output off from the Pi for real power saving.
function updateNightScreen() {
  const dark = isNight(settings, new Date()) && !announcing;
  nightScreen.classList.toggle('on', dark);
}

function nightScreenIsOn() {
  return nightScreen.classList.contains('on');
}

/* ---------- Sound unlock: browsers block sound until a key press ---------- */

function setUpSoundUnlock() {
  function unlock() {
    unlockSound();
    soundUnlockOverlay.hidden = true;
    hideStatus();
  }
  window.addEventListener('keydown', unlock);
  window.addEventListener('click', unlock);

  // Started with the kiosk autoplay flag, sound is already allowed and the overlay can go at once.
  setTimeout(() => {
    if (soundIsUnlocked()) soundUnlockOverlay.hidden = true;
  }, AUTOPLAY_CHECK_MS);

  // The Pi has no keyboard: never let the overlay hide the wall for good.
  // The pictures still show; the sound stays off.
  setTimeout(() => {
    if (soundIsUnlocked()) return;
    soundUnlockOverlay.hidden = true;
    showStatus('sound off: press any key');
  }, SOUND_UNLOCK_GIVE_UP_MS);
}

// Sound check: press C to fire the cannons without adding anyone.
function setUpSoundCheckKey() {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'c' || announcing) return;
    // If this is the very first key press, sound is still unlocking: wait for it, or the shots stay silent.
    unlockSound().then(fireCannons);
  });
}

/* ---------- Announcements, one at a time ---------- */

function announce(person) {
  if (announcing) {
    waiting.push(person);
    return;
  }
  announcing = true;
  updateNightScreen(); // wakes the screen if night mode had it black
  idleScreen.style.opacity = 0;
  playAnnouncement(person, afterAnnouncement);
}

function afterAnnouncement() {
  idleScreen.style.opacity = 1;
  announcing = false;
  updateNightScreen();

  if (waiting.length > 0) {
    announce(waiting.shift());
  } else if (reloadWhenIdle) {
    location.reload();
  } else {
    restartOverview(people);
  }
}

/* ---------- Data from the server ---------- */

function applySettings(newSettings) {
  settings = newSettings;
  setCannonVolume(settings.volume);
  setMusicVolume(settings.volume);
  updateNightScreen();
}

function onPersonAdded(person) {
  // A test fire replays someone who is already on the wall.
  const alreadyKnown = people.some((other) => other.id === person.id);
  if (!alreadyKnown) people.push(person);
  announce(person);
}

function onPersonRemoved(id) {
  const isSomeoneElse = (person) => person.id !== id;
  people = people.filter(isSomeoneElse);
  waiting = waiting.filter(isSomeoneElse);
  if (!announcing) restartOverview(people);
}

// The server may have restarted with a new version of this page, and the list may have changed.
// A reload gets both. The TV has no keyboard, so the page has to do this by itself.
function reloadOnceIdle() {
  if (announcing) {
    reloadWhenIdle = true;
  } else {
    location.reload();
  }
}

/** Live updates. The browser reconnects by itself after a drop and is sent what it missed. */
function listenForUpdates(lastEventId) {
  const updates = new EventSource(`/events?since=${lastEventId}`);
  let wasDisconnected = false;

  updates.onerror = () => {
    wasDisconnected = true;
    showStatus('reconnecting…');
  };
  updates.onopen = () => {
    hideStatus();
    if (wasDisconnected) setTimeout(reloadOnceIdle, RELOAD_AFTER_RECONNECT_MS);
  };

  updates.addEventListener('fallen', (event) => onPersonAdded(JSON.parse(event.data)));
  updates.addEventListener('removed', (event) => onPersonRemoved(JSON.parse(event.data).id));
  updates.addEventListener('settings', (event) => applySettings(JSON.parse(event.data)));
}

/** First load. It is silent: no cannons for people who are already on the wall. */
async function loadWall() {
  let wall;
  try {
    const response = await fetch('/api/people');
    if (!response.ok) throw new Error(`The server answered ${response.status}`);
    wall = await response.json();
  } catch {
    // Server not up yet: try again. Nobody can press reload on the TV.
    setTimeout(() => location.reload(), RETRY_LOAD_MS);
    return;
  }

  people = wall.people;
  applySettings(wall.settings);
  restartOverview(people);
  listenForUpdates(wall.lastEventId);
}

/* ---------- Start ---------- */

startSky(document.getElementById('sky'), {
  isHidden: nightScreenIsOn,
  mayShoot: () => !announcing,
});
setUpSoundUnlock();
setUpSoundCheckKey();
setInterval(updateNightScreen, NIGHT_CHECK_MS);
setInterval(() => {
  if (!announcing) highlightNext();
}, HIGHLIGHT_MS);
loadWall();
