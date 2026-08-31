import type { MiddlewareHandler, Schema } from "hono";
import type { HonoBase } from "hono/hono-base";
import { createMiddleware } from "hono/factory";
import type {
  BlankInput,
  BlankSchema,
  Env,
  Handler,
  HandlerResponse,
  Input,
  MergePath,
} from "hono/types";
import type { AndDisposable } from "./and-disposable.js";
import { Overlay } from "./overlay.js";

type AnyApp = HonoBase<any, any, any>;

interface OverlayHandler<
  E extends Env = Env,
  S extends Schema = BlankSchema,
  BasePath extends string = "/",
> {
  <
    P extends Extract<keyof S, string>,
    I extends Input = BlankInput,
    R extends HandlerResponse<any> = any,
  >(
    path: P,
    handler: Handler<E, P, I, R>,
  ): AndDisposable;
  <P extends string, I extends Input = BlankInput, R extends HandlerResponse<any> = any>(
    path: P,
    handler: Handler<E, MergePath<BasePath, P>, I, R>,
  ): AndDisposable;
}

type InferEnv<App extends AnyApp> = App extends HonoBase<infer E, any, any> ? E : Env;
type InferSchema<App extends AnyApp> = App extends HonoBase<any, infer S, any> ? S : Schema;
type InferBasePath<App extends AnyApp> = App extends HonoBase<any, any, infer B> ? B : "/";

export interface OverlayMiddleware<App extends AnyApp> extends MiddlewareHandler {
  get: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
  post: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
  put: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
  delete: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
  options: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
  patch: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
  query: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
  all: OverlayHandler<InferEnv<App>, InferSchema<App>, InferBasePath<App>>;
}

export function createOverlay<App extends AnyApp>(): OverlayMiddleware<App> {
  const overlay = new Overlay();
  const middleware = createMiddleware((c, next) => {
    return overlay.handle(c, next);
  });
  return Object.assign(middleware, {
    get: (path: string, handler: Handler) => overlay.addRoute("get", path, handler),
    post: (path: string, handler: Handler) => overlay.addRoute("post", path, handler),
    put: (path: string, handler: Handler) => overlay.addRoute("put", path, handler),
    delete: (path: string, handler: Handler) => overlay.addRoute("delete", path, handler),
    options: (path: string, handler: Handler) => overlay.addRoute("options", path, handler),
    patch: (path: string, handler: Handler) => overlay.addRoute("patch", path, handler),
    query: (path: string, handler: Handler) => overlay.addRoute("query", path, handler),
    all: (path: string, handler: Handler) => overlay.addRoute("all", path, handler),
  });
}
