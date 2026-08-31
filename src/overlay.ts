import type { Context, Handler, Next } from "hono";
import { RegExpRouter } from "hono/router/reg-exp-router";
import { SmartRouter } from "hono/router/smart-router";
import { TrieRouter } from "hono/router/trie-router";
import { mergePath } from "hono/utils/url";
import { andDisposable } from "./and-disposable.js";
import type { AndDisposable } from "./and-disposable.js";

type Methods = "get" | "post" | "put" | "delete" | "options" | "patch" | "query" | "all";
type Route = [method: Methods, path: string, handler: Handler];

const basePathFromRoutePath = (routePath: string): string => {
  if (!routePath.endsWith("*")) {
    return "/";
  }
  const basePath = routePath.slice(0, -1).replace(/\/$/, "");
  return basePath || "/";
};

const decodeParam = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const createParam = (
  paramMap: Record<string, string | number>,
  values?: string[],
): Context["req"]["param"] => {
  const params = Object.fromEntries(
    Object.entries(paramMap).flatMap(([name, mapped]) => {
      const value = decodeParam(values ? values[mapped as number] : (mapped as string));
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return ((key?: string) => (key ? params[key] : params)) as Context["req"]["param"];
};

export class Overlay {
  #routes: Set<Route> = new Set();
  #routers: Map<string, SmartRouter<Handler>> = new Map();

  addRoute(method: Methods, path: string, handler: Handler): AndDisposable {
    const route: Route = [method, path, handler];
    this.#routes.add(route);
    this.#routers.clear();
    return andDisposable(() => {
      this.#routes.delete(route);
      this.#routers.clear();
    });
  }

  async handle(context: Context, next: Next): Promise<Response | void> {
    const basePath = basePathFromRoutePath(context.req.routePath);
    const router = this.#router(basePath);
    const method = context.req.method === "HEAD" ? "GET" : context.req.method;
    const matchResult = router.match(method, context.req.path);
    const match = matchResult[0][0];
    if (!match) {
      return await next();
    }

    const [handler, paramMap] = match;
    context.req.param = createParam(paramMap, matchResult[1]);
    const response = await handler(context, next);
    return response ?? (context.finalized ? context.res : context.notFound());
  }

  #router(basePath: string): SmartRouter<Handler> {
    const cached = this.#routers.get(basePath);
    if (cached) {
      return cached;
    }

    const router = new SmartRouter<Handler>({
      routers: [new RegExpRouter(), new TrieRouter()],
    });
    for (const [method, path, handler] of this.#routes) {
      router.add(
        method === "all" ? "ALL" : method.toUpperCase(),
        mergePath(basePath, path),
        handler,
      );
    }
    this.#routers.set(basePath, router);
    return router;
  }
}
