import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const localesDir = path.join(root, "src", "locales");
const sourceDir = path.join(root, "src");
const namespaces = [
  "common",
  "auth",
  "onboarding",
  "dashboard",
  "marketplace",
  "cart",
  "admin",
  "errors",
  "metadata"
];

const failures = [];
const warnings = [];

for (const locale of ["en", "ta"]) {
  for (const namespace of namespaces) {
    const file = localeFile(locale, namespace);
    if (!fs.existsSync(file)) {
      failures.push(`Missing locale file: ${relative(file)}`);
      continue;
    }
    const duplicateKeys = detectDuplicateKeys(fs.readFileSync(file, "utf8"));
    for (const key of duplicateKeys) {
      failures.push(`Duplicate key in ${relative(file)}: ${key}`);
    }
  }
}

for (const namespace of namespaces) {
  const en = readJson(localeFile("en", namespace));
  const ta = readJson(localeFile("ta", namespace));
  const enFlat = flatten(en);
  const taFlat = flatten(ta);

  for (const key of Object.keys(enFlat)) {
    if (!(key in taFlat)) {
      failures.push(`Missing ta key: ${namespace}.${key}`);
      continue;
    }

    const enArgs = icuArgs(enFlat[key]);
    const taArgs = icuArgs(taFlat[key]);
    if (!sameSet(enArgs, taArgs)) {
      failures.push(
        `ICU argument mismatch: ${namespace}.${key} en={${[...enArgs].join(",")}} ta={${[...taArgs].join(",")}}`
      );
    }
  }

  for (const key of Object.keys(taFlat)) {
    if (!(key in enFlat)) {
      failures.push(`Extra ta key without English source: ${namespace}.${key}`);
    }
  }
}

const hardcoded = scanHardcodedCopy(sourceDir);
if (hardcoded.length > 0) {
  const message = `Hardcoded copy scanner found ${hardcoded.length} candidate literals. Run with I18N_STRICT_HARDCODED=1 to fail on these.`;
  if (process.env.I18N_STRICT_HARDCODED === "1" || process.argv.includes("--strict")) {
    failures.push(message);
    for (const item of hardcoded.slice(0, 80)) {
      failures.push(`Hardcoded copy: ${relative(item.file)}:${item.line} "${item.text}"`);
    }
  } else {
    warnings.push(message);
    for (const item of hardcoded.slice(0, 20)) {
      warnings.push(`Hardcoded copy: ${relative(item.file)}:${item.line} "${item.text}"`);
    }
  }
}

for (const warning of warnings) {
  console.warn(`i18n warning: ${warning}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`i18n error: ${failure}`);
  }
  process.exit(1);
}

console.log("i18n check passed: locale trees and ICU arguments are aligned.");

function localeFile(locale, namespace) {
  return path.join(localesDir, locale, `${namespace}.json`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function flatten(value, prefix = "", output = {}) {
  if (typeof value === "string") {
    output[prefix] = value;
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function icuArgs(message) {
  const args = new Set();
  let depth = 0;
  for (let index = 0; index < message.length; index += 1) {
    const char = message[index];
    if (char === "{") {
      if (depth === 0) {
        const match = message.slice(index + 1).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\b/);
        if (match) {
          args.add(match[1]);
        }
      }
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return args;
}

function sameSet(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function detectDuplicateKeys(source) {
  const duplicates = [];
  const stack = [{ keys: new Set(), path: [] }];
  let expectingKey = false;
  let stringValue = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        inString = false;
        const next = source.slice(i + 1).match(/^\s*:/);
        if (next && stack.length > 0) {
          const frame = stack[stack.length - 1];
          const keyPath = [...frame.path, stringValue].join(".");
          if (frame.keys.has(stringValue)) {
            duplicates.push(keyPath);
          }
          frame.keys.add(stringValue);
          expectingKey = true;
        }
      } else {
        stringValue += char;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      stringValue = "";
      continue;
    }
    if (char === "{") {
      const parent = stack[stack.length - 1];
      stack.push({ keys: new Set(), path: expectingKey && parent ? [...parent.path, stringValue] : parent?.path ?? [] });
      expectingKey = false;
      continue;
    }
    if (char === "}") {
      stack.pop();
      expectingKey = false;
    }
  }

  return duplicates;
}

function scanHardcodedCopy(dir) {
  const candidates = [];
  for (const file of walk(dir)) {
    if (!/\.(tsx|ts)$/.test(file) || file.includes(`${path.sep}locales${path.sep}`)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    visit(ast, (node) => {
      if (ts.isJsxText(node)) {
        const text = cleanText(node.getText(ast));
        if (looksLikeCopy(text)) {
          candidates.push({ file, line: lineOf(ast, node), text });
        }
      }
      if (ts.isStringLiteral(node) && isUserFacingAttribute(node)) {
        const text = cleanText(node.text);
        if (looksLikeCopy(text)) {
          candidates.push({ file, line: lineOf(ast, node), text });
        }
      }
    });
  }
  return candidates;
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function isUserFacingAttribute(node) {
  const parent = node.parent;
  if (!ts.isJsxAttribute(parent)) {
    return false;
  }
  return ["aria-label", "placeholder", "title", "alt"].includes(parent.name.getText());
}

function cleanText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function looksLikeCopy(text) {
  return /[A-Za-z]/.test(text) && text.length > 2 && !/^[A-Z0-9_./:-]+$/.test(text);
}

function lineOf(ast, node) {
  return ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".next", "node_modules"].includes(entry.name)) {
        continue;
      }
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}
