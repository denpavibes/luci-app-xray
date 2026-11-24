"use strict";

import { readfile } from "fs";
import { parse_subscription_body, parse_subscription_headers } from "../../core/root/usr/share/xray/feature/subscription.mjs";

const root = getenv("XRAY_TEST_ROOT") || "../../../../..";

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

// 1. Header parsing (with redirect block + base64 title/announce + userinfo)
const raw_hdrs = readfile(root + "/tests/fixtures/sub_http_headers.txt");
const meta = parse_subscription_headers(raw_hdrs);
assert_eq(meta["title"], "GetBit VPN", "Decoded base64 profile-title");
assert_eq(meta["announce"], "Smart Route Test", "Decoded base64 announce");
assert_eq(meta["upload"], 1073741824, "Parsed upload bytes");
assert_eq(meta["download"], 85006518823, "Parsed download bytes");
assert_eq(meta["total"], 0, "Parsed total bytes");
assert_eq(meta["expire"], 1797676221, "Parsed expire timestamp");
assert_eq(meta["refill_date"], 1796084400, "Parsed refill_date timestamp");
assert_eq(meta["update_interval"], 24, "Parsed profile-update-interval");
assert_eq(meta["web_page_url"], "https://vpn.example.com", "Parsed profile-web-page-url");
assert_eq(meta["support_url"], "https://t.me/example_bot", "Parsed support-url");

// 2. Xray JSON array parsing
const raw_json = readfile(root + "/tests/fixtures/sub_xray_json.json");
const json_nodes = parse_subscription_body(raw_json);
assert_eq(length(json_nodes), 2, "Expected 2 proxy nodes from Xray JSON array");
assert_eq(json_nodes[0]["remarks"], "Node One [XHTTP]", "First Xray JSON node remarks");
assert_eq(json_nodes[0]["network"], "xhttp", "First node network");
assert_eq(json_nodes[0]["security"], "reality", "First node security");
assert_eq(json_nodes[0]["outbound"]["streamSettings"]["xhttpSettings"]["extra"]["xmux"]["maxConcurrency"], "16-32", "Preserved xmux");
assert_eq(json_nodes[1]["outbound"]["settings"]["vnext"][0]["users"][0]["flow"], "xtls-rprx-vision", "Second node flow");

// 3. Single Xray JSON config object parsing
const single_cfg = readfile(root + "/tests/fixtures/sub_xray_json.json");
const parsed_arr = json(single_cfg);
const single_nodes = parse_subscription_body(sprintf("%J", parsed_arr[0]));
assert_eq(length(single_nodes), 1, "Single Xray config yields 1 proxy node");
assert_eq(single_nodes[0]["address"], "198.51.100.1", "Single Xray node address");

// 4. Base64-encoded share URIs (vless, vmess, trojan, ss, hysteria2)
const raw_b64 = readfile(root + "/tests/fixtures/sub_uris_b64.txt");
const uri_nodes = parse_subscription_body(raw_b64);
assert_eq(length(uri_nodes), 5, "Expected 5 nodes from base64 share URI list");
assert_eq(uri_nodes[0]["protocol"], "vless", "URI 0 protocol");
assert_eq(uri_nodes[0]["network"], "xhttp", "URI 0 network");
assert_eq(uri_nodes[0]["security"], "reality", "URI 0 security");
assert_eq(uri_nodes[0]["remarks"], "VLESS XHTTP", "URI 0 decoded remarks");

assert_eq(uri_nodes[1]["protocol"], "vmess", "URI 1 protocol");
assert_eq(uri_nodes[1]["network"], "ws", "URI 1 network");
assert_eq(uri_nodes[1]["remarks"], "VMess WS", "URI 1 remarks");

assert_eq(uri_nodes[2]["protocol"], "trojan", "URI 2 protocol");
assert_eq(uri_nodes[2]["security"], "tls", "URI 2 security");

assert_eq(uri_nodes[3]["protocol"], "shadowsocks", "URI 3 protocol");
assert_eq(uri_nodes[3]["outbound"]["settings"]["servers"][0]["method"], "aes-256-gcm", "URI 3 method");

assert_eq(uri_nodes[4]["protocol"], "hysteria", "URI 4 protocol");
assert_eq(uri_nodes[4]["outbound"]["settings"]["version"], 2, "URI 4 hysteria v2");

printf("PASS: test_subscription_parser.uc (all assertions passed)\n");
