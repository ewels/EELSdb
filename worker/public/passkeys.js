// Passkey ceremonies for the login page, the second-step page and settings. Without WebAuthn the buttons stay hidden.
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, startRegistration } from "/vendor/simplewebauthn-browser.mjs";

const json = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

const fail = (message) => {
  const box = document.querySelector("#passkey-error");
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
};

// A redirect means the server finished the sign-in (or ended the challenge): follow it.
async function finish(res) {
  if (res.redirected) return void (location.href = res.url);
  fail((await res.json().catch(() => ({}))).error || "That did not work. Please try again.");
}

async function authenticate(optionsUrl, url, extra, useBrowserAutofill = false) {
  const { options, token, error } = await (await json(optionsUrl)).json();
  if (!options) return fail(error === "expired" || !error ? "This sign-in took too long. Please start again." : error);
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options, useBrowserAutofill });
  } catch (e) {
    // Cancelling the browser prompt is not an error worth showing.
    return e?.name === "NotAllowedError" || e?.name === "AbortError" ? undefined : fail("Your browser could not use a passkey.");
  }
  await finish(await json(url, { token, response, ...extra }));
}

if (browserSupportsWebAuthn()) {
  const signIn = document.querySelector("#passkey-sign-in");
  if (signIn) {
    const next = new URLSearchParams(location.search).get("next");
    const run = (auto) => authenticate("/login/passkey/options/", "/login/passkey/", next ? { next } : {}, auto);
    signIn.hidden = false;
    signIn.addEventListener("click", () => run(false));
    browserSupportsWebAuthnAutofill().then((ok) => ok && run(true));
  }

  const second = document.querySelector("#passkey-second-step");
  if (second) {
    second.hidden = false;
    second.addEventListener("click", () => authenticate("/login/second-step/passkey/options/", "/login/second-step/passkey/"));
  }

  const add = document.querySelector("#passkey-add");
  if (add) {
    add.hidden = false;
    add.addEventListener("submit", async (event) => {
      event.preventDefault();
      const res = await json("/account/settings/passkeys/options/");
      const { options, token, error } = await res.json();
      if (!options) return fail(error || "That did not work. Please try again.");
      let response;
      try {
        response = await startRegistration({ optionsJSON: options });
      } catch (e) {
        return e?.name === "NotAllowedError" || e?.name === "AbortError" ? undefined : fail("Your browser could not make a passkey.");
      }
      const done = await json("/account/settings/passkeys/", { token, response, name: add.elements.name.value });
      if (done.ok) location.href = "/account/settings/?notice=passkey-added#h-passkeys";
      else fail((await done.json().catch(() => ({}))).error || "That did not work. Please try again.");
    });
  }
}
