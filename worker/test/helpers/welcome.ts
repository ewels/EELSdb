import { exports } from "cloudflare:workers";

const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1);

/** A provider callback that matched no account lands on the welcome page; this answers "No, create a new account". Other responses pass through. */
export async function createIfWelcomed(res: Response): Promise<Response> {
  if (res.headers.get("location") !== "/login/welcome/") return res;
  return exports.default.fetch("https://eelsdb.eu/login/welcome/", {
    method: "POST", redirect: "manual",
    headers: { Cookie: cookieOf(res, "eelsdb_pending")!, Origin: "https://eelsdb.eu" },
  });
}
