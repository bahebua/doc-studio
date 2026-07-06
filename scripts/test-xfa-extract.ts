/*
 * Sanity check for the XFA extractor: build a minimal fake "PDF" that
 * contains an XDP payload as an uncompressed literal, plus a second
 * one hidden inside a FlateDecode stream, and confirm both are found.
 *
 * Run: npx tsx scripts/test-xfa-extract.ts
 */
import { extractXfaXml } from '../src/lib/pdfXfaExtract';
import { deflateSync } from 'node:zlib';

const XDP = `<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><config/><template/></xdp:xdp>`;

// 1) Uncompressed: payload embedded directly in the file body.
async function testRaw() {
  const buf = Buffer.concat([
    Buffer.from('%PDF-1.7\n%¥¥¥¥\n1 0 obj<<>>stream\n', 'latin1'),
    Buffer.from(XDP, 'utf8'),
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const hit = await extractXfaXml(new Uint8Array(buf));
  if (!hit || hit.source !== 'raw' || !hit.xml.includes('xdp:xdp')) {
    throw new Error(`raw case failed: ${JSON.stringify(hit)}`);
  }
  console.log('✓ raw XDP payload:', hit.xml.length, 'chars, source=', hit.source);
}

// 2) FlateDecode: payload compressed inside a stream object.
async function testFlate() {
  const compressed = deflateSync(Buffer.from(XDP, 'utf8'));
  const buf = Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj<</Filter /FlateDecode>>stream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const hit = await extractXfaXml(new Uint8Array(buf));
  if (!hit || hit.source !== 'flate-stream' || !hit.xml.includes('xdp:xdp')) {
    throw new Error(`flate case failed: ${JSON.stringify(hit)}`);
  }
  console.log('✓ Flate-compressed XDP payload:', hit.xml.length, 'chars, source=', hit.source);
}

// 3) No XFA content: should return null.
async function testStatic() {
  const buf = Buffer.from('%PDF-1.7\nJust a plain PDF, no XFA here.\n%%EOF', 'latin1');
  const hit = await extractXfaXml(new Uint8Array(buf));
  if (hit !== null) {
    throw new Error(`static case should be null, got ${JSON.stringify(hit)}`);
  }
  console.log('✓ static PDF correctly returned null');
}

await testRaw();
await testFlate();
await testStatic();
console.log('\nAll XFA extractor tests passed.');
