// Self-test: node test.js  (uses temp data folders, does not touch real data)
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fallen-'));
process.env.DATA_DIR = DATA_DIR;
process.env.ADMIN_TOKEN = 'testtoken';
const { server } = require('./server');

// Smallest valid JPEG header bytes are enough for the server's magic-number check.
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const GOOD_PERSON = { name: 'Ada Lovelace', started: '2019-03-12', left: '2026-11-13', photo: JPEG };
const GOOD_SETTINGS = { volume: 0.4, nightOn: true, dayStart: '08:00', dayEnd: '18:00' };

/* ---------- Pure TV logic ---------- */

async function testTvLogic() {
  // The page scripts are ES modules (see public/package.json), so they are loaded with import().
  const logic = await import('./public/tv/logic.js');

  assert.strictEqual(logic.formatMonth('2019-03-12'), 'MAR 2019');

  const at = (hours, minutes) => new Date(2026, 0, 15, hours, minutes);
  const officeHours = { nightOn: true, dayStart: '08:00', dayEnd: '18:00' };
  assert.strictEqual(logic.isNight({ ...officeHours, nightOn: false }, at(3, 0)), false, 'night mode off');
  assert.strictEqual(logic.isNight(officeHours, at(12, 0)), false, 'midday is day');
  assert.strictEqual(logic.isNight(officeHours, at(7, 59)), true, 'before opening');
  assert.strictEqual(logic.isNight(officeHours, at(18, 0)), true, 'closing time is night');

  const lateShift = { nightOn: true, dayStart: '20:00', dayEnd: '02:00' }; // day runs past midnight
  assert.strictEqual(logic.isNight(lateShift, at(23, 0)), false, 'before midnight is day');
  assert.strictEqual(logic.isNight(lateShift, at(1, 0)), false, 'after midnight is day');
  assert.strictEqual(logic.isNight(lateShift, at(12, 0)), true, 'midday is night');

  // 20 cards must fit in the area: columns across, rows down.
  const width = logic.cardWidth(20, 1000, 500, 1.2);
  const columns = Math.floor(1000 / width);
  const rows = Math.ceil(20 / columns);
  assert.ok(width > 0 && rows * width * 1.2 <= 500, '20 cards fit');
  assert.strictEqual(logic.cardWidth(1, 1000, 1000, 1.2), 240, 'a single card is capped');
}

/* ---------- Server start-up, in a separate process so each case gets a fresh server ---------- */

function freshDataDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallen-start-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

// Loads server.js with the given data folder and returns what the script prints.
function startServerAndRun(dataDir, script) {
  const env = { ...process.env, DATA_DIR: dataDir };
  delete env.ADMIN_TOKEN;
  return execFileSync(process.execPath, ['-e', script], { cwd: __dirname, env, encoding: 'utf8' });
}

function testStartUp() {
  // An empty code file must not become an empty admin code.
  const emptyTokenDir = freshDataDir({ 'admin-token.txt': '' });
  startServerAndRun(emptyTokenDir, "require('./server')");
  const token = fs.readFileSync(path.join(emptyTokenDir, 'admin-token.txt'), 'utf8');
  assert.ok(token.length >= 12, 'empty admin code file gets a new code');
  fs.rmSync(emptyTokenDir, { recursive: true, force: true });

  // A damaged people file falls back to the backup copy.
  const damagedDir = freshDataDir({
    'people.json': '',
    'people.json.bak': JSON.stringify([{ id: 'a'.repeat(16), name: 'From Backup', started: '2020-01-01', left: '2021-01-01' }]),
  });
  const printPeople = `
    const { server } = require('./server');
    server.listen(0, async () => {
      const wall = await (await fetch('http://127.0.0.1:' + server.address().port + '/api/people')).json();
      console.log(wall.people.map(person => person.name).join(','));
      server.close();
    });`;
  assert.strictEqual(startServerAndRun(damagedDir, printPeople).trim(), 'From Backup', 'backup is used');
  fs.rmSync(damagedDir, { recursive: true, force: true });
}

/* ---------- Running server ---------- */

// Opens the live-update stream and resolves with the first event, or null when none comes.
function firstEvent(base, lastEventId) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + '/events', { headers: { 'Last-Event-ID': String(lastEventId) } }, res => {
      let text = '';
      res.on('data', chunk => {
        text += chunk;
        const match = /event: (\w+)\ndata: (.*)\n\n/.exec(text);
        if (!match) return;
        req.destroy();
        resolve({ type: match[1], data: JSON.parse(match[2]) });
      });
    });
    req.on('error', e => {
      if (e.code !== 'ECONNRESET') reject(e);
    });
    setTimeout(() => {
      req.destroy();
      resolve(null);
    }, 500);
  });
}

