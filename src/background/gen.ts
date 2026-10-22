let gen = 0;
let controller = new AbortController();

export const currentGen = () => gen;
export const bumpGen = () => {
  controller.abort();
  controller = new AbortController();
  return ++gen;
};
export const isCurrent = (g: number) => g === gen;
// 古い世代には、すでに abort 済みの signal を返す
export const signalFor = (g: number): AbortSignal => (isCurrent(g) ? controller.signal : AbortSignal.abort());
