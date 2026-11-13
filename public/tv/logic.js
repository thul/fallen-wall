// Pure helpers for the TV page: no page elements, no timers, no network.
// That keeps them testable from test.js.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * '2019-03-12' -> 'MAR 2019'.
 * The date is split as text; new Date() would shift the day by timezone.
 */
export function formatMonth(date) {
  const [year, month] = date.split('-');
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** '08:30' -> 510 (minutes since midnight). */
function minutesOfDay(time) {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * True when night mode should black out the screen.
 * @param {{nightOn: boolean, dayStart: string, dayEnd: string}} settings times as 'HH:MM'
 * @param {Date} now in the TV's local time
 */
export function isNight(settings, now) {
  if (!settings.nightOn) return false;

  const minute = now.getHours() * 60 + now.getMinutes();
  const dayStart = minutesOfDay(settings.dayStart);
  const dayEnd = minutesOfDay(settings.dayEnd);

  // The "day" may run past midnight, for example 20:00 until 02:00.
  const dayPassesMidnight = dayStart > dayEnd;
  const isDay = dayPassesMidnight
    ? minute >= dayStart || minute < dayEnd
    : minute >= dayStart && minute < dayEnd;
  return !isDay;
}

// A short list should not fill the wall with giant faces.
const WIDEST_CARD_SHARE = 0.24;

/**
 * The widest card, in px, that lets `count` cards fit in an area of width x height.
 * @param {number} heightPerWidth card height divided by card width
 */
export function cardWidth(count, width, height, heightPerWidth) {
  let best = 0;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const fits = Math.min(width / columns, height / rows / heightPerWidth);
    best = Math.max(best, fits);
  }
  return Math.floor(Math.min(best, width * WIDEST_CARD_SHARE));
}
