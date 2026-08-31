# hono-overlay

Temporarily overlay routes on a [Hono](https://hono.dev) app. Overlay handlers take precedence while they are registered; detaching them restores the original routes.

## Usage

```ts
import { Hono } from "hono";
import { createOverlay, type OverlayMiddleware } from "hono-overlay";

const overlay = createOverlay();
const app = new Hono().use(overlay).get("/hello", (c) => c.text("Hello"));
const typedOverlay: OverlayMiddleware<typeof app> = overlay;

{
  using _ = typedOverlay.get("/hello", (c) => c.text("Overlay"));
  await app.request("/hello"); // "Overlay"
}

await app.request("/hello"); // "Hello"
```

You can also detach by calling the returned function:

```ts
const detach = overlay.get("/hello", (c) => c.text("Overlay"));
detach();
```

`get`, `post`, `put`, `delete`, `options`, `patch`, `query`, and `all` are available. Unmatched requests fall through to the original app.

## License

MIT
