import { test, expect, describe } from "vitest";
import { Hono } from "hono";
import { Overlay } from "./overlay.js";

const createApp = (overlay: Overlay) =>
  new Hono().use((context, next) => overlay.handle(context, next));

describe("Overlay", () => {
  test("falls through when no routes are registered", async () => {
    const overlay = new Overlay();
    const app = createApp(overlay).get("/test", (c) => c.text("original"));

    expect(await (await app.request("/test")).text()).toBe("original");
  });

  test("serves a route until it is disposed", async () => {
    const overlay = new Overlay();
    const app = createApp(overlay).get("/test", (c) => c.text("original"));
    const dispose = overlay.addRoute("get", "/test", (c: any) => c.text("overlay"));

    expect(await (await app.request("/test")).text()).toBe("overlay");
    dispose();
    expect(await (await app.request("/test")).text()).toBe("original");
  });

  test("rebuilds after a request so later routes still work", async () => {
    const overlay = new Overlay();
    const app = createApp(overlay);

    expect((await app.request("/a")).status).toBe(404);

    using _a = overlay.addRoute("get", "/a", (c: any) => c.text("a"));
    expect(await (await app.request("/a")).text()).toBe("a");

    using _b = overlay.addRoute("get", "/b", (c: any) => c.text("b"));
    expect(await (await app.request("/a")).text()).toBe("a");
    expect(await (await app.request("/b")).text()).toBe("b");
  });

  test("keeps other routes after disposing one route", async () => {
    const overlay = new Overlay();
    const app = createApp(overlay);
    const disposeA = overlay.addRoute("get", "/a", (c: any) => c.text("a"));
    using _b = overlay.addRoute("get", "/b", (c: any) => c.text("b"));

    disposeA();

    expect((await app.request("/a")).status).toBe(404);
    expect(await (await app.request("/b")).text()).toBe("b");
  });

  test("all() matches any method", async () => {
    const overlay = new Overlay();
    const app = createApp(overlay);
    using _ = overlay.addRoute("all", "/test", (c: any) => c.text(c.req.method));

    expect(await (await app.request("/test")).text()).toBe("GET");
    expect(await (await app.request("/test", { method: "POST" })).text()).toBe("POST");
    expect(await (await app.request("/test", { method: "PUT" })).text()).toBe("PUT");
  });
});
