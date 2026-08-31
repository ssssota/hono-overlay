export interface AndDisposable extends Disposable {
  (): void;
}
export function andDisposable(callback: () => void): AndDisposable {
  const dispose = () => {
    callback();
  };
  const andDisposable: AndDisposable = Object.assign(dispose, {
    [Symbol.dispose]: dispose,
  });
  return andDisposable;
}
