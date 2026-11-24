#!/usr/bin/ucode
"use strict";

import { access, mkdir, readfile, rename, unlink, writefile } from "fs";
import { load_config } from "./common/config.mjs";
import { SUBSCRIPTION_DIR, SUBSCRIPTION_UPDATE_PORT, load_subscription_cache } from "./feature/subscription.mjs";

function url_decode(s) {
    if (s == null) {
        return "";
    }
    return replace(sprintf("%s", s), /%([0-9A-Fa-f]{2})/g, (_, h) => chr(hex(h)));
}

function decode_base64_str(s) {
    if (!s) {
        return "";
    }
    let clean = replace(sprintf("%s", s), /\s+/g, "");
    clean = replace(replace(clean, /-/g, "+"), /_/g, "/");
    const rem = length(clean) % 4;
    if (rem > 0) {
        for (let i = 0; i < 4 - rem; i++) {
            clean += "=";
        }
    }
    try {
        return b64dec(clean) || "";
    } catch (e) {
        return "";
    }
}

function decode_header_value(val) {
    if (!val) {
        return "";
    }
    const v = trim(val);
    if (substr(lc(v), 0, 7) == "base64:") {
        return decode_base64_str(substr(v, 7));
    }
    return url_decode(v);
}

function parse_headers(raw_headers) {
    let meta = {};
    if (!raw_headers) {
        return meta;
    }
    const lines = split(replace(raw_headers, /\r\n/g, "\n"), "\n");
    let current = {};
    for (let line in lines) {
        const t = trim(line);
        if (t == "") {
            continue;
        }
        if (match(t, /^HTTP\/\d/)) {
            current = {};
            continue;
        }
        const colon_idx = index(t, ":");
        if (colon_idx > 0) {
            const name = lc(trim(substr(t, 0, colon_idx)));
            const val = trim(substr(t, colon_idx + 1));
            current[name] = val;
        }
    }

    if (current["profile-title"]) {
        meta["title"] = decode_header_value(current["profile-title"]);
    } else if (current["content-disposition"]) {
        const m = match(current["content-disposition"], /filename\*?=(?:UTF-8'')?"?([^";\r\n]+)"?/i);
        if (m) {
            meta["title"] = url_decode(m[1]);
        }
    }

    if (current["subscription-userinfo"]) {
        for (let part in split(current["subscription-userinfo"], ";")) {
            const kv = split(trim(part), "=");
            if (length(kv) == 2) {
                const k = lc(trim(kv[0]));
                const v = trim(kv[1]);
                if (k == "upload" || k == "download" || k == "total" || k == "expire") {
                    meta[k] = int(v);
                }
            }
        }
    }

    if (current["subscription-refill-date"]) {
        meta["refill_date"] = int(current["subscription-refill-date"]);
    }
    if (current["profile-update-interval"]) {
        meta["update_interval"] = int(current["profile-update-interval"]);
    }
    if (current["profile-web-page-url"]) {
        meta["web_page_url"] = current["profile-web-page-url"];
    }
    if (current["support-url"]) {
        meta["support_url"] = current["support-url"];
    }
    if (current["announce"]) {
        meta["announce"] = decode_header_value(current["announce"]);
    }
    return meta;
}

function extract_node_summary(outbound, remarks) {
    const protocol = outbound["protocol"] || "";
    const stream = outbound["streamSettings"] || {};
    const network = stream["network"] || "tcp";
    const security = stream["security"] || "none";
    let address = "";
    let port = 0;
    const settings = outbound["settings"] || {};
    if (type(settings["vnext"]) == "array" && length(settings["vnext"]) > 0) {
        address = settings["vnext"][0]["address"] || "";
        port = int(settings["vnext"][0]["port"] || 0);
    } else if (type(settings["servers"]) == "array" && length(settings["servers"]) > 0) {
        address = settings["servers"][0]["address"] || "";
        port = int(settings["servers"][0]["port"] || 0);
    } else if (settings["address"]) {
        address = settings["address"];
        port = int(settings["port"] || 0);
    }
    return {
        remarks: remarks || outbound["tag"] || (address ? sprintf("%s:%d", address, port) : protocol),
        protocol: protocol,
        network: network,
        security: security,
        address: address,
        port: port,
        outbound: outbound
    };
}

