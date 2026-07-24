// Tiny tagged logger for the realMultiplayer mod.
const TAG = '%c[realMP]';
const STYLE = 'color:#34d399;font-weight:bold';

const log = (level, ...args) => {
  // eslint-disable-next-line no-console
  console[level](TAG, STYLE, ...args);
};

export const logger = {
  debug: (...a) => log('debug', ...a),
  info: (...a) => log('info', ...a),
  warn: (...a) => log('warn', ...a),
  error: (...a) => log('error', ...a),
};
