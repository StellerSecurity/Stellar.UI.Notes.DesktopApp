'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const redirects = require('follow-redirects');

for (const arrayHeaders of [false, true]) {
  test(`cross-origin redirect strips cross-realm sensitive headers (${arrayHeaders ? 'array' : 'object'} headers)`, async t => {
    const received = [];
    const target = http.createServer((request, response) => {
      received.push(request.headers);
      response.end('ok');
    });
    const source = http.createServer((_request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` });
      response.end();
    });
    t.after(() => Promise.all([source, target].map(server => new Promise(resolve => server.close(resolve)))));
    for (const server of [target, source]) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const values = { Authorization: 'synthetic-only', 'X-QA+Token': 'synthetic-only', 'X-Harmless': 'retained' };
    const headers = arrayHeaders ? Object.entries(values).flat() : values;
    const sensitiveHeaders = vm.runInNewContext('["X-QA+Token"]');
    await new Promise((resolve, reject) => {
      const request = redirects.http.get(`http://127.0.0.1:${source.address().port}/`, { headers, sensitiveHeaders }, response => {
        response.resume();
        response.on('end', resolve);
      });
      request.on('error', reject);
      request.setTimeout(3000, () => request.destroy(new Error('Loopback redirect timed out')));
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].authorization, undefined);
    assert.equal(received[0]['x-qa+token'], undefined);
    assert.equal(received[0]['x-harmless'], 'retained');
  });
}
