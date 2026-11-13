// The announcement for one person: two cannon shots, then their portrait while the music plays.

import { playCannonShots, SECOND_SHOT_SECONDS } from './cannon.js';
import { personCard } from './person-card.js';

const PORTRAIT_DELAY_MS = 3000; // the portrait appears after both cannon shots
const PORTRAIT_FADE_MS = 3500; // a little longer than the opacity transition on #announce in tv.css
const NO_MUSIC_PORTRAIT_MS = 15_000; // how long the portrait stays when the music is missing or blocked
const AFTER_MUSIC_GRACE_MS = 3000; // backstop in case the browser never reports the end of the music
const UNKNOWN_LENGTH_BACKSTOP_MS = 600_000;

const stage = document.getElementById('announce');
const flash = document.getElementById('flash');
const music = new Audio('/The-fallen.mp3');
music.preload = 'auto';

/** @param {number} volume 0 to 1 */
export function setMusicVolume(volume) {
  music.volume = volume;
}

/** Restarts a CSS animation: remove the class, force a layout, add the class again. */
function replayAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function flashAndShake() {
  replayAnimation(flash, 'go');
  replayAnimation(document.body, 'shake');
}

/** Two cannon shots: the sound, and a flash and shake of the screen with each. */
export function fireCannons() {
  playCannonShots();
  flashAndShake();
  setTimeout(flashAndShake, SECOND_SHOT_SECONDS * 1000);
}

/** Shows the portrait and plays the music. Calls onDone once the portrait has faded out again. */
function showPortrait(person, onDone) {
  stage.replaceChildren(personCard(person));
  void stage.offsetWidth; // force a layout so the fade-in transition runs
  stage.classList.add('show');

  let finished = false;
  let endTimer;

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(endTimer);
    music.onended = null;
    music.pause();
    stage.classList.remove('show'); // fades out
    setTimeout(onDone, PORTRAIT_FADE_MS);
  }

  // Without music the portrait stays for a fixed time.
  endTimer = setTimeout(finish, NO_MUSIC_PORTRAIT_MS);

  music.onended = finish;
  music.currentTime = 0;
  music.play().then(
    () => {
      // The music plays: the portrait stays until it ends. The timer is only a backstop.
      clearTimeout(endTimer);
      const backstop = Number.isFinite(music.duration)
        ? music.duration * 1000 + AFTER_MUSIC_GRACE_MS
        : UNKNOWN_LENGTH_BACKSTOP_MS;
      endTimer = setTimeout(finish, backstop);
    },
    () => {
      // Blocked or missing: the fixed-time timer above ends the portrait.
    }
  );
}

/**
 * Plays the whole announcement for one person.
 * @param {object} person
 * @param {() => void} onDone called when the screen is free again
 */
export function playAnnouncement(person, onDone) {
  fireCannons();
  setTimeout(() => showPortrait(person, onDone), PORTRAIT_DELAY_MS);
}