async function testServer(base) {
  const send = (method, url, body, token = 'testtoken') => fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const addPerson = (person, token) => send('POST', '/api/people', person, token);
  const saveSettings = (settings, token) => send('POST', '/api/settings', settings, token);
  const getWall = async () => (await fetch(base + '/api/people')).json();

  // Bad input is refused.
  assert.strictEqual((await addPerson(GOOD_PERSON, 'wrong')).status, 401, 'needs the admin code');
  assert.strictEqual((await addPerson(GOOD_PERSON, '')).status, 401, 'an empty code is not accepted');
  assert.strictEqual((await addPerson({ ...GOOD_PERSON, left: '2018-01-01' })).status, 400, 'left before start');
  assert.strictEqual((await addPerson({ ...GOOD_PERSON, left: '2026-13-45' })).status, 400, 'impossible date');
  assert.strictEqual((await addPerson({ ...GOOD_PERSON, photo: 'data:image/png;base64,AAAA' })).status, 400, 'jpeg only');
  assert.strictEqual((await addPerson({ ...GOOD_PERSON, name: ' ' })).status, 400, 'name required');

  // A failed save changes nothing: not the list, not the photo folder.
  const blocker = path.join(DATA_DIR, 'people.json.tmp');
  fs.mkdirSync(blocker); // a folder in the way makes the write fail
  assert.strictEqual((await addPerson(GOOD_PERSON)).status, 500, 'failed save is reported');
  fs.rmdirSync(blocker);
  assert.strictEqual((await getWall()).people.length, 0, 'failed save leaves the list alone');
  assert.strictEqual(fs.readdirSync(path.join(DATA_DIR, 'photos')).length, 0, 'failed save leaves no photo behind');

  // Adding a person saves them and tells the TV.
  const before = await getWall();
  const listening = firstEvent(base, before.lastEventId);
  await new Promise(resolve => setTimeout(resolve, 100));
  const added = await addPerson(GOOD_PERSON);
  assert.strictEqual(added.status, 201);
  const person = await added.json();

  const event = await listening;
  assert.ok(event && event.type === 'fallen' && event.data.id === person.id, 'the TV is told about the new person');
  assert.strictEqual((await getWall()).people.length, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'people.json'), 'utf8')).length, 1, 'saved to disk');
  assert.strictEqual((await fetch(base + '/photos/' + person.id + '.jpg')).status, 200);
  assert.strictEqual((await fetch(base + '/photos/..%2Fpeople.json')).status, 404, 'no path traversal');

  // Settings.
  assert.strictEqual((await saveSettings(GOOD_SETTINGS, 'wrong')).status, 401, 'settings need the admin code');
  assert.strictEqual((await saveSettings({ ...GOOD_SETTINGS, volume: 3 })).status, 400, 'volume range');
  assert.strictEqual((await saveSettings({ ...GOOD_SETTINGS, dayEnd: '25:00' })).status, 400, 'time format');
  assert.strictEqual((await saveSettings({ ...GOOD_SETTINGS, dayEnd: '08:00' })).status, 400, 'equal times');
  assert.strictEqual((await saveSettings(GOOD_SETTINGS)).status, 200);
  assert.deepStrictEqual((await getWall()).settings, GOOD_SETTINGS, 'settings returned');
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'settings.json')), 'settings saved to disk');

  // Pages, styles and scripts come from public/; nothing else does.
  const status = async url => (await fetch(base + url)).status;
  assert.strictEqual(await status('/'), 200, 'TV page served');
  assert.strictEqual(await status('/admin'), 200, 'admin page served');
  assert.strictEqual(await status('/tv.css'), 200, 'styles served');
  assert.strictEqual(await status('/tv/main.js'), 200, 'scripts served');
  assert.strictEqual(await status('/package.json'), 404, 'other file types are refused');
  assert.strictEqual(await status('/..%2Fserver.js'), 404, 'nothing outside public/');
  assert.strictEqual(await status('/missing.js'), 404, 'missing files are a 404');

  // Music for the announcement.
  const music = await fetch(base + '/The-fallen.mp3');
  if (fs.existsSync(path.join(__dirname, 'The-fallen.mp3'))) {
    assert.strictEqual(music.headers.get('content-type'), 'audio/mpeg', 'music served');
  } else {
    assert.strictEqual(music.status, 404);
  }

  // Reconnect with the latest id: nothing replayed, so no surprise cannons.
  const latest = (await getWall()).lastEventId;
  assert.strictEqual(await firstEvent(base, latest), null, 'no replay on reconnect');
  // Reconnect from before the add: the missed event is replayed.
  const missed = await firstEvent(base, before.lastEventId);
  assert.ok(missed && missed.data.id === person.id, 'missed event replayed');

  // Delete.
  assert.strictEqual((await send('DELETE', '/api/people/' + person.id)).status, 200);
  assert.strictEqual((await getWall()).people.length, 0);
  assert.strictEqual((await fetch(base + '/photos/' + person.id + '.jpg')).status, 404, 'photo deleted too');
}

server.listen(0, async () => {
  try {
    await testTvLogic();
    testStartUp();
    await testServer('http://127.0.0.1:' + server.address().port);
    console.log('All tests passed');
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
});
