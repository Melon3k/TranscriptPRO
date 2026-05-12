#!/usr/bin/env node
/**
 * Print the CHANGELOG.md section for a given tag to stdout.
 * Used by the release workflow to populate `releaseBody` from a single source.
 *
 *   node scripts/extract-changelog.mjs v0.1.3
 *   → everything between "## [0.1.3]" and the next "## ["
 *
 * Falls back to a generic body if no matching section exists (e.g. forgot to
 * update CHANGELOG before tagging — release still goes out, just unattributed).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: node scripts/extract-changelog.mjs vX.Y.Z");
  process.exit(1);
}

const version = tag.replace(/^v/, "");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let content;
try {
  content = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
} catch {
  process.stdout.write(`Release ${tag}\n\nZobacz commity od poprzedniego tagu.`);
  process.exit(0);
}

const lines = content.split("\n");
const header = new RegExp(`^##\\s*\\[${version.replace(/[.+\-]/g, "\\$&")}\\]`);

let inSection = false;
const out = [];
for (const line of lines) {
  if (header.test(line)) { inSection = true; continue; }
  if (inSection && /^##\s*\[/.test(line)) break;
  if (inSection && /^\[[^\]]+\]:/.test(line)) break; // hit the link references at file end
  if (inSection) out.push(line);
}

const body = out.join("\n").trim();
if (!body) {
  process.stdout.write(`Release ${tag}\n\nZobacz commity od poprzedniego tagu.`);
} else {
  process.stdout.write(body);
}
