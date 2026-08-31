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

  test("a GET overlay handles HEAD requests", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.text("original"));

    using _ = overlay.get("/test", (c) => c.text("overlay", 202));

    const res = await app.request("/test", { method: "HEAD" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
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

  test("passes the original context directly to the overlay handler", async () => {
    const overlay = createOverlay();
    let originalContext: unknown;
    const app = new Hono()
      .use("*", async (c, next) => {
        originalContext = c;
        await next();
      })
      .use(overlay)
      .get("/test", (c) => c.text("original"));

    using _ = overlay.get("/test", (c) => c.text(c === originalContext ? "same" : "different"));

    expect(await (await app.request("/test")).text()).toBe("same");
  });

  test("shares context variables with surrounding middleware", async () => {
    type AppEnv = { Variables: { value: string } };
    const overlay = createOverlay();
    let valueAfterOverlay: string | undefined;
    const app = new Hono<AppEnv>()
      .use("*", async (c, next) => {
        c.set("value", "before");
        await next();
        valueAfterOverlay = c.get("value");
      })
      .use(overlay)
      .get("/test", (c) => c.text(c.get("value")));
    const typedOverlay: OverlayMiddleware<typeof app> = overlay;

    using _ = typedOverlay.get("/test", (c) => {
      expect(c.get("value")).toBe("before");
      c.set("value", "overlay");
      return c.text(c.get("value"));
    });

    expect(await (await app.request("/test")).text()).toBe("overlay");
    expect(valueAfterOverlay).toBe("overlay");
  });

  test("uses the renderer installed by surrounding middleware", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use("*", async (c, next) => {
        c.setRenderer((content) => c.html(`<main>${content}</main>`));
        await next();
      })
      .use(overlay)
      .get("/test", (c) => c.text("original"));

    using _ = overlay.get("/test", (c) => c.render("overlay"));

    expect(await (await app.request("/test")).text()).toBe("<main>overlay</main>");
  });

  test("passes errors to the original app error handler", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.text("original"));
    app.onError((error, c) => c.text(`handled:${error.message}`, 503));

    using _ = overlay.get("/test", () => {
      throw new Error("overlay error");
    });

    const res = await app.request("/test");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("handled:overlay error");
  });

  test("passes the execution context to overlay handlers", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.text("original"));
    const executionContext = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      props: {},
    };

    using _ = overlay.get("/test", (c) =>
      c.text(c.executionCtx === executionContext ? "same" : "different"),
    );

    expect(await (await app.request("/test", {}, undefined, executionContext)).text()).toBe("same");
  });

  test("can fall through to the original route with next", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay).get("/test", (c) => c.text("original", 201));

    using _ = overlay.get("/test", async (c, next) => {
      await next();
      expect(c.res.status).toBe(201);
      c.header("X-After", "overlay");
    });

    const res = await app.request("/test");
    expect(res.status).toBe(201);
    expect(res.headers.get("X-After")).toBe("overlay");
    expect(await res.text()).toBe("original");
  });

  test("preserves validated request data and the request body cache", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use("/test", async (c, next) => {
        const body = await c.req.json<{ message: string }>();
        (c.req as any).addValidatedData("json", body);
        await next();
      })
      .use(overlay)
      .post("/test", (c) => c.text("original"));

    using _ = overlay.post("/test", async (c) => {
      const validated = (c.req as any).valid("json") as { message: string };
      const body = await c.req.json<{ message: string }>();
      return c.json({ validated, body });
    });

    const res = await app.request("/test", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await res.json()).toEqual({
      validated: { message: "hello" },
      body: { message: "hello" },
    });
  });

  test("uses parameters matched by the overlay route", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use(overlay)
      .get("/users/:originalId", (c) => c.text(c.req.param("originalId")));

    using _ = overlay.get("/users/:overlayId", (c) =>
      c.json({
        id: c.req.param("overlayId"),
      }),
    );

    expect(await (await app.request("/users/42")).json()).toEqual({
      id: "42",
    });
  });

  test("inherits a static base path from the middleware route", async () => {
    const overlayMiddleware = createOverlay();
    const app = new Hono()
      .basePath("/api")
      .use(overlayMiddleware)
      .get("/hello", (c) => c.text("original"));
    const overlay: OverlayMiddleware<typeof app> = overlayMiddleware;

    using _ = overlay.get("/hello", (c) => c.text("overlay"));

    expect(await (await app.request("/api/hello")).text()).toBe("overlay");
  });

  test("inherits a parameterized base path from the middleware route", async () => {
    const overlayMiddleware = createOverlay();
    const app = new Hono()
      .basePath("/api/:version")
      .use(overlayMiddleware)
      .get("/hello", (c) => c.text("original"));
    const overlay: OverlayMiddleware<typeof app> = overlayMiddleware;

    using _ = overlay.get("/hello", (c) => c.json({ version: c.req.param("version") }));

    expect(await (await app.request("/api/v1/hello")).json()).toEqual({
      version: "v1",
    });
  });

  test("can mount the same overlay at different base paths", async () => {
    const overlay = createOverlay();
    const app = new Hono()
      .use("/api/*", overlay)
      .use("/admin/*", overlay)
      .get("/api/hello", (c) => c.text("original api"))
      .get("/admin/hello", (c) => c.text("original admin"));

    using _ = overlay.get("/hello", (c) => c.text(`overlay:${c.req.path}`));

    expect(await (await app.request("/api/hello")).text()).toBe("overlay:/api/hello");
    expect(await (await app.request("/admin/hello")).text()).toBe("overlay:/admin/hello");
    expect(await (await app.request("/api/hello")).text()).toBe("overlay:/api/hello");
  });

  test("uses the original app path normalization", async () => {
    const overlay = createOverlay();
    const app = new Hono({ strict: false }).use(overlay).get("/hello", (c) => c.text("original"));

    using _ = overlay.get("/hello", (c) => c.text("overlay"));

    expect(await (await app.request("/hello/")).text()).toBe("overlay");
  });

  test("uses the original app not-found handler after overlay next", async () => {
    const overlay = createOverlay();
    const app = new Hono().use(overlay);
    app.notFound((c) => c.text("custom not found", 404));

    using _ = overlay.get("/test", async (_c, next) => {
      await next();
    });

    const res = await app.request("/test");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("custom not found");
  });
});
