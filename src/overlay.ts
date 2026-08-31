import { Hono } from "hono";
import { andDisposable } from "./and-disposable.js";
import type { AndDisposable } from "./and-disposable.js";

type Methods = "get" | "post" | "put" | "delete" | "options" | "patch" | "query" | "all";
type Route = [method: Methods, args: any[]];

export class Overlay {
  #routes: Set<Route> = new Set();
  #overlay: Hono | undefined;

  addRoute(route: Route): AndDisposable {
    this.#routes.add(route);
    this.#overlay = undefined;
    return andDisposable(() => {
      this.#routes.delete(route);
      this.#overlay = undefined;
    });
  }

  hasRoute(request: Request): boolean {
    const overlay = this.#app();
    const path = overlay.getPath(request);
    const matchResult = overlay.router.match(request.method, path);
    return matchResult[0].length > 0;
  }

  async fetch(request: Request, env: any): Promise<Response> {
    return await this.#app().fetch(request, env);
  }

  #app(): Hono {
    if (!this.#overlay) {
      this.#overlay = new Hono();
      for (const [method, args] of this.#routes) {
        (this.#overlay as any)[method](...args);
      }
    }
    return this.#overlay;
  }
}