function is_proxy_outbound(o) {
    if (type(o) != "object" || !o["protocol"]) {
        return false;
    }
    const p = lc(o["protocol"]);
    if (p == "freedom" || p == "blackhole" || p == "dns" || p == "loopback") {
        return false;
    }
    const t = lc(o["tag"] || "");
    if (t == "direct" || t == "block" || t == "blackhole") {
        return false;
    }
    return true;
}

function parse_query_params(qs) {
    let params = {};
    if (!qs) {
        return params;
    }
    for (let pair in split(qs, "&")) {
        if (pair == "") {
            continue;
        }
        const eq = index(pair, "=");
        if (eq == -1) {
            params[url_decode(pair)] = "";
        } else {
            params[url_decode(substr(pair, 0, eq))] = url_decode(substr(pair, eq + 1));
        }
    }
    return params;
}

function split_host_port(hostport) {
    let host = hostport;
    let port = 443;
    if (substr(hostport, 0, 1) == "[") {
        const rb = index(hostport, "]");
        if (rb > 0) {
            host = substr(hostport, 1, rb - 1);
            const rest = substr(hostport, rb + 1);
            if (substr(rest, 0, 1) == ":") {
                port = int(substr(rest, 1));
            }
        }
    } else {
        const colon = index(hostport, ":");
        if (colon > 0) {
            host = substr(hostport, 0, colon);
            port = int(substr(hostport, colon + 1));
        }
    }
    return [host, port];
}

function parse_uri_parts(line, scheme_len) {
    let rest = substr(line, scheme_len);
    let remarks = "";
    const hash_idx = index(rest, "#");
    if (hash_idx != -1) {
        remarks = url_decode(substr(rest, hash_idx + 1));
        rest = substr(rest, 0, hash_idx);
    }
    let query = "";
    const q_idx = index(rest, "?");
    if (q_idx != -1) {
        query = substr(rest, q_idx + 1);
        rest = substr(rest, 0, q_idx);
    }
    // Strip trailing slash before query if any (e.g. host:port/?type=ws)
    if (length(rest) > 0 && substr(rest, -1) == "/") {
        rest = substr(rest, 0, -1);
    }
    let userinfo = "";
    let hostport = rest;
    const at_idx = index(rest, "@");
    if (at_idx != -1) {
        userinfo = url_decode(substr(rest, 0, at_idx));
        hostport = substr(rest, at_idx + 1);
    }
    const hp = split_host_port(hostport);
    return {
        userinfo: userinfo,
        host: hp[0],
        port: hp[1],
        params: parse_query_params(query),
        remarks: remarks
    };
}

function build_stream_settings_from_params(params, default_security) {
    let net = params["type"] || "tcp";
    if (net == "splithttp") {
        net = "xhttp";
    } else if (net == "http") {
        net = "h2";
    }
    let security = params["security"] || default_security || "none";
    let stream = {
        network: net,
        security: security
    };
    const sni = params["sni"] || params["peer"] || params["host"] || "";
    if (security == "tls") {
        let tls = {
            allowInsecure: (params["allowInsecure"] == "1" || params["insecure"] == "1")
        };
        if (sni != "") {
            tls["serverName"] = sni;
        }
        if (params["fp"]) {
            tls["fingerprint"] = params["fp"];
        }
        if (params["alpn"]) {
            tls["alpn"] = split(params["alpn"], ",");
        }
        stream["tlsSettings"] = tls;
    } else if (security == "reality") {
        let reality = {
            show: false,
            serverName: params["sni"] || "",
            fingerprint: params["fp"] || "chrome",
            publicKey: params["pbk"] || "",
            shortId: params["sid"] || "",
            spiderX: params["spx"] || ""
        };
        if (params["mldsa65Verify"]) {
            reality["mldsa65Verify"] = params["mldsa65Verify"];
        }
        stream["realitySettings"] = reality;
    }

    if (net == "ws") {
        let ws = { path: params["path"] || "/" };
        if (params["host"]) {
            ws["headers"] = { Host: params["host"] };
        }
        stream["wsSettings"] = ws;
    } else if (net == "grpc") {
        let grpc = { serviceName: params["serviceName"] || params["path"] || "" };
        if (params["mode"] == "multi") {
            grpc["multiMode"] = true;
        }
        stream["grpcSettings"] = grpc;
    } else if (net == "xhttp") {
        let xhttp = {
            path: params["path"] || "/",
            mode: params["mode"] || "auto"
        };
        if (params["host"]) {
            xhttp["host"] = params["host"];
        }
        if (params["extra"]) {
            try {
                const extra_obj = json(params["extra"]);
                if (type(extra_obj) == "object") {
                    xhttp["extra"] = extra_obj;
                }
            } catch (e) {
            }
        }
        stream["xhttpSettings"] = xhttp;
    } else if (net == "httpupgrade") {
        let hu = { path: params["path"] || "/" };
        if (params["host"]) {
            hu["host"] = params["host"];
        }
        stream["httpupgradeSettings"] = hu;
    } else if (net == "h2") {
        let h2 = { path: params["path"] || "/" };
        if (params["host"]) {
            h2["host"] = split(params["host"], ",");
        }
        stream["httpSettings"] = h2;
    } else if (net == "tcp" && params["headerType"] == "http") {
        stream["tcpSettings"] = {
            header: {
                type: "http",
                request: {
                    path: params["path"] ? split(params["path"], ",") : ["/"],
                    headers: params["host"] ? { Host: split(params["host"], ",") } : {}
                }
            }
        };
    }
    return stream;
}

