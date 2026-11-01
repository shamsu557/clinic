// Compatibility entry point (original project layout). Same as `npm start`.
process.env.RUN_VIA_APP_JS = '1';
require('./src/server');
require('./src/lib/sweep').start();
