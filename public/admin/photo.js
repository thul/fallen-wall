// The photo field: pick a photo, optionally crop it, and turn it into a JPEG for upload.
// The photo is always re-encoded in the browser, so uploads stay small and are always JPEG.

// Crop box on the page, in px. Same 5:6 shape as the faces on the TV.
// Keep in step with #cropBox in admin.css.
const BOX_WIDTH = 250;
const BOX_HEIGHT = 300;

const CROPPED_WIDTH = 750; // size of a cropped upload, in px
const CROPPED_HEIGHT = 900;
const MAX_UNCROPPED_SIDE = 1080;
const JPEG_QUALITY = 0.88;

const fileInput = document.getElementById('photo');
const preview = document.getElementById('preview');
const cropCheckbox = document.getElementById('cropOn');
const cropper = document.getElementById('cropper');
const cropBox = document.getElementById('cropBox');
const cropImage = document.getElementById('cropImg');
const zoomSlider = document.getElementById('zoom');

let photo = null; // the picked image, or null
// zoom: 1 means the photo just covers the box.
// x, y: where the photo's top-left corner sits inside the box, in px (zero or negative).
const crop = { zoom: 1, x: 0, y: 0 };
let dragOffset = null; // pointer position minus photo position while dragging, else null

/** Screen pixels per photo pixel when the photo just covers the crop box. */
function coverScale() {
  return Math.max(BOX_WIDTH / photo.width, BOX_HEIGHT / photo.height);
}

function cropScale() {
  return coverScale() * crop.zoom;
}

/** Keeps a position between min and max. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawCrop() {
  const scale = cropScale();
  // The photo must keep covering the whole box: no empty edges.
  crop.x = clamp(crop.x, BOX_WIDTH - photo.width * scale, 0);
  crop.y = clamp(crop.y, BOX_HEIGHT - photo.height * scale, 0);
  cropImage.style.transform = `translate(${crop.x}px, ${crop.y}px) scale(${scale})`;
}

/** Shows the crop box when cropping is ticked, else the plain preview. */
function updateView() {
  const cropping = cropCheckbox.checked && photo !== null;
  cropper.hidden = !cropping;
  preview.hidden = photo === null || cropping;
  if (cropping) drawCrop();
}

function centrePhotoInBox() {
  crop.zoom = 1;
  crop.x = (BOX_WIDTH - photo.width * coverScale()) / 2;
  crop.y = (BOX_HEIGHT - photo.height * coverScale()) / 2;
  zoomSlider.value = 1;
}

function loadPickedFile(onUnreadable) {
  const file = fileInput.files[0];
  photo = null;
  updateView();
  if (!file) return;

  const image = new Image();
  image.onload = () => {
    photo = image;
    preview.src = image.src;
    cropImage.src = image.src;
    centrePhotoInBox();
    updateView();
  };
  image.onerror = onUnreadable;
  image.src = URL.createObjectURL(file);
}

/** Zooms around the centre of the box, so the face stays in place. */
function zoomTo(zoom) {
  const oldScale = cropScale();
  crop.zoom = zoom;
  const growth = cropScale() / oldScale;
  crop.x = BOX_WIDTH / 2 - (BOX_WIDTH / 2 - crop.x) * growth;
  crop.y = BOX_HEIGHT / 2 - (BOX_HEIGHT / 2 - crop.y) * growth;
  drawCrop();
}

/** Dragging inside the box moves the photo (mouse or touch). */
function setUpDragging() {
  cropBox.addEventListener('pointerdown', (event) => {
    dragOffset = { x: event.clientX - crop.x, y: event.clientY - crop.y };
    cropBox.setPointerCapture(event.pointerId);
  });
  cropBox.addEventListener('pointermove', (event) => {
    if (!dragOffset) return;
    crop.x = event.clientX - dragOffset.x;
    crop.y = event.clientY - dragOffset.y;
    drawCrop();
  });
  const stopDragging = () => {
    dragOffset = null;
  };
  cropBox.addEventListener('pointerup', stopDragging);
  cropBox.addEventListener('pointercancel', stopDragging);
}

function drawCropped(canvas) {
  const scale = cropScale();
  canvas.width = CROPPED_WIDTH;
  canvas.height = CROPPED_HEIGHT;
  // The part of the photo that is visible in the crop box, in photo pixels.
  const visible = {
    x: -crop.x / scale,
    y: -crop.y / scale,
    width: BOX_WIDTH / scale,
    height: BOX_HEIGHT / scale,
  };
  canvas.getContext('2d').drawImage(
    photo,
    visible.x, visible.y, visible.width, visible.height,
    0, 0, CROPPED_WIDTH, CROPPED_HEIGHT
  );
}

function drawWhole(canvas) {
  const shrink = Math.min(1, MAX_UNCROPPED_SIDE / Math.max(photo.width, photo.height));
  canvas.width = Math.round(photo.width * shrink);
  canvas.height = Math.round(photo.height * shrink);
  canvas.getContext('2d').drawImage(photo, 0, 0, canvas.width, canvas.height);
}

/* ---------- What the rest of the page uses ---------- */

/**
 * Wires up the photo field. Call once.
 * @param {object} options
 * @param {() => void} options.onUnreadable called when the picked file is not an image the browser can read
 */
export function setUpPhotoField({ onUnreadable }) {
  fileInput.addEventListener('change', () => loadPickedFile(onUnreadable));
  cropCheckbox.addEventListener('change', updateView);
  zoomSlider.addEventListener('input', () => zoomTo(Number(zoomSlider.value)));
  setUpDragging();
}

export function hasPhoto() {
  return photo !== null;
}

/** The photo to upload, as a JPEG data URL: the cropped area, or the whole photo downscaled. */
export function photoAsJpeg() {
  const canvas = document.createElement('canvas');
  if (cropCheckbox.checked) {
    drawCropped(canvas);
  } else {
    drawWhole(canvas);
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** Forgets the picked photo, after the form is reset. */
export function clearPhoto() {
  photo = null;
  updateView();
}
