// Settings pages: shrinks a chosen picture before upload, and draws the two-step set-up QR code.

const SIZE = 256;

const avatar = document.querySelector("#f-avatar");
const card = avatar?.closest(".picture-option");
const pick = card?.querySelector("input[type=radio]");

avatar?.addEventListener("change", async () => {
  const file = avatar.files[0];
  if (!file) return;
  pick.checked = true;
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
    const preview = card.querySelector(".av");
    preview.classList.remove("picture-empty");
    let img = preview.querySelector("img");
    if (!img) preview.append((img = Object.assign(document.createElement("img"), { alt: "" })));
    img.src = URL.createObjectURL(blob);
    card.querySelector(".hint").textContent = "New picture chosen. Save your profile to use it.";
  } catch {
    // The browser could not decode it; the server checks the original instead.
  }
});

if (card) {
  const image = (e) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file" && i.type.startsWith("image/"));
  card.addEventListener("dragover", (e) => {
    if (!image(e)) return;
    e.preventDefault();
    card.classList.add("drop-over");
  });
  card.addEventListener("dragleave", (e) => {
    if (!card.contains(e.relatedTarget)) card.classList.remove("drop-over");
  });
  card.addEventListener("drop", (e) => {
    card.classList.remove("drop-over");
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    const dt = new DataTransfer();
    dt.items.add(file);
    avatar.files = dt.files;
    avatar.dispatchEvent(new Event("change"));
    pick.focus();
  });
}

const qr = document.querySelector("#totp-qr");
if (qr) {
  // Without the QR code the secret and the link next to it still work.
  import("/vendor/uqr.mjs").then(({ renderSVG }) => {
    qr.innerHTML = renderSVG(qr.dataset.uri, { border: 2, whiteColor: "#fff", blackColor: "#000" });
  }).catch(() => {});
}