function parse_share_uri(line) {
    if (substr(line, 0, 8) == "vless://") {
        const u = parse_uri_parts(line, 8);
        let user = {
            id: u["userinfo"],
            encryption: u["params"]["encryption"] || "none"
        };
        if (u["params"]["flow"]) {
            user["flow"] = u["params"]["flow"];
        }
        const outbound = {
            protocol: "vless",
            settings: {
                vnext: [{ address: u["host"], port: u["port"], users: [user] }]
            },
            streamSettings: build_stream_settings_from_params(u["params"], "none")
        };
        return extract_node_summary(outbound, u["remarks"]);
    }
    if (substr(line, 0, 8) == "vmess://") {
        const decoded = decode_base64_str(substr(line, 8));
        if (!decoded) {
            return null;
        }
        try {
            const v = json(decoded);
            if (type(v) != "object") {
                return null;
            }
            const params = {
                type: v["net"] || "tcp",
                security: v["tls"] == "tls" ? "tls" : "none",
                sni: v["sni"] || v["host"] || "",
                host: v["host"] || "",
                path: v["path"] || "",
                alpn: v["alpn"] || "",
                fp: v["fp"] || "",
                headerType: v["type"] || ""
            };
            const outbound = {
                protocol: "vmess",
                settings: {
                    vnext: [{
                        address: v["add"] || "",
                        port: int(v["port"] || 443),
                        users: [{
                            id: v["id"] || "",
                            alterId: int(v["aid"] || 0),
                            security: v["scy"] || "auto"
                        }]
                    }]
                },
                streamSettings: build_stream_settings_from_params(params, "none")
            };
            return extract_node_summary(outbound, v["ps"] || "");
        } catch (e) {
            return null;
        }
    }
    if (substr(line, 0, 9) == "trojan://") {
        const u = parse_uri_parts(line, 9);
        const outbound = {
            protocol: "trojan",
            settings: {
                servers: [{
                    address: u["host"],
                    port: u["port"],
                    password: u["userinfo"]
                }]
            },
            streamSettings: build_stream_settings_from_params(u["params"], "tls")
        };
        return extract_node_summary(outbound, u["remarks"]);
    }
    if (substr(line, 0, 5) == "ss://") {
        let u = parse_uri_parts(line, 5);
        let method = "";
        let password = "";
        if (u["userinfo"] == "" && index(u["host"], ":") == -1 && u["port"] == 443) {
            // Legacy base64(method:password@host:port)
            const dec = decode_base64_str(u["host"]);
            const at_pos = index(dec, "@");
            if (at_pos != -1) {
                const mp = substr(dec, 0, at_pos);
                const hp = split_host_port(substr(dec, at_pos + 1));
                u["host"] = hp[0];
                u["port"] = hp[1];
                const c = index(mp, ":");
                if (c != -1) {
                    method = substr(mp, 0, c);
                    password = substr(mp, c + 1);
                }
            }
        } else {
            let mp = u["userinfo"];
            if (index(mp, ":") == -1) {
                mp = decode_base64_str(mp);
            }
            const c = index(mp, ":");
            if (c != -1) {
                method = substr(mp, 0, c);
                password = substr(mp, c + 1);
            }
        }
        if (!method) {
            return null;
        }
        const outbound = {
            protocol: "shadowsocks",
            settings: {
                servers: [{
                    address: u["host"],
                    port: u["port"],
                    method: method,
                    password: password
                }]
            },
            streamSettings: { network: "tcp", security: "none" }
        };
        return extract_node_summary(outbound, u["remarks"]);
    }
    if (substr(line, 0, 12) == "hysteria2://" || substr(line, 0, 6) == "hy2://") {
        const slen = substr(line, 0, 12) == "hysteria2://" ? 12 : 6;
        const u = parse_uri_parts(line, slen);
        let hy_stream = {
            network: "hysteria",
            security: "tls",
            tlsSettings: {
                allowInsecure: (u["params"]["insecure"] == "1" || u["params"]["allowInsecure"] == "1"),
                serverName: u["params"]["sni"] || u["host"]
            },
            hysteriaSettings: {
                version: 2,
                auth: u["userinfo"]
            }
        };
        const outbound = {
            protocol: "hysteria",
            settings: {
                version: 2,
                address: u["host"],
                port: u["port"]
            },
            streamSettings: hy_stream
        };
        return extract_node_summary(outbound, u["remarks"]);
    }
    return null;
}

