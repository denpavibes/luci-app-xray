import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walkFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) {
        return out;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkFiles(full));
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
    return out;
}

const JS_VIEWS = [
    ...walkFiles(path.join(ROOT, 'core/root/www')),
    ...walkFiles(path.join(ROOT, 'status/root/www')),
    ...walkFiles(path.join(ROOT, 'geodata/root/www')),
].filter(f => f.endsWith('.js'));

const JSON_FILES = [
    ...walkFiles(path.join(ROOT, 'core/root/usr/share')),
    ...walkFiles(path.join(ROOT, 'status/root/usr/share')),
    ...walkFiles(path.join(ROOT, 'geodata/root/usr/share')),
    path.join(ROOT, '.devcontainer/devcontainer.json'),
].filter(f => f.endsWith('.json'));

test('LuCI JS views pass node -c syntax check', () => {
    assert.ok(JS_VIEWS.length >= 7, `Expected at least 7 JS views, found ${JS_VIEWS.length}`);
    for (const file of JS_VIEWS) {
        execFileSync(process.execPath, ['-c', file], { stdio: 'pipe' });
    }
});

test("LuCI JS views do not shadow 'require ...' imports", () => {
    const reqRe = /^'require\s+([\w.]+)(?:\s+as\s+(\w+))?';$/gm;
    for (const file of JS_VIEWS) {
        const src = fs.readFileSync(file, 'utf8');
        const imports = [];
        for (const m of src.matchAll(reqRe)) {
            const name = m[2] || m[1].split('.').pop();
            imports.push(name);
        }
        assert.ok(imports.length > 0, `Expected LuCI 'require ...' imports in ${path.relative(ROOT, file)}`);
        for (const id of imports) {
            const shadowRe = new RegExp(`\\b(?:let|const|var)\\s+${id}\\b`);
            const match = shadowRe.exec(src);
            assert.equal(
                match,
                null,
                `${path.relative(ROOT, file)} shadows imported '${id}' via "${match ? match[0] : ''}"`
            );
        }
    }
});

test('ACL, menu, and devcontainer JSON files are valid JSON', () => {
    for (const file of JSON_FILES) {
        assert.ok(fs.existsSync(file), `Missing JSON file: ${path.relative(ROOT, file)}`);
        assert.doesNotThrow(
            () => JSON.parse(fs.readFileSync(file, 'utf8')),
            `Invalid JSON in ${path.relative(ROOT, file)}`
        );
    }
});

test('All files under */root/ are installed by their package Makefile', () => {
    for (const pkg of ['core', 'status', 'geodata']) {
        const makefile = fs.readFileSync(path.join(ROOT, pkg, 'Makefile'), 'utf8');
        const rootDir = path.join(ROOT, pkg, 'root');
        const files = walkFiles(rootDir);
        assert.ok(files.length > 0, `No files found under ${pkg}/root`);
        for (const file of files) {
            const rel = './root/' + path.relative(path.join(ROOT, pkg, 'root'), file).replace(/\\/g, '/');
            assert.ok(
                makefile.includes(rel),
                `${pkg}/Makefile is missing install entry for ${rel}`
            );
        }
    }
});

test('PKG_VERSION is synchronized across core, geodata, and status Makefiles', () => {
    const versions = {};
    for (const pkg of ['core', 'geodata', 'status']) {
        const makefile = fs.readFileSync(path.join(ROOT, pkg, 'Makefile'), 'utf8');
        const m = /^PKG_VERSION:=([^\r\n]+)/m.exec(makefile);
        assert.ok(m, `Could not find PKG_VERSION in ${pkg}/Makefile`);
        versions[pkg] = m[1].trim();
    }
    assert.equal(versions.geodata, versions.core, `geodata (${versions.geodata}) != core (${versions.core})`);
    assert.equal(versions.status, versions.core, `status (${versions.status}) != core (${versions.core})`);
});
