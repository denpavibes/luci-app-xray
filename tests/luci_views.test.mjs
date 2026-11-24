import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_VIEWS = path.join(ROOT, 'core/root/www/luci-static/resources/view/xray');
const STATUS_VIEWS = path.join(ROOT, 'status/root/www/luci-static/resources/view/xray');

function createLuciHarness(uciSections, execHandler, subCacheFiles = {}) {
    function MockElement(tag, attrs = {}, children = []) {
        return {
            tag,
            attrs,
            children: Array.isArray(children) ? children : [children],
            get childNodes() {
                return this.children;
            },
            get lastElementChild() {
                return this.children[this.children.length - 1];
            }
        };
    }
    function E(tag, attrs, children) {
        if (Array.isArray(tag)) {
            return MockElement('#fragment', {}, attrs || []);
        }
        if (children === undefined && (typeof attrs === 'string' || Array.isArray(attrs))) {
            return MockElement(tag, {}, attrs);
        }
        return MockElement(tag, attrs || {}, children ?? []);
    }

    class MockOption {
        constructor(name, title, description) {
            this.option = name;
            this.title = title;
            this.description = description;
            this.keylist = [];
            this.vallist = [];
            this.deps = [];
        }
        value(k, v) {
            this.keylist.push(k);
            this.vallist.push(v === undefined ? k : v);
        }
        depends(field, val) {
            this.deps.push([field, val]);
        }
        renderWidget(section_id, option_index, cfgvalue) {
            return {
                rendered_keys: this.keylist.slice(),
                rendered_vals: this.vallist.slice(),
                section_id,
                cfgvalue
            };
        }
    }

    class MockSectionValue extends MockOption {}

    class MockSection {
        constructor(type, title, description) {
            this.sectiontype = type;
            this.title = title;
            this.description = description;
            this.options = [];
            this.tabs = [];
        }
        tab(name, title) {
            this.tabs.push({ name, title });
        }
        option(cls, name, title, description) {
            const opt = new cls(name, title, description);
            this.options.push(opt);
            if (opt instanceof MockSectionValue) {
                opt.subsection = new MockSection(name, title, description);
            }
            return opt;
        }
        taboption(tab, cls, name, title, description) {
            const opt = this.option(cls, name, title, description);
            opt.tab = tab;
            return opt;
        }
        renderSectionAdd() {
            return {
                tag: 'div',
                children: [],
                appendChild(el) {
                    this.children.push(el);
                }
            };
        }
        handleAdd(ev, name) {
            return name;
        }
    }

    const createdMaps = [];
    const notifications = [];
    const uciStore = {};
    for (const s of uciSections) {
        uciStore[s['.name']] = s;
    }

    const uciMock = {
        load: async () => 'xray_core',
        sections: (cfg, type) => (type ? uciSections.filter(s => s['.type'] === type) : uciSections),
        get: (cfg, sid, opt) => {
            const sec = uciStore[sid] || uciSections.find(s => s['.type'] === sid);
            if (!sec) return null;
            return opt ? (sec[opt] ?? null) : sec;
        },
        get_first: (cfg, type, opt) => {
            const sec = uciSections.find(s => s['.type'] === type);
            if (!sec) return null;
            return opt ? (sec[opt] ?? null) : sec;
        }
    };

    const formMock = {
        Map: class {
            constructor(config, title, description) {
                this.config = config;
                this.title = title;
                this.description = description;
                this.sections = [];
                createdMaps.push(this);
            }
            section(cls, type, title, desc) {
                const sec = new MockSection(type, title, desc);
                this.sections.push(sec);
                return sec;
            }
            render() {
                return this;
            }
        },
        TypedSection: MockSection,
        GridSection: MockSection,
        SectionValue: MockSectionValue,
        Value: MockOption,
        Flag: MockOption,
        ListValue: MockOption,
        MultiValue: MockOption,
        DynamicList: MockOption,
        TextValue: MockOption,
        DummyValue: MockOption,
        FileUpload: MockOption,
    };

    const fsMock = {
        list: async (p) => {
            if (p === '/usr/share/xray') {
                return [
                    { name: 'xray', size: 100 },
                    { name: 'xray.pid', size: 4 },
                    { name: 'geoip.dat', size: 1024 * 1024 },
                    { name: 'geosite.dat', size: 2 * 1024 * 1024 },
                ];
            }
            if (p === '/etc/xray/subscriptions') {
                return Object.keys(subCacheFiles).map(id => ({ name: `${id}.json`, size: 512 }));
            }
            return [];
        },
        read: async (p) => {
            if (p === '/usr/share/xray/version.txt') {
                return 'luci-app-xray 3.7.4-1 abcdef0 1764000000';
            }
            if (p.startsWith('/etc/xray/subscriptions/')) {
                const id = path.basename(p, '.json');
                if (subCacheFiles[id]) {
                    return JSON.stringify(subCacheFiles[id]);
                }
            }
            throw new Error(`File not found: ${p}`);
        },
        exec: async (cmd, args) => execHandler ? execHandler(cmd, args) : { code: 0, stdout: '', stderr: '' },
        exec_direct: async (cmd, args) => {
            if (Array.isArray(args) && args[0] === 'version') {
                return 'Xray 26.9.9 (Xray, Penetrates Everything.)';
            }
            return execHandler ? execHandler(cmd, args) : '';
        }
    };

    const modules = {
        form: formMock,
        fs: fsMock,
        uci: uciMock,
        ui: {
            addNotification: (title, children, type) => notifications.push({ title, children, type }),
            tabs: { initTabGroup: () => {} }
        },
        network: { getHostHints: async () => ({ hosts: {} }) },
        poll: { add: (fn) => { globalThis.__pollFn = fn; } },
        dom: { content: (target, el) => { target.rendered = el; } },
        'tools.widgets': { UserSelect: MockOption, DeviceSelect: MockOption, ZoneSelect: MockOption },
        baseclass: { extend: (obj) => obj },
        view: { extend: (obj) => obj },
    };

    // Format helper supporting %1024.2mB -> "79.17 GB" and %.2mB -> "85.01 GB"
    const fmtHelper = `
        String.prototype.format = function(...args) {
            let i = 0;
            return this.replace(/%(1024)?(?:\\.(\\d+))?([a-zA-Z])(B?)/g, (m, base1024, prec, spec, unitB) => {
                const arg = args[i++];
                if (spec === 's') return String(arg) + unitB;
                if (spec === 'd') return String(parseInt(arg, 10)) + unitB;
                if (spec === 'm') {
                    const prefixes = ['', 'K', 'M', 'G', 'T', 'P'];
                    const base = base1024 ? 1024 : 1000;
                    let val = Number(arg) || 0;
                    let idx = 0;
                    while (val >= base && idx < prefixes.length - 1) {
                        val /= base;
                        idx++;
                    }
                    return val.toFixed(prec ? Number(prec) : 2) + ' ' + prefixes[idx] + unitB;
                }
                return m;
            });
        };
    `;

    function evalLuci(filePath, extraGlobals = {}) {
        let code = fs.readFileSync(filePath, 'utf8');
        const reqMatches = [...code.matchAll(/^'require\s+([\w.]+)(?:\s+as\s+(\w+))?';$/gm)];
        const bindings = [];
        for (const m of reqMatches) {
            const modName = m[1];
            const varName = m[2] || modName.split('.').pop();
            bindings.push(`const ${varName} = __modules[${JSON.stringify(modName)}];`);
        }
        code = code.replace(/^'require\s+[^']+';\r?\n?/gm, '').replace(/^'use strict';\r?\n?/, '');
        const sandbox = {
            __modules: modules,
            E,
            _: (s) => s,
            L: {
                sortedKeys: (obj) => Object.keys(obj || {}).sort(),
                toArray: (val) => (Array.isArray(val) ? val : (val != null ? [val] : []))
            },
            parseInt,
            isNaN,
            setTimeout: () => {},
            window: { location: { reload: () => {} } },
            ...extraGlobals
        };
        vm.createContext(sandbox);
        vm.runInContext(fmtHelper, sandbox);
        const result = vm.runInContext(`(function () {\n${bindings.join('\n')}\n${code}\n})()`, sandbox);
        return { mod: result, sandbox };
    }

    modules['view.xray.shared'] = evalLuci(path.join(CORE_VIEWS, 'shared.js')).mod;
    modules['view.xray.protocol'] = evalLuci(path.join(CORE_VIEWS, 'protocol.js')).mod;
    modules['view.xray.transport'] = evalLuci(path.join(CORE_VIEWS, 'transport.js')).mod;

    return { evalLuci, createdMaps, notifications, modules };
}

