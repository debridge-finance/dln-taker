export const isRevertedError = (error: Error) => {
  return error.message.toLowerCase().includes("reverted");
};
