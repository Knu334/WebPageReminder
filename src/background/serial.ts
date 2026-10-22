export const createSerial = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const p = tail.then(fn);
    tail = p.catch(() => {});
    return p;
  };
};
