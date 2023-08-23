export const isRevertedError = (error: Error) => error.message?.toLowerCase()?.includes('reverted');
