"use strict";

import { popen } from "fs";

function assert_true(cond, msg) {
    if (!cond) {
        die("ASSERTION FAILED: " + msg + "\n");
    }
}

function assert_eq(actual, expected, msg) {
    if (actual !== expected) {
        die(sprintf("ASSERTION FAILED: %s (expected=%J, actual=%J)\n", msg, expected, actual));
    }
}

function find_by_tag(arr, tag) {
    for (let item in arr) {
        if (item["tag"] == tag) {
            return item;
        }
    }
    return null;
}

const root = getenv("XRAY_TEST_ROOT") || "../../../../..";
const p = popen(sprintf("ucode -L %s/tests/mocks ./gen_config.uc", root), "r");
assert_true(p != null, "Failed to invoke gen_config.uc");
const raw = p.read("all");
const rc = p.close();
assert_eq(rc, 0, "gen_config.uc exit code");

const cfg = json(raw);
assert_true(type(cfg) == "object", "gen_config output must parse as JSON object");

// 1. Outbound deduplication & tags
let seen_tags = {};
for (let o in cfg["outbounds"]) {
    assert_true(!seen_tags[o["tag"]], "Duplicate outbound tag: " + o["tag"]);
    seen_tags[o["tag"]] = true;
    assert_true(index(o["tag"], "@dialer_proxy:") == -1, "Unexpected @dialer_proxy: hop tag: " + o["tag"]);
    assert_true(index(o["tag"], "@balancer_outbound:") == -1, "Unexpected @balancer_outbound: prefix tag: " + o["tag"]);
}

// 2. VLESS Vision testseed + testpre at settings level
const main_out = find_by_tag(cfg["outbounds"], "balancer_outbound:cfg054a8f");
assert_true(main_out != null, "Missing balancer_outbound:cfg054a8f");
assert_eq(main_out["settings"]["testpre"], 3, "vless_testpre at settings level");
assert_eq(join(",", main_out["settings"]["testseed"]), "900,400,900,256", "vless_testseed 4-int array with duplicate preserved");

// 3. dialer_proxy points directly to balancer_outbound:cfg054a8f
const chained_out = find_by_tag(cfg["outbounds"], "balancer_outbound:cfg064a8f");
assert_true(chained_out != null, "Missing balancer_outbound:cfg064a8f");
assert_eq(chained_out["streamSettings"]["sockopt"]["dialerProxy"], "balancer_outbound:cfg054a8f", "dialerProxy points directly to upstream balancer_outbound");

// 4. Subscription outbounds instantiated cleanly with mark 253 and preserved xhttpSettings
const sub_node0 = find_by_tag(cfg["outbounds"], "subscription_outbound:sub_11223344:0");
const sub_node1 = find_by_tag(cfg["outbounds"], "subscription_outbound:sub_11223344:1");
assert_true(sub_node0 != null && sub_node1 != null, "Missing subscription_outbound:sub_11223344:0..1");
assert_eq(sub_node0["streamSettings"]["sockopt"]["mark"], 253, "Subscription outbound mark = 253");
assert_eq(sub_node0["streamSettings"]["xhttpSettings"]["extra"]["xmux"]["maxConcurrency"], "16-32", "Preserved xmux setting");

// 5. BurstObservatory subjectSelector: no duplicates, subscription prefix present
const burst = cfg["burstObservatory"];
assert_true(burst != null, "Missing burstObservatory");
assert_true(index(burst["subjectSelector"], "direct") != -1, "Missing direct in subjectSelector");
assert_true(index(burst["subjectSelector"], "balancer_outbound:cfg054a8f") != -1, "Missing cfg054a8f in subjectSelector");
assert_true(index(burst["subjectSelector"], "balancer_outbound:cfg064a8f") != -1, "Missing cfg064a8f in subjectSelector");
assert_true(index(burst["subjectSelector"], "subscription_outbound:sub_11223344:") != -1, "Missing subscription prefix in subjectSelector");
assert_eq(length(uniq(burst["subjectSelector"])), length(burst["subjectSelector"]), "subjectSelector must not contain duplicates");
assert_true(index(burst["subjectSelector"], "subscription_outbound:sub_11223344:0") == -1, "subjectSelector must use subscription prefix, not individual node tags");
assert_eq(length(burst["subjectSelector"]), 6, "Expected 6 unique entries in subjectSelector");

// 6. Subscription balancer & resolve_balancer_strategy
const ei_bal = find_by_tag(cfg["routing"]["balancers"], "extra_inbound_outbound:ei01");
assert_true(ei_bal != null, "Missing extra_inbound balancer");
assert_eq(ei_bal["strategy"]["type"], "leastLoad", "Standalone subscription strategy overrides extra_inbound default strategy");
assert_eq(ei_bal["selector"][0], "subscription_outbound:sub_11223344:", "Balancer selector uses subscription prefix");

// 7. Subscription Outbound Proxy loopback SOCKS5 inbound & routing rule
const sub_in = find_by_tag(cfg["inbounds"], "subscription_update_inbound");
assert_true(sub_in != null, "Missing subscription_update_inbound");
assert_eq(sub_in["listen"], "127.0.0.1", "subscription_update_inbound must listen on 127.0.0.1");
assert_eq(sub_in["settings"]["accounts"][0]["user"], "sub_sub_55667788", "SOCKS5 username must not contain colons");

let found_sub_rule = false;
for (let r in cfg["routing"]["rules"]) {
    if (r["inboundTag"] && index(r["inboundTag"], "subscription_update_inbound") != -1) {
        found_sub_rule = true;
        assert_eq(r["user"][0], "sub_sub_55667788", "Routing rule matches SOCKS5 user");
        assert_eq(r["outboundTag"], "balancer_outbound:cfg054a8f", "Routing rule forwards through cfg054a8f");
    }
}
assert_true(found_sub_rule, "Missing subscription_update_inbound routing rule");

// 8. mldsa65Verify propagation check
import { server_outbound } from "../../core/root/usr/share/xray/feature/outbound.mjs";
const mldsa_srv = {
    protocol: "vless",
    server: "198.51.100.99",
    server_port: ["443"],
    password: "33333333-3333-4333-8333-333333333333",
    transport: "tcp",
    tcp_guise: "none",
    vless_tls: "reality",
    vless_flow_reality: "none",
    vless_reality_server_name: "www.example.com",
    vless_reality_public_key: "E9jDrNWA6qgnKl7qfwyqu5XYuh87DJPkcENAFJ5taGY",
    vless_reality_fingerprint: "chrome",
    vless_reality_mldsa65_verify: "test-mldsa-key"
};
const mldsa_out = server_outbound(mldsa_srv, "balancer_outbound:mldsa_test", {});
assert_eq(mldsa_out[0]["streamSettings"]["realitySettings"]["mldsa65Verify"], "test-mldsa-key", "mldsa65Verify propagated");

printf("PASS: test_gen_config.uc (all assertions passed)\n");
