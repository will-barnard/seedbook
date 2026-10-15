// Express 4 doesn't catch rejected promises from async handlers — a thrown
// pg error becomes an unhandled rejection, which kills the Node 20 process.
// Wrap handlers so errors reach the error middleware in index.js instead.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
