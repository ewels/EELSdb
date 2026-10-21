// Settings page: shrinks a chosen picture before upload, and previews a theme as soon as it is picked.

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
    const preview = document.querySelector(".avatar-large");
    let img = preview.querySelector("img");
    if (!img) preview.append((img = Object.assign(document.createElement("img"), { alt: "", width: 80, height: 80 })));
    img.src = URL.createObjectURL(blob);
  } catch {
    // The browser could not decode it; the server checks the original instead.
  }
});

for (const radio of document.querySelectorAll('#theme-form input[name="theme"]')) {
  radio.addEventListener("change", () => {
    if (radio.value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = radio.value;
  });
}