function parse_body(raw_body) {
    let nodes = [];
    if (!raw_body) {
        return nodes;
    }
    const trimmed = trim(raw_body);
    if (substr(trimmed, 0, 1) == "[" || substr(trimmed, 0, 1) == "{") {
        try {
            const parsed = json(trimmed);
            if (type(parsed) == "array") {
                for (let item in parsed) {
                    if (type(item) != "object") {
                        continue;
                    }
                    if (type(item["outbounds"]) == "array") {
                        const rem = item["remarks"] || "";
                        for (let o in item["outbounds"]) {
                            if (is_proxy_outbound(o)) {
                                push(nodes, extract_node_summary(o, rem));
                            }
                        }
                    } else if (is_proxy_outbound(item)) {
                        push(nodes, extract_node_summary(item, item["remarks"] || ""));
                    }
                }
                return nodes;
            } else if (type(parsed) == "object" && type(parsed["outbounds"]) == "array") {
                const rem = parsed["remarks"] || "";
                for (let o in parsed["outbounds"]) {
                    if (is_proxy_outbound(o)) {
                        push(nodes, extract_node_summary(o, rem));
                    }
                }
                return nodes;
            }
        } catch (e) {
        }
    }

    let uri_text = trimmed;
    if (index(uri_text, "://") == -1) {
        const decoded = decode_base64_str(uri_text);
        if (decoded) {
            uri_text = decoded;
        }
    }
    for (let raw_line in split(replace(uri_text, /\r\n/g, "\n"), "\n")) {
        const line = trim(raw_line);
        if (line == "") {
            continue;
        }
        const node = parse_share_uri(line);
        if (node) {
            push(nodes, node);
        }
    }
    return nodes;
}

