"use strict";

import { popen } from "fs";

function assert_true(cond, msg) {
    if (!cond) {
        die("ASSERTION FAILED: " + msg + "\n");
    }
}

const p_fw = popen("utpl -L ../../../tests/mocks ./firewall_include.ut", "r");
assert_true(p_fw != null, "Failed to run utpl on firewall_include.ut");
const fw_out = p_fw.read("all");
const fw_rc = p_fw.close();
assert_true(fw_rc == 0, "firewall_include.ut exited non-zero");
assert_true(index(fw_out, "chain xray_transparent_proxy") != -1, "Missing xray_transparent_proxy chain");
assert_true(index(fw_out, "198.51.100.100") != -1, "Missing server IP in tp_spec_dv4_bp");
assert_true(index(fw_out, "198.51.100.10") != -1, "Missing subscription node IP in tp_spec_dv4_bp");

const p_dns = popen("utpl -L ../../../tests/mocks ./dnsmasq_include.ut", "r");
assert_true(p_dns != null, "Failed to run utpl on dnsmasq_include.ut");
const dns_out = p_dns.read("all");
const dns_rc = p_dns.close();
assert_true(dns_rc == 0, "dnsmasq_include.ut exited non-zero");
assert_true(index(dns_out, "server=127.0.0.1#5300") != -1, "Missing dnsmasq server line");
assert_true(index(dns_out, "rebind-domain-ok=nas.home") != -1, "Missing rebind-domain-ok for nas.home");

printf("PASS: test_templates.uc (all assertions passed)\n");
