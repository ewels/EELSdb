// Settings page: shrinks a chosen picture before upload, and draws the two-step set-up QR code.

const SIZE = 256;

const avatar = document.querySelector("#f-avatar");
avatar?.addEventListener("change", async () => {
  const file = avatar.files[0];
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
    // Centre crop to a square, so the round avatar shows the middle of the picture.
    canvas.getContext("2d").drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
    if (!blob) return;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "avatar.webp", { type: "image/webp" }));
    avatar.files = dt.files;
    const preview = document.querySelector(".av-large");
    let img = preview.querySelector("img");
    if (!img) preview.append((img = Object.assign(document.createElement("img"), { alt: "" })));
    img.src = URL.createObjectURL(blob);
  } catch {
    // The browser could not decode it; the server checks the original instead.
  }
});

const qr = document.querySelector("#totp-qr");
if (qr) {
  // Without the QR code the secret and the link next to it still work.
  import("/vendor/uqr.mjs").then(({ renderSVG }) => {
    qr.innerHTML = renderSVG(qr.dataset.uri, { border: 2, whiteColor: "#fff", blackColor: "#000" });
  }).catch(() => {});
}
