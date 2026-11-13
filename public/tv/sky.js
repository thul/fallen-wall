// The night sky behind the wall: twinkling stars that drift slowly, and a shooting star now and then.

const STAR_COUNT = 260;
const STAR_COLOR = '#cfe6ff';
const FULL_CIRCLE = Math.PI * 2;
const SKY_LAP_MS = 8 * 60 * 60 * 1000; // the stars cross the whole screen once per 8 hours
const FRAME_MS = 100; // the slow twinkle needs only about 10 frames a second

const SHOOTING_STAR_MS = 900;
const FIRST_SHOOTING_STAR_MS = [20_000, 80_000]; // earliest and latest, after the page loads
const NEXT_SHOOTING_STAR_MS = [45_000, 165_000]; // earliest and latest, after the previous one

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Starts drawing the sky on the canvas. It keeps running for the life of the page.
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 * @param {() => boolean} options.isHidden true while nothing needs drawing (the night screen is black)
 * @param {() => boolean} options.mayShoot true while a shooting star is welcome (the wall is idle)
 */
export function startSky(canvas, { isHidden, mayShoot }) {
  const context = canvas.getContext('2d');
  let stars = [];
  let lastDraw = 0;
  let shootingStar = null;
  let nextShootingStar = Date.now() + randomBetween(...FIRST_SHOOTING_STAR_MS);

  function makeStars() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.85, // none in the glow near the horizon
      radius: randomBetween(0.2, 1.5),
      twinkleOffset: Math.random() * FULL_CIRCLE, // so they do not all twinkle together
      twinkleSpeed: randomBetween(0.0005, 0.0025),
    }));
  }

  function drawStars(time) {
    const drift = ((Date.now() % SKY_LAP_MS) / SKY_LAP_MS) * canvas.width;
    context.fillStyle = STAR_COLOR;
    for (const star of stars) {
      const twinkle = Math.abs(Math.sin(star.twinkleOffset + time * star.twinkleSpeed));
      context.globalAlpha = 0.35 + 0.65 * twinkle;
      context.beginPath();
      context.arc((star.x + drift) % canvas.width, star.y, star.radius, 0, FULL_CIRCLE);
      context.fill();
    }
  }

  function launchShootingStar(now) {
    const direction = Math.random() < 0.5 ? -1 : 1; // 1 flies right, -1 flies left
    // Start on the side it flies away from, so it stays on screen.
    const startShare = direction > 0 ? randomBetween(0, 0.6) : randomBetween(0.4, 1);
    shootingStar = {
      startedAt: now,
      direction,
      angle: randomBetween(0.2, 0.7), // radians below horizontal
      x: canvas.width * startShare,
      y: Math.random() * canvas.height * 0.35,
    };
  }

  function drawShootingStar(now) {
    const progress = (now - shootingStar.startedAt) / SHOOTING_STAR_MS; // 0 at the start, 1 at the end
    if (progress >= 1) {
      shootingStar = null;
      nextShootingStar = now + randomBetween(...NEXT_SHOOTING_STAR_MS);
      return;
    }

    const stepX = Math.cos(shootingStar.angle) * shootingStar.direction;
    const stepY = Math.sin(shootingStar.angle);
    const travelled = canvas.width * 0.5 * progress;
    const tailLength = canvas.width * 0.11;
    const headX = shootingStar.x + stepX * travelled;
    const headY = shootingStar.y + stepY * travelled;
    const tailX = headX - stepX * tailLength;
    const tailY = headY - stepY * tailLength;

    // Bright head, tail fading to nothing; the whole streak fades in and out.
    const brightness = Math.sin(Math.PI * progress).toFixed(3);
    const streak = context.createLinearGradient(tailX, tailY, headX, headY);
    streak.addColorStop(0, 'rgba(207, 230, 255, 0)');
    streak.addColorStop(1, `rgba(255, 255, 255, ${brightness})`);

    context.globalAlpha = 1;
    context.strokeStyle = streak;
    context.lineWidth = Math.max(1.5, canvas.width / 900);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(tailX, tailY);
    context.lineTo(headX, headY);
    context.stroke();
  }

  function draw(time) {
    requestAnimationFrame(draw);
    if (isHidden()) return;
    // A shooting star needs every frame to look smooth; the stars alone do not.
    const frameIsDue = time - lastDraw >= FRAME_MS;
    if (!shootingStar && !frameIsDue) return;
    lastDraw = time;

    context.clearRect(0, 0, canvas.width, canvas.height);
    drawStars(time);

    const now = Date.now();
    if (!shootingStar && now > nextShootingStar && mayShoot()) launchShootingStar(now);
    if (shootingStar) drawShootingStar(now);
  }

  window.addEventListener('resize', makeStars);
  makeStars();
  requestAnimationFrame(draw);
}
