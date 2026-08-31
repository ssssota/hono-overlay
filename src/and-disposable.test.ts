import { test, expect, describe } from "vitest";
import { andDisposable } from "./and-disposable.js";

describe("andDisposable", () => {
  test("runs the callback when called as a function", () => {
    let disposed = false;
    const handle = andDisposable(() => {
      disposed = true;
    });

    handle();
    expect(disposed).toBe(true);
  });

  test("runs the callback via Symbol.dispose", () => {
    let disposed = false;
    const handle = andDisposable(() => {
      disposed = true;
    });

    handle[Symbol.dispose]();
    expect(disposed).toBe(true);
  });

  test("works with using", () => {
    let disposed = false;

    {
      using _ = andDisposable(() => {
        disposed = true;
      });
      expect(disposed).toBe(false);
    }

    expect(disposed).toBe(true);
  });
});
