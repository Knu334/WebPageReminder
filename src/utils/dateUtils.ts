export const createZeroSecCurrentDate = (): Date => {
  let current = new Date();
  current.setSeconds(0);
  current.setMilliseconds(0);
  return current;
};
