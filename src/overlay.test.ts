import { test, expect, describe } from "vitest";
import { Overlay } from "./overlay.js";

const request = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("Overlay", () => {
  test("hasRoute is false when no routes are registered", () => {
    const overlay = new Overlay();
    expect(overlay.hasRoute(request("/test"))).toBe(false);
  });

  test("hasRoute is true after addRoute and false after dispose", () => {
    const overlay = new Overlay();
    const dispose = overlay.addRoute(["get", ["/test", (c: any) => c.json({ ok: true })]]);

    expect(overlay.hasRoute(request("/test"))).toBe(true);
    expect(overlay.hasRoute(request("/other"))).toBe(false);
    expect(overlay.hasRoute(request("/test", { method: "POST" }))).toBe(false);

    dispose();
    expect(overlay.hasRoute(request("/test"))).toBe(false);
  });

  test("fetch serves the registered handler", async () => {
    const overlay = new Overlay();
    using _ = overlay.addRoute(["get", ["/test", (c: any) => c.json({ source: "overlay" })]]);

    const res = await overlay.fetch(request("/test"), {});
    expect(await res.json()).toEqual({ source: "overlay" });
  });

  test("fetch 404s after the route is disposed", async () => {
    const overlay = new Overlay();
    const dispose = overlay.addRoute(["get", ["/test", (c: any) => c.json({ ok: true })]]);

    expect((await overlay.fetch(request("/test"), {})).status).toBe(200);
    dispose();
    expect((await overlay.fetch(request("/test"), {})).status).toBe(404);
  });

  test("rebuilds after a request so later addRoute still works", async () => {
    const overlay = new Overlay();

    expect(overlay.hasRoute(request("/a"))).toBe(false);

    using _a = overlay.addRoute(["get", ["/a", (c: any) => c.json({ path: "a" })]]);
    expect(await (await overlay.fetch(request("/a"), {})).json()).toEqual({ path: "a" });

    using _b = overlay.addRoute(["get", ["/b", (c: any) => c.json({ path: "b" })]]);
    expect(await (await overlay.fetch(request("/a"), {})).json()).toEqual({ path: "a" });
    expect(await (await overlay.fetch(request("/b"), {})).json()).toEqual({ path: "b" });
  });

  test("keeps other routes after disposing one of them", async () => {
    const overlay = new Overlay();
    const disposeA = overlay.addRoute(["get", ["/a", (c: any) => c.json({ path: "a" })]]);
    using _b = overlay.addRoute(["get", ["/b", (c: any) => c.json({ path: "b" })]]);

    disposeA();

    expect(overlay.hasRoute(request("/a"))).toBe(false);
    expect(overlay.hasRoute(request("/b"))).toBe(true);
    expect(await (await overlay.fetch(request("/b"), {})).json()).toEqual({ path: "b" });
  });

  test("passes env bindings to handlers", async () => {
    const overlay = new Overlay();
    using _ = overlay.addRoute(["get", ["/hello", (c: any) => c.text(c.env.name)]]);

    const res = await overlay.fetch(request("/hello"), { name: "hono" });
    expect(await res.text()).toBe("hono");
  });

  test("all() matches any method", () => {
    const overlay = new Overlay();
    using _ = overlay.addRoute(["all", ["/test", (c: any) => c.json({ ok: true })]]);

    expect(overlay.hasRoute(request("/test"))).toBe(true);
    expect(overlay.hasRoute(request("/test", { method: "POST" }))).toBe(true);
    expect(overlay.hasRoute(request("/test", { method: "PUT" }))).toBe(true);
  });
});
