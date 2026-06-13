const vm = require('vm');
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'src/controllers/subscription.controller.js');
try {
  const code = fs.readFileSync(filePath, 'utf8');
  vm.createScript(code);
  console.log('SYNTAX OK - File parses without errors');
} catch(e) {
  console.log('SYNTAX ERROR:', e.message);
  process.exit(1);
}
