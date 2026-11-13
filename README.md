# Fallen Wall

A wall for the office TV that remembers colleagues who have left the company. When someone is added, the TV fires two cannon shots, shows their portrait with the months they started and left, and plays a piece of music. The rest of the time it shows everyone on a night sky.

The idea comes from the fallen-tribute scenes in The Hunger Games.

## What you see on the TV

When nobody is being announced, the TV shows an overview of everyone, newest first, 20 people to a page. One person is highlighted at a time, for 6 seconds each, and the page turns when the highlight reaches the next one.

After the highlight has visited everyone, and the wall has been up for at least 3 minutes, everything fades out and only the stars stay for 25 seconds. Then the faces come back one at a time. This pause is there so a static picture does not burn into the screen.

Adding a person starts an announcement. Two cannon shots sound 1.9 seconds apart, each with a flash. Three seconds in, the portrait fades up and `The-fallen.mp3` starts. The portrait stays until the music ends. If the music file is missing or the browser blocks it, the portrait stays for 15 seconds. People added in quick succession are announced one after another.

The cannon is generated in the browser with the Web Audio API, so there is no sound file for it.

## Requirements

You need Node.js 18 or newer. There are no dependencies to install.

The TV page needs a browser from 2018 or later. Chromium on a Raspberry Pi is the intended target.

## Running it

```bash
node server.js
```

The server prints the address for the TV, the address for the admin page, and the admin code:

```
Fallen Wall running.
  TV:    http://192.168.1.50:8080/
  Admin: http://192.168.1.50:8080/admin
  Admin code: 1a2b3c4d5e6f
```

Open the TV address on the TV and the admin address on a phone or laptop on the same network.

Two environment variables change the defaults. `PORT` sets the port (8080 if unset) and `DATA_DIR` sets where people and photos are stored (`data/` in the project folder if unset).

## The admin page

The page asks for the admin code once and remembers it in that browser. The code is generated on the first start and kept in `data/admin-token.txt`. Set `ADMIN_TOKEN` to choose your own.

To add someone, fill in their name, start date, leave date and a photo. The TV shows only the month and year. The photo is shrunk and converted to JPEG in the browser before upload. Tick "Crop photo" to drag and zoom the photo inside a box with the same shape as the faces on the TV.

The list below the form has a delete button for each person. "Test fire on TV" replays the announcement for the newest person, which is the quickest way to check picture and sound on the real screen.

Under "TV settings" there is a volume slider for cannons and music together, and night mode. Night mode turns the screen black outside the hours you set. It uses the clock of the device that shows the TV page, and it only blacks out the picture, so the TV itself stays on. An announcement still plays at night.

## Sound in the browser

Browsers refuse to play sound until someone presses a key or clicks. The TV page shows "PRESS OK TO BEGIN" for that. After 15 seconds without a key press it hides the message and carries on silently, so a TV without a keyboard still shows the wall.

To skip the key press, start Chromium with `--autoplay-policy=no-user-gesture-required`. The Pi kiosk script does this.

Press `C` on the TV page to fire the cannons without adding anyone.

## Raspberry Pi setup

These scripts are written for Raspberry Pi OS with the desktop, on a Pi connected to the TV over HDMI. They have not been run on a real Pi yet, so expect to adjust them.

```bash
git clone git@github.com:thul/fallen-wall.git ~/fallen-wall
bash ~/fallen-wall/pi/install.sh
sudo reboot
```

`pi/install.sh` installs Node.js if it is missing and sets up the server as a systemd service called `fallen-wall`, which starts at boot and restarts after a crash. It also adds a desktop autostart entry that runs `pi/kiosk.sh` and turns off screen blanking. `pi/kiosk.sh` waits for the server, then opens the TV page in fullscreen Chromium with sound allowed.

After pulling a new version:

```bash
sudo systemctl restart fallen-wall
```

The TV page reloads itself when it gets its connection back, so nobody has to press reload on the Pi.

If there is no sound, check that the Pi's audio output is set to HDMI.

## Your data

Everything the wall knows is in the data folder:

- `people.json` holds names and dates, with `people.json.bak` as the previous version
- `photos/` holds one JPEG per person
- `settings.json` holds volume and night mode
- `admin-token.txt` holds the admin code

Back this folder up. It is not part of the repository.

## Changing the music

The announcement plays `The-fallen.mp3` from the project root. Replace that file to use other music and keep the name. The portrait stays on screen for as long as the file plays.

## Security

The wall is meant for an office network. Anyone on that network can open the TV page and see the names and photos. Adding, deleting and changing settings need the admin code. The connection is plain HTTP, so the code is not protected from someone who can listen in on the network.

## Tests

```bash
node test.js
```

The test starts the server on a spare port with temporary data folders and checks the API, the stored files and the TV page's date and night-mode logic. It prints two error traces on purpose, one for a forced failed save and one for a damaged data file. The run is good when the last line reads `All tests passed`.

## Project layout

- `server.js` is the whole server: pages, storage, admin API and live updates to the TV
- `public/tv.html` and `public/tv.css` are the TV page
- `public/tv/` holds its scripts: `main.js`, `overview.js`, `announcement.js`, `cannon.js`, `sky.js`, `person-card.js` and `logic.js`
- `public/admin.html` and `public/admin.css` are the admin page
- `public/admin/` holds its scripts: `main.js`, `photo.js` and `api.js`
- `pi/` holds the Raspberry Pi setup scripts
- `test.js` is the self-test

The server reads the files in `public/` on every request, so a change to a page only needs a browser reload. A change to `server.js` needs a server restart.