function update_one(sub, config) {
    const sub_id = sub[".name"];
    const url = sub["url"];
    const old_cache = load_subscription_cache(sub_id);
    const cache_path = sprintf("%s/%s.json", SUBSCRIPTION_DIR, sub_id);

    if (!url || (substr(url, 0, 7) != "http://" && substr(url, 0, 8) != "https://")) {
        return { id: sub_id, status: "error", nodes: old_cache ? length(old_cache["nodes"] || []) : 0, error: "Invalid subscription URL", changed: false };
    }

    const proxy_id = sub["outbound_proxy"];
    const use_proxy = (proxy_id && proxy_id != "direct" && proxy_id != sub_id && config[proxy_id]);
    if (use_proxy && !access("/var/run/xray.pid")) {
        const err = "Xray must be running to update via Outbound Proxy";
        let err_cache = old_cache || { meta: {}, nodes: [] };
        err_cache["updated_at"] = time();
        err_cache["status"] = "error";
        err_cache["error"] = err;
        writefile(cache_path, sprintf("%.2J", err_cache));
        return { id: sub_id, status: "error", nodes: length(err_cache["nodes"] || []), error: err, changed: false };
    }

    const hdr_tmp = sprintf("/tmp/xray_sub_hdr_%s_%d", sub_id, time());
    const body_tmp = sprintf("/tmp/xray_sub_body_%s_%d", sub_id, time());
    const err_tmp = sprintf("/tmp/xray_sub_err_%s_%d", sub_id, time());
    let cmd = [
        "curl", "-sS", "-L", "--connect-timeout", "10", "--max-time", "30",
        "--stderr", err_tmp,
        "-D", hdr_tmp, "-o", body_tmp,
        "-H", "User-Agent: v2rayN/6.0"
    ];
    if (use_proxy) {
        push(cmd, "-x", sprintf("socks5h://sub_%s:xray@127.0.0.1:%d", sub_id, SUBSCRIPTION_UPDATE_PORT));
    }
    push(cmd, url);

    const rc = system(cmd);
    const raw_headers = readfile(hdr_tmp) || "";
    const raw_body = readfile(body_tmp) || "";
    const raw_err = trim(readfile(err_tmp) || "");
    unlink(hdr_tmp);
    unlink(body_tmp);
    unlink(err_tmp);

    if (rc != 0 || raw_body == "") {
        const err = raw_err != "" ? sprintf("Failed to fetch subscription (curl exit %d): %s", rc, raw_err) : sprintf("Failed to fetch subscription (curl exit %d)", rc);
        let err_cache = old_cache || { meta: {}, nodes: [] };
        err_cache["updated_at"] = time();
        err_cache["status"] = "error";
        err_cache["error"] = err;
        writefile(cache_path, sprintf("%.2J", err_cache));
        return { id: sub_id, status: "error", nodes: length(err_cache["nodes"] || []), error: err, changed: false };
    }

    const meta = parse_headers(raw_headers);
    const nodes = parse_body(raw_body);

    if (length(nodes) == 0) {
        const err = "No valid proxy nodes found in subscription response";
        let err_cache = old_cache || { meta: {}, nodes: [] };
        err_cache["updated_at"] = time();
        err_cache["status"] = "error";
        err_cache["error"] = err;
        writefile(cache_path, sprintf("%.2J", err_cache));
        return { id: sub_id, status: "error", nodes: length(err_cache["nodes"] || []), error: err, changed: false };
    }

    const old_nodes_json = sprintf("%J", old_cache ? (old_cache["nodes"] || []) : []);
    const new_nodes_json = sprintf("%J", nodes);
    const changed = (old_nodes_json != new_nodes_json);

    const new_cache = {
        updated_at: time(),
        status: "ok",
        error: null,
        meta: meta,
        nodes: nodes
    };
    const tmp_cache_path = cache_path + ".tmp";
    writefile(tmp_cache_path, sprintf("%.2J", new_cache));
    rename(tmp_cache_path, cache_path);

    return {
        id: sub_id,
        status: "ok",
        nodes: length(nodes),
        error: null,
        changed: changed
    };
}

function main() {
    let no_reload = false;
    let target_id = null;
    for (let arg in ARGV) {
        if (arg == "--no-reload") {
            no_reload = true;
        } else if (substr(arg, 0, 1) != "-") {
            target_id = arg;
        }
    }

    mkdir("/etc/xray");
    mkdir(SUBSCRIPTION_DIR);
    const config = load_config();
    const subscriptions = filter(values(config), v => v[".type"] == "subscriptions") || [];
    let results = [];
    let any_changed = false;

    for (let sub in subscriptions) {
        if (target_id && sub[".name"] != target_id) {
            continue;
        }
        const res = update_one(sub, config);
        if (res["changed"]) {
            any_changed = true;
        }
        push(results, res);
    }

    if (any_changed && !no_reload && access("/var/run/xray.pid")) {
        system(["/bin/sh", "-c", "/etc/init.d/xray_core reload >/dev/null 2>&1 </dev/null &"]);
    }

    printf("%J\n", { results: results });
}

main();
