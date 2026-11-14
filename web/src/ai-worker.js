import { bestMove } from './ai.js';

self.onmessage = (e) => {
  const { id, fen, level } = e.data;
  self.postMessage({ id, move: bestMove(fen, level) });
};
