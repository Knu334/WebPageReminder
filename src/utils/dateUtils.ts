export const createZeroSecCurrentDate = (): Date => {
  const current = new Date();
  current.setSeconds(0);
  current.setMilliseconds(0);
  return current;
};
