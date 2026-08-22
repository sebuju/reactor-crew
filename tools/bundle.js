/* Single source of truth for "what code does the page actually run?".
   Both auditors use this so they can never drift from index.html. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

function scriptPaths(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
}

/* every script concatenated in load order, exactly as the browser sees it */
function bundle(){
  return scriptPaths().map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
}

module.exports = { ROOT, scriptPaths, bundle };
