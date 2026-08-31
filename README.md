# hono-overlay

Temporarily overlay routes on a [Hono](https://hono.dev) app. Overlay handlers take precedence while they are registered; detaching them restores the original routes.

## Installation

```bash
npm install -D hono-overlay
```

## Usage

```ts
// app.ts
import { Hono } from "hono";
import { createOverlay, type OverlayMiddleware } from "hono-overlay";

const overlayMiddleware = createOverlay();
export const app = new Hono()
  .use(overlayMiddleware)
  .get("/hello", (c) => c.text("Hello"));
export const overlay: OverlayMiddleware<typeof app> = overlayMiddleware;

// some.test.ts
import { app, overlay } from "./app.ts";

test("check", async () => {
  await app.request("/hello"); // "Hello"

  {
    using _ = overlay.get("/hello", (c) => c.text("Overlay"));
    await app.request("/hello"); // "Overlay"
  }

  await app.request("/hello"); // "Hello"

  const detach = overlay.get("/hello", (c) => c.text("Overlay again"));
  await app.request("/hello"); // "Overlay again"
  detach();

  await app.request("/hello"); // "Hello"
});
```

`get`, `post`, `put`, `delete`, `options`, `patch`, `query`, and `all` are available. Unmatched requests fall through to the original app.

## License

MIT