test('core.js renders, enforces testseed rules, generates sub_* IDs, excludes self proxy, and uses base-1024 usage', async () => {
    const subCache = {
        sub_11223344: {
            updated_at: 1795548298,
            status: 'ok',
            error: null,
            meta: { title: 'GetBit VPN', upload: 0, download: 85006518823, total: 0, expire: 1797676221 },
            nodes: [{ remarks: 'Node 1', protocol: 'vless', network: 'xhttp', security: 'reality', address: '1.2.3.4', port: 443 }]
        }
    };
    const uciSections = [
        { '.name': 'general', '.type': 'general', general_balancer_strategy: 'random' },
        { '.name': 'cfg054a8f', '.type': 'servers', alias: 'Main VLESS', server: '1.1.1.1', server_port: ['443'], protocol: 'vless', transport: 'tcp' },
        { '.name': 'sub_11223344', '.type': 'subscriptions', alias: 'GetBit VPN', url: 'https://sub.getbit.space/api/sub/demo', balancer_strategy: 'random' },
        { '.name': 'sub_55667788', '.type': 'subscriptions', alias: 'Second Sub', url: 'https://example.com/sub', balancer_strategy: 'leastLoad' }
    ];

    const h = createLuciHarness(uciSections, null, subCache);
    const { mod: coreView } = h.evalLuci(path.join(CORE_VIEWS, 'core.js'));
    const loaded = await coreView.load();
    const map = coreView.render(loaded);
    const generalSec = map.sections[0];

    // 1. VLESS testseed validation
    const serversSec = generalSec.options.find(o => o.option === 'xray_servers').subsection;
    const testseedOpt = serversSec.options.find(o => o.option === 'vless_testseed');
    assert.ok(testseedOpt, 'vless_testseed option must exist');
    assert.equal(testseedOpt.validate('cfg054a8f', '900, 400, 900, 256'), true, 'allows 4 ints including duplicates');
    assert.notEqual(testseedOpt.validate('cfg054a8f', '900, 400, 900'), true, 'rejects <4 elements');
    assert.notEqual(testseedOpt.validate('cfg054a8f', '1, 2, 3, 4, 5'), true, 'rejects >4 elements');
    assert.notEqual(testseedOpt.validate('cfg054a8f', '1, 2, 3, -4'), true, 'rejects negative integers');

    // 2. Subscriptions section: handleAdd stable ID, self-exclusion in outbound_proxy, base-1024 usage
    const subsSec = generalSec.options.find(o => o.option === 'xray_subscriptions').subsection;
    const newId = subsSec.handleAdd({});
    assert.match(newId, /^sub_[0-9a-f]{8}$/, `Expected sub_<8hex> ID, got ${newId}`);

    const proxyOpt = subsSec.options.find(o => o.option === 'outbound_proxy');
    const renderedProxyWidget = proxyOpt.renderWidget('sub_11223344', 0, '');
    assert.ok(renderedProxyWidget.rendered_keys.includes('cfg054a8f'), 'includes normal servers');
    assert.ok(renderedProxyWidget.rendered_keys.includes('sub_55667788'), 'includes other subscriptions');
    assert.equal(renderedProxyWidget.rendered_keys.includes('sub_11223344'), false, 'excludes self from outbound_proxy');

    const usageOpt = subsSec.options.find(o => o.option === 'sub_usage');
    const usageStr = usageOpt.textvalue('sub_11223344');
    assert.ok(usageStr.includes('79.17 GB'), `Expected base-1024 '79.17 GB', got: ${usageStr}`);
    assert.ok(!usageStr.includes('85.01 GB'), `Should not show base-1000 '85.01 GB', got: ${usageStr}`);

    // 3. Subscriptions are omitted from dialer_proxy and geodata_outbound
    const dialerProxyOpt = serversSec.options.find(o => o.option === 'dialer_proxy');
    assert.equal(dialerProxyOpt.keylist.includes('sub_11223344'), false, 'omits subscriptions from dialer_proxy');
    const geodataOutOpt = generalSec.options.find(o => o.option === 'geodata_outbound');
    assert.equal(geodataOutOpt.keylist.includes('sub_11223344'), false, 'omits subscriptions from geodata_outbound');

    // 4. Subscriptions are present in balancers and observatory_servers
    const tcp4Opt = generalSec.options.find(o => o.option === 'tcp_balancer_v4');
    assert.ok(tcp4Opt.keylist.includes('sub_11223344'), 'includes subscription in tcp_balancer_v4');
    const obsSec = generalSec.options.find(o => o.option === 'observatory_section').subsection;
    const obsServersOpt = obsSec.options.find(o => o.option === 'servers');
    assert.ok(obsServersOpt.keylist.includes('sub_11223344'), 'includes subscription in observatory servers');

    // 5. Update button is appended beside Add without throwing
    const addBar = subsSec.renderSectionAdd();
    assert.equal(addBar.children.length, 1);
    assert.deepEqual(addBar.children[0].children, ['Update']);
});

