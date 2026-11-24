#!/usr/bin/ucode
"use strict";

import { access, mkdir, readfile, rename, unlink, writefile } from "fs";
import { load_config } from "./common/config.mjs";
import {
    SUBSCRIPTION_DIR,
    SUBSCRIPTION_UPDATE_PORT,
    load_subscription_cache,
    parse_subscription_body,
    parse_subscription_headers
} from "./feature/subscription.mjs";

function ensure_parent_dir(dir) {
    if (dir == "/etc/xray/subscriptions") {
        mkdir("/etc/xray");
    }
    mkdir(dir);
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

    const meta = parse_subscription_headers(raw_headers);
    const nodes = parse_subscription_body(raw_body);

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

    ensure_parent_dir(SUBSCRIPTION_DIR);
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
