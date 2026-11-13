// Fallen Wall: TV display of people who left the company. Zero dependencies.
// Run: node server.js   then open http://<this-pc>:8080 on the TV and /admin on a phone/laptop.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PEOPLE_FILE = path.join(DATA_DIR, 'people.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TOKEN_FILE = path.join(DATA_DIR, 'admin-token.txt');

const MAX_BODY = 8 * 1024 * 1024; // photos are downscaled in the browser, 8 MB is plenty
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[a-f0-9]{16}$/;
const JPEG_DATA_URL_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;

// The pages and their styles and scripts live in public/ and are served from there.
const PUBLIC_DIR = path.join(__dirname, 'public');
const PAGE_ADDRESSES = { '/': '/tv.html', '/admin': '/admin.html' };
const PUBLIC_FILE_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
const MUSIC_FILE = path.join(__dirname, 'The-fallen.mp3'); // music for the announcement; optional

fs.mkdirSync(PHOTO_DIR, { recursive: true });

/* ---------- Storage ---------- */

// Reads a JSON file. A damaged file falls back to its backup copy, so one bad write cannot stop the server.
function loadJson(file, valueWhenMissing) {
  for (const candidate of [file, file + '.bak']) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (e) {
      console.error(`Could not read ${candidate}: ${e.message}`);
    }
  }
  // Never start empty over damaged data: the next save would overwrite what is left of it.
  if (fs.existsSync(file)) throw new Error(`${file} is damaged and has no usable backup`);
  return valueWhenMissing;
}

// Writes a JSON file so that a crash or power cut leaves either the old or the new version, never half of one.
function writeJson(file, value) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd); // force the bytes onto the disk before the rename
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.renameSync(tmp, file);
}

// The admin code: from the environment, else from its file, else newly generated.
function loadToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  const saved = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';
  if (saved) return saved;
  // An empty file must not become an empty code: that would let everyone in.
  const fresh = crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(TOKEN_FILE, fresh);
  return fresh;
}

const TOKEN = loadToken();
let people = loadJson(PEOPLE_FILE, []);

// TV settings, changed from the admin page. nightOn: screen goes black outside dayStart..dayEnd (TV's local time).
let settings = Object.assign(
  { volume: 1, nightOn: false, dayStart: '08:00', dayEnd: '18:00' },
  loadJson(SETTINGS_FILE, {})
);

// Disk first, memory second: if the write fails, the wall keeps showing what is really saved.
function savePeople(list) {
  writeJson(PEOPLE_FILE, list);
  people = list;
}

function photoPath(id) {
  return path.join(PHOTO_DIR, id + '.jpg');
}

/* ---------- Live updates to the TV (server-sent events) ---------- */

// Every event gets an increasing id; a TV that reconnects is sent only what it missed.
const clients = new Set();
const recentEvents = []; // shortcut: in-memory replay buffer, lost on restart (the TV reloads itself then)
let lastEventId = 0;

function writeEvent(res, event) {
  res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function broadcast(type, data) {
  const event = { id: ++lastEventId, type, data };
  recentEvents.push(event);
  if (recentEvents.length > 100) recentEvents.shift();
  for (const res of clients) writeEvent(res, event);
}

function openEventStream(req, res, url) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const lastSeen = Number(req.headers['last-event-id'] || url.searchParams.get('since') || lastEventId);
  for (const event of recentEvents) {
    if (event.id > lastSeen) writeEvent(res, event);
  }
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// Keeps idle connections from being closed by the network.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000).unref();

/* ---------- HTTP helpers ---------- */

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function send(res, status, body, type = 'application/json') {
  const isRaw = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(isRaw ? body : JSON.stringify(body));
}

function sendFile(res, file, type) {
  if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), type);
}

// Sends a page, style or script from public/. Other file types and other folders are refused.
function sendPublicFile(res, pathname) {
  const file = path.join(PUBLIC_DIR, PAGE_ADDRESSES[pathname] || pathname);
  const type = PUBLIC_FILE_TYPES[path.extname(file)];
  const isInsidePublic = file.startsWith(PUBLIC_DIR + path.sep);
  if (!type || !isInsidePublic) return send(res, 404, 'not found', 'text/plain');
  sendFile(res, file, type);
}

function sendPhoto(res, pathname) {
  const id = pathname.slice('/photos/'.length).replace(/\.jpg$/, '');
  if (!ID_RE.test(id) || !fs.existsSync(photoPath(id))) return send(res, 404, 'not found', 'text/plain');
  // A photo never changes under its id, so the browser may keep it.
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000' });
  fs.createReadStream(photoPath(id)).pipe(res);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reject(httpError(400, 'bad json'));
      }
      if (!body || typeof body !== 'object') return reject(httpError(400, 'Body must be a JSON object'));
      resolve(body);
    });
    req.on('error', reject);
  });
}

/* ---------- Checks on what the admin page sends ---------- */