test('status.js formats subscription outbounds and renders Subscriptions tab with base-1024 usage', async () => {
    const subCache = {
        sub_11223344: {
            updated_at: 1795548298,
            status: 'ok',
            error: null,
            meta: {
                title: 'GetBit VPN',
                upload: 0,
                download: 85006518823,
                total: 0,
                expire: 1797676221,
                refill_date: 1796084400,
                web_page_url: 'https://vpn.getbit.exchange',
                support_url: 'https://t.me/GetBitVPN_bot',
                announce: 'Smart Route Notice'
            },
            nodes: [
                { remarks: 'PL Node', protocol: 'vless', network: 'xhttp', security: 'reality', address: '2.56.125.72', port: 8443 }
            ]
        }
    };
    const uciSections = [
        { '.name': 'general', '.type': 'general', metrics_server_enable: '1', stats: '1' },
        { '.name': 'sub_11223344', '.type': 'subscriptions', alias: 'GetBit VPN', url: 'https://sub.getbit.space/api/sub/demo' }
    ];
    let pollFn = null;
    const h = createLuciHarness(uciSections, () => ({
        observatory: {
            'subscription_outbound:sub_11223344:0': { alive: true, delay: 42, last_try_time: 1795548300 }
        },
        stats: {
            outbound: {
                'subscription_outbound:sub_11223344:0': { downlink: 1073741824, uplink: 536870912 }
            },
            inbound: {
                subscription_update_inbound: { downlink: 1024 * 1024, uplink: 2048 }
            }
        }
    }), subCache);
    h.modules.poll = { add: (fn) => { pollFn = fn; } };

    const { mod: statusView } = h.evalLuci(path.join(STATUS_VIEWS, 'status.js'));
    const loaded = await statusView.load();
    const page = statusView.render(loaded);
    assert.ok(pollFn, 'poll handler should be registered');
    pollFn();
    await new Promise(resolve => setImmediate(resolve));

    const detailDiv = page.children[2];
    const serialized = JSON.stringify(detailDiv.rendered);
    assert.ok(serialized.includes('data-tab":"subscriptions"'), 'Subscriptions tab must be rendered');
    assert.ok(serialized.includes('79.17 GB'), 'Status page must display base-1024 79.17 GB download counter');
    assert.ok(serialized.includes('42 ms'), 'Status page must display live observatory latency for subscription node');
    assert.ok(serialized.includes('GetBit VPN: PL Node'), 'Observatory/Outbounds must display subscription node remarks');
    assert.ok(serialized.includes('Smart Route Notice'), 'Subscriptions tab must render announcement');
});
