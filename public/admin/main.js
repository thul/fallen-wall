// The admin page: unlock with the admin code, add and delete people, change the TV settings.

import { hasSavedCode, rememberCode, request, useCode } from './api.js';
import { clearPhoto, hasPhoto, photoAsJpeg, setUpPhotoField } from './photo.js';

const loginBox = document.getElementById('loginBox');
const codeInput = document.getElementById('code');
const loginMessage = document.getElementById('loginMsg');
const app = document.getElementById('app');

const form = document.getElementById('form');
const nameInput = document.getElementById('name');
const startedInput = document.getElementById('started');
const leftInput = document.getElementById('left');
const addButton = form.querySelector('button[type="submit"]');
const formMessage = document.getElementById('msg');
const list = document.getElementById('list');

const volumeSlider = document.getElementById('vol');
const volumeLabel = document.getElementById('volLabel');
const nightCheckbox = document.getElementById('nightOn');
const dayStartInput = document.getElementById('dayStart');
const dayEndInput = document.getElementById('dayEnd');
const settingsMessage = document.getElementById('setMsg');

function showMessage(element, text, { isError = false } = {}) {
  element.classList.toggle('err', isError);
  element.textContent = text;
}

/* ---------- Unlock with the admin code ---------- */

async function unlock({ complainIfWrong }) {
  try {
    await request('POST', '/api/login');
  } catch (error) {
    // A remembered code that no longer works just shows the box again, without a complaint.
    // The error says whether the code was wrong or the server could not be reached.
    if (complainIfWrong) loginMessage.textContent = error.message;
    return;
  }
  rememberCode();
  loginBox.hidden = true;
  app.hidden = false;
  await loadWall();
}

/* ---------- The list of people ---------- */

async function deletePerson(person) {
  const confirmed = confirm(`Remove ${person.name} from the wall? This deletes their photo too.`);
  if (!confirmed) return;
  try {
    await request('DELETE', `/api/people/${person.id}`);
  } catch (error) {
    alert(error.message);
    return;
  }
  await loadWall();
}

function listItem(person) {
  const photo = document.createElement('img');
  photo.src = `/photos/${person.id}.jpg`;
  photo.alt = '';

  // textContent, never innerHTML: a name is text typed by a person.
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = person.name;
  const dates = document.createElement('small');
  dates.textContent = `${person.started} to ${person.left}`;
  who.append(dates);

  const deleteButton = document.createElement('button');
  deleteButton.className = 'del';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', () => deletePerson(person));

  const item = document.createElement('li');
  item.append(photo, who, deleteButton);
  return item;
}

function showPeople(people) {
  if (people.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No one yet.';
    list.replaceChildren(empty);
    return;
  }
  const newestFirst = [...people].reverse();
  list.replaceChildren(...newestFirst.map(listItem));
}

function showListProblem() {
  const problem = document.createElement('li');
  problem.className = 'err';
  problem.textContent = 'Could not load the list. Reload the page to see it.';
  list.replaceChildren(problem);
}

/**
 * Fetches people and settings and fills the page with them.
 * It never throws: it runs after an add or delete that already succeeded,
 * and a failure here must not look like that change failed.
 */
async function loadWall() {
  let wall;
  try {
    const response = await fetch('/api/people');
    wall = await response.json();
  } catch {
    showListProblem();
    return;
  }
  showSettings(wall.settings);
  showPeople(wall.people);
}

/* ---------- Add a person ---------- */

async function addPerson(event) {
  event.preventDefault();
  if (!hasPhoto()) {
    showMessage(formMessage, 'Pick a photo first.', { isError: true });
    return;
  }
  // 'YYYY-MM-DD' dates sort correctly as plain text.
  if (leftInput.value < startedInput.value) {
    showMessage(formMessage, 'Leave date is before start date.', { isError: true });
    return;
  }

  showMessage(formMessage, 'Adding…');
  // A second tap while the upload runs would add the person twice and fire the cannons twice.
  addButton.disabled = true;
  let added;
  try {
    added = await request('POST', '/api/people', {
      name: nameInput.value,
      started: startedInput.value,
      left: leftInput.value,
      photo: photoAsJpeg(),
    });
  } catch (error) {
    showMessage(formMessage, error.message, { isError: true });
    return;
  } finally {
    addButton.disabled = false;
  }

  showMessage(formMessage, `${added.name} added. Watch the TV.`);
  form.reset();
  clearPhoto();
  await loadWall();
}

/* ---------- TV settings: volume and night mode ---------- */

function showVolumeLabel() {
  volumeLabel.textContent = `${volumeSlider.value}%`;
}

function showSettings(settings) {
  volumeSlider.value = Math.round(settings.volume * 100);
  showVolumeLabel();
  nightCheckbox.checked = settings.nightOn;
  dayStartInput.value = settings.dayStart;
  dayEndInput.value = settings.dayEnd;
}

async function saveSettings() {
  try {
    await request('POST', '/api/settings', {
      volume: volumeSlider.value / 100,
      nightOn: nightCheckbox.checked,
      dayStart: dayStartInput.value,
      dayEnd: dayEndInput.value,
    });
    showMessage(settingsMessage, 'Saved. The TV updates right away.');
  } catch (error) {
    showMessage(settingsMessage, error.message, { isError: true });
  }
}

async function testFire() {
  try {
    await request('POST', '/api/test-fire');
  } catch (error) {
    alert(error.message);
  }
}

/* ---------- Start ---------- */

document.getElementById('loginBtn').addEventListener('click', () => {
  useCode(codeInput.value.trim());
  unlock({ complainIfWrong: true });
});

setUpPhotoField({
  onUnreadable: () => showMessage(formMessage, 'Could not read that image.', { isError: true }),
});
form.addEventListener('submit', addPerson);
document.getElementById('testBtn').addEventListener('click', testFire);

volumeSlider.addEventListener('input', showVolumeLabel);
// Every change saves at once; there is no save button.
for (const control of [volumeSlider, nightCheckbox, dayStartInput, dayEndInput]) {
  control.addEventListener('change', saveSettings);
}

if (hasSavedCode()) unlock({ complainIfWrong: false });
