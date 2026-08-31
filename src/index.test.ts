import { test, expect, describe } from "vitest";
import { createOverlay, type OverlayMiddleware } from "./index.js";
import { Hono } from "hono";

describe("createOverlay", () => {
  test("overlays a GET route and restores the original after dispose", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ message: "Hello, World!" }));
    const typedOverlay: OverlayMiddleware<typeof app> = overlay;

    {
      using _ = typedOverlay.get("/test", (c) => c.json({ message: "Hello, Overlay!" }));

      await expect(
        Promise.resolve(app.request("/test")).then((res) => res.json()),
      ).resolves.toEqual({
        message: "Hello, Overlay!",
      });
    }

    await expect(Promise.resolve(app.request("/test")).then((res) => res.json())).resolves.toEqual({
      message: "Hello, World!",
    });
  });

  test("does not intercept requests when no overlay routes are registered", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ message: "original" }));

    const res = await app.request("/test");
    expect(await res.json()).toEqual({ message: "original" });
  });

  test("falls through to the original app when the overlay has no matching path", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/a", (c) => c.json({ path: "a" }))
      .get("/b", (c) => c.json({ path: "b" }));

    using _ = overlay.get("/a", (c) => c.json({ path: "overlay-a" }));

    expect(await (await app.request("/a")).json()).toEqual({ path: "overlay-a" });
    expect(await (await app.request("/b")).json()).toEqual({ path: "b" });
  });

  test("falls through when the HTTP method does not match the overlay route", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/test", (c) => c.json({ method: "GET" }))
      .post("/test", (c) => c.json({ method: "POST" }));

    using _ = overlay.get("/test", (c) => c.json({ method: "overlay-GET" }));

    expect(await (await app.request("/test")).json()).toEqual({ method: "overlay-GET" });
    expect(await (await app.request("/test", { method: "POST" })).json()).toEqual({
      method: "POST",
    });
  });

  test("handles a path that does not exist on the original app", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/original", (c) => c.json({ ok: true }));

    {
      using _ = overlay.get("/only-overlay", (c) => c.json({ overlay: true }));

      const overlayRes = await app.request("/only-overlay");
      expect(overlayRes.status).toBe(200);
      expect(await overlayRes.json()).toEqual({ overlay: true });
    }

    const originalRes = await app.request("/only-overlay");
    expect(originalRes.status).toBe(404);
  });

  test.each(["post", "put", "delete", "patch", "options"] as const)(
    "overlays a %s route",
    async (method) => {
      const overlay = createOverlay();
      const app = new Hono()
        .use(overlay)
        [method]("/test", (c) => c.json({ source: "original", method }));

      {
        using _ = overlay[method]("/test", (c) => c.json({ source: "overlay", method }));

        const overlayRes = await app.request("/test", { method: method.toUpperCase() });
        expect(await overlayRes.json()).toEqual({ source: "overlay", method });
      }

      const originalRes = await app.request("/test", { method: method.toUpperCase() });
      expect(await originalRes.json()).toEqual({ source: "original", method });
    },
  );

  test("all() overlays every HTTP method", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/test", (c) => c.json({ source: "original", method: "GET" }))
      .post("/test", (c) => c.json({ source: "original", method: "POST" }))
      .put("/test", (c) => c.json({ source: "original", method: "PUT" }));

    using _ = overlay.all("/test", (c) => c.json({ source: "overlay", method: c.req.method }));

    for (const method of ["GET", "POST", "PUT"] as const) {
      const res = await app.request("/test", { method });
      expect(await res.json()).toEqual({ source: "overlay", method });
    }
  });

  test("keeps other overlay routes after disposing one of them", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/a", (c) => c.json({ path: "original-a" }))
      .get("/b", (c) => c.json({ path: "original-b" }));

    const disposeA = overlay.get("/a", (c) => c.json({ path: "overlay-a" }));
    using _ = overlay.get("/b", (c) => c.json({ path: "overlay-b" }));

    disposeA();

    expect(await (await app.request("/a")).json()).toEqual({ path: "original-a" });
    expect(await (await app.request("/b")).json()).toEqual({ path: "overlay-b" });
  });

  test("can be disposed by calling the returned function", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ source: "original" }));

    const dispose = overlay.get("/test", (c) => c.json({ source: "overlay" }));

    expect(await (await app.request("/test")).json()).toEqual({ source: "overlay" });
    dispose();
    expect(await (await app.request("/test")).json()).toEqual({ source: "original" });
  });

  test("can be disposed via Symbol.dispose", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ source: "original" }));

    const handle = overlay.get("/test", (c) => c.json({ source: "overlay" }));

    expect(await (await app.request("/test")).json()).toEqual({ source: "overlay" });
    handle[Symbol.dispose]();
    expect(await (await app.request("/test")).json()).toEqual({ source: "original" });
  });

  test("nested using restores overlays from the inside out", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ source: "original" }));

    {
      using _outer = overlay.get("/test", (c) => c.json({ source: "outer" }));
      expect(await (await app.request("/test")).json()).toEqual({ source: "outer" });

      {
        using _inner = overlay.get("/test", (c) => c.json({ source: "inner" }));
        // First registered overlay wins while both are active.
        expect(await (await app.request("/test")).json()).toEqual({ source: "outer" });
      }

      expect(await (await app.request("/test")).json()).toEqual({ source: "outer" });
    }

    expect(await (await app.request("/test")).json()).toEqual({ source: "original" });
  });

  test("can add an overlay after the original route has already been requested", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ source: "original" }));

    expect(await (await app.request("/test")).json()).toEqual({ source: "original" });

    using _ = overlay.get("/test", (c) => c.json({ source: "overlay" }));
    expect(await (await app.request("/test")).json()).toEqual({ source: "overlay" });
  });

  test("can add another overlay route after a request has already been handled", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/a", (c) => c.json({ path: "original-a" }))
      .get("/b", (c) => c.json({ path: "original-b" }));

    using _a = overlay.get("/a", (c) => c.json({ path: "overlay-a" }));
    expect(await (await app.request("/a")).json()).toEqual({ path: "overlay-a" });

    using _b = overlay.get("/b", (c) => c.json({ path: "overlay-b" }));
    expect(await (await app.request("/a")).json()).toEqual({ path: "overlay-a" });
    expect(await (await app.request("/b")).json()).toEqual({ path: "overlay-b" });
  });

  test("can overlay the same path again after dispose", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ source: "original" }));

    {
      using _ = overlay.get("/test", (c) => c.json({ source: "first" }));
      expect(await (await app.request("/test")).json()).toEqual({ source: "first" });
    }

    {
      using _ = overlay.get("/test", (c) => c.json({ source: "second" }));
      expect(await (await app.request("/test")).json()).toEqual({ source: "second" });
    }

    expect(await (await app.request("/test")).json()).toEqual({ source: "original" });
  });

  test("overlays a parameterized path", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/users/:id", (c) => c.json({ id: c.req.param("id"), source: "original" }));
    const typedOverlay: OverlayMiddleware<typeof app> = overlay;

    using _ = typedOverlay.get("/users/:id", (c) => {
      c.req.param("id") satisfies string;
      return c.json({ id: c.req.param("id"), source: "overlay" });
    });

    expect(await (await app.request("/users/42")).json()).toEqual({
      id: "42",
      source: "overlay",
    });
  });

  test("overlays a wildcard path", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/api/hello", (c) => c.json({ source: "original" }))
      .get("/other", (c) => c.json({ source: "other" }));

    using _ = overlay.get("/api/*", (c) => c.json({ source: "overlay" }));

    expect(await (await app.request("/api/hello")).json()).toEqual({ source: "overlay" });
    expect(await (await app.request("/other")).json()).toEqual({ source: "other" });
  });

  test("passes env bindings to overlay handlers", async () => {
    const overlay = createOverlay();
    const app = new Hono<{ Bindings: { name: string } }>()
      .use(overlay)
      .get("/hello", (c) => c.text(c.env.name));
    const typedOverlay: OverlayMiddleware<typeof app> = overlay;

    using _ = typedOverlay.get("/hello", (c) => {
      c.env.name satisfies string;
      return c.text(`overlay:${c.env.name}`);
    });

    const res = await app.request("/hello", {}, { name: "hono" });
    expect(await res.text()).toBe("overlay:hono");
  });

  test("runs multiple overlay handlers in order", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.json({ source: "original" }));

    using _ = overlay.get(
      "/test",
      async (c, next) => {
        c.header("X-Overlay", "1");
        await next();
      },
      (c) => c.json({ source: "overlay" }),
    );

    const res = await app.request("/test");
    expect(res.headers.get("X-Overlay")).toBe("1");
    expect(await res.json()).toEqual({ source: "overlay" });
  });
});
