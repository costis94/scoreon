#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const mode = process.argv.includes("--lint") ? "lint" : "check";
const errors = [];

function fail(message) {
  errors.push(message);
}

function readFile(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function parseJson(relPath) {
  try {
    return JSON.parse(readFile(relPath));
  } catch (error) {
    fail(`${relPath}: invalid JSON (${error.message})`);
    return null;
  }
}

function getMsgKeys(value) {
  if (typeof value === "string") {
    return [...value.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((match) => match[1]);
  }

  if (Array.isArray(value)) {
    return value.flatMap(getMsgKeys);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(getMsgKeys);
  }

  return [];
}

function validateJavaScriptSyntax(relPath) {
  const filePath = path.join(root, relPath);
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    fail(`${relPath}: JavaScript syntax error\n${(result.stderr || result.stdout).trim()}`);
  }
}

function validateLocales() {
  const en = parseJson("_locales/en/messages.json");
  const el = parseJson("_locales/el/messages.json");
  if (!en || !el) return null;

  const enKeys = Object.keys(en).sort();
  const elKeys = Object.keys(el).sort();

  const missingInEl = enKeys.filter((key) => !elKeys.includes(key));
  const missingInEn = elKeys.filter((key) => !enKeys.includes(key));

  if (missingInEl.length) fail(`_locales/el/messages.json: missing keys ${missingInEl.join(", ")}`);
  if (missingInEn.length) fail(`_locales/en/messages.json: missing keys ${missingInEn.join(", ")}`);

  return { en, el };
}

function validateManifest(locales) {
  const manifest = parseJson("manifest.json");
  if (!manifest) return;

  if (manifest.manifest_version !== 3) {
    fail("manifest.json: manifest_version must stay 3");
  }

  if (manifest.default_locale !== "en") {
    fail("manifest.json: default_locale must be \"en\"");
  }

  const requiredPaths = [
    "src/popup.html",
    "src/popup.js",
    "src/scanner.html",
    "src/scanner.js",
    "src/scanner.css",
    "src/i18n.js",
    "assets/logo.png",
    "assets/icons/icon16.png",
    "assets/icons/icon32.png",
    "assets/icons/icon48.png",
    "assets/icons/icon128.png"
  ];

  for (const relPath of requiredPaths) {
    if (!exists(relPath)) fail(`Missing required file: ${relPath}`);
  }

  const manifestMsgKeys = [...new Set(getMsgKeys(manifest))];
  for (const key of manifestMsgKeys) {
    if (!locales?.en?.[key]) fail(`manifest.json: missing locale key in en/messages.json -> ${key}`);
    if (!locales?.el?.[key]) fail(`manifest.json: missing locale key in el/messages.json -> ${key}`);
  }
}

function validateHtmlReferences() {
  const htmlFiles = ["src/popup.html", "src/scanner.html"];

  for (const relPath of htmlFiles) {
    const text = readFile(relPath);
    const refs = [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);

    for (const ref of refs) {
      if (/^(https?:|data:|#)/.test(ref)) continue;
      const resolved = path.normalize(path.join(path.dirname(relPath), ref));
      if (!exists(resolved)) fail(`${relPath}: missing referenced file ${ref}`);
    }
  }
}

function validateReadme() {
  const readme = readFile("README.md");

  if (!/Chrome extension/i.test(readme)) {
    fail("README.md: should explicitly mention that Scoreon is a Chrome extension");
  }

  if (readme.includes("Clarify in README")) {
    fail("README.md: contains leftover commit-note text");
  }
}

function validateLintOnlyRules() {
  const jsFiles = [];
  collectJsFiles(path.join(root, "src"), jsFiles);
  collectJsFiles(path.join(root, "scripts"), jsFiles);
  for (const relPath of jsFiles) validateJavaScriptSyntax(relPath);

  const scannerCss = readFile("src/scanner.css");
  if (!scannerCss.includes(":root")) {
    fail("src/scanner.css: expected CSS variable definitions in :root");
  }
}

function collectJsFiles(dirPath, output) {
  if (!fs.existsSync(dirPath)) return;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath, output);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      output.push(path.relative(root, fullPath).replace(/\\/g, "/"));
    }
  }
}

const locales = validateLocales();
validateManifest(locales);
validateHtmlReferences();
validateReadme();
validateLintOnlyRules();

if (errors.length) {
  console.error(`Scoreon ${mode} failed:\n`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Scoreon ${mode} passed.`);