// Returns the cleaned-up person, or throws a 400 that says what is wrong.
function checkPerson(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) throw httpError(400, 'Name required (max 80 chars)');
  if (!DATE_RE.test(body.started || '') || !DATE_RE.test(body.left || '')) throw httpError(400, 'Dates must be YYYY-MM-DD');
  if (body.left < body.started) throw httpError(400, 'Leave date is before start date');

  const match = JPEG_DATA_URL_RE.exec(body.photo || '');
  if (!match) throw httpError(400, 'Photo must be a JPEG');
  const photo = Buffer.from(match[1], 'base64');
  const startsLikeJpeg = photo[0] === 0xff && photo[1] === 0xd8;
  if (!startsLikeJpeg) throw httpError(400, 'Photo is not a valid JPEG');

  return { name, started: body.started, left: body.left, photo };
}

function checkSettings(body) {
  const volumeOk = typeof body.volume === 'number' && body.volume >= 0 && body.volume <= 1;
  if (!volumeOk) throw httpError(400, 'Volume must be 0 to 1');
  if (typeof body.nightOn !== 'boolean') throw httpError(400, 'nightOn must be true or false');
  if (!TIME_RE.test(body.dayStart || '') || !TIME_RE.test(body.dayEnd || '')) throw httpError(400, 'Times must be HH:MM');
  // Equal times would mean "never on": the TV would stay black all day.
  if (body.dayStart === body.dayEnd) throw httpError(400, 'Screen-on and screen-off times must differ');
  return { volume: body.volume, nightOn: body.nightOn, dayStart: body.dayStart, dayEnd: body.dayEnd };
}

/* ---------- Admin actions ---------- */

async function addPerson(req, res) {
  const input = checkPerson(await readJsonBody(req));
  const id = crypto.randomBytes(8).toString('hex');
  const person = { id, name: input.name, started: input.started, left: input.left, added: new Date().toISOString() };

  fs.writeFileSync(photoPath(id), input.photo);
  try {
    savePeople(people.concat(person));
  } catch (e) {
    fs.rmSync(photoPath(id), { force: true }); // do not leave a photo nobody points to
    throw e;
  }
  broadcast('fallen', person);
  send(res, 201, person);
}

function deletePerson(res, id) {
  const remaining = people.filter(person => person.id !== id);
  if (remaining.length === people.length) throw httpError(404, 'Not found');
  savePeople(remaining);
  fs.rmSync(photoPath(id), { force: true });
  broadcast('removed', { id });
  send(res, 200, { ok: true });
}

async function saveSettings(req, res) {
  const next = checkSettings(await readJsonBody(req));
  writeJson(SETTINGS_FILE, next);
  settings = next;
  broadcast('settings', settings);
  send(res, 200, settings);
}

// Replays the announcement for the newest person, to check picture and sound on the real TV.
function testFire(res) {
  if (!people.length) throw httpError(400, 'Add someone first');
  broadcast('fallen', people[people.length - 1]);
  send(res, 200, { ok: true });
}

/* ---------- Routes ---------- */

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  const action = req.method + ' ' + pathname;

  // Reading is open to everyone on the network: it is what the TV shows anyway.
  if (req.method === 'GET') {
    if (action === 'GET /api/people') return send(res, 200, { people, settings, lastEventId });
    if (action === 'GET /events') return openEventStream(req, res, url);
    if (action === 'GET /The-fallen.mp3') return sendFile(res, MUSIC_FILE, 'audio/mpeg');
    if (pathname.startsWith('/photos/')) return sendPhoto(res, pathname);
    return sendPublicFile(res, pathname);
  }

  // Everything below changes the wall and needs the admin code.
  const deleteMatch = /^DELETE \/api\/people\/([a-f0-9]{16})$/.exec(action);
  const adminActions = ['POST /api/login', 'POST /api/people', 'POST /api/settings', 'POST /api/test-fire'];
  if (!deleteMatch && !adminActions.includes(action)) throw httpError(404, 'Not found');
  if (req.headers['x-admin-token'] !== TOKEN) throw httpError(401, 'Wrong admin code');

  if (deleteMatch) return deletePerson(res, deleteMatch[1]);
  if (action === 'POST /api/login') return send(res, 200, { ok: true });
  if (action === 'POST /api/people') return addPerson(req, res);
  if (action === 'POST /api/settings') return saveSettings(req, res);
  if (action === 'POST /api/test-fire') return testFire(res);
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.end();
    send(res, status, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter(net => net && net.family === 'IPv4' && !net.internal)
      .map(net => net.address);
    console.log('Fallen Wall running.');
    for (const address of addresses.length ? addresses : ['localhost']) {
      console.log(`  TV:    http://${address}:${PORT}/`);
      console.log(`  Admin: http://${address}:${PORT}/admin`);
    }
    console.log(`  Admin code: ${TOKEN}`);
  });
}

module.exports = { server };
