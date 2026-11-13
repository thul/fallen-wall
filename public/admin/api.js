// Requests to the server, signed with the admin code.

const STORAGE_KEY = 'fallenToken';

function savedCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return ''; // private mode: the code is asked for on every visit
  }
}

let adminCode = savedCode();

export function hasSavedCode() {
  return adminCode !== '';
}

/** Sets the code that the next requests are signed with. */
export function useCode(code) {
  adminCode = code;
}

/** Keeps the current code in this browser, so the next visit unlocks by itself. */
export function rememberCode() {
  try {
    localStorage.setItem(STORAGE_KEY, adminCode);
  } catch {
    // Private mode: nothing to remember.
  }
}

/**
 * Sends a request with the admin code.
 * @param {string} method 'GET', 'POST' or 'DELETE'
 * @param {string} url
 * @param {object} [body] sent as JSON
 * @returns {Promise<object>} the server's JSON answer
 * @throws {Error} with a message fit to show: the server's own when it refuses, or that it could not be reached
 */
export async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminCode },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // The browser's own text for this is "Failed to fetch", which helps nobody.
    throw new Error('Could not reach the server. Check the network and try again.');
  }
  const answer = await response.json();
  if (!response.ok) throw new Error(answer.error || `The server answered ${response.status}`);
  return answer;
}
