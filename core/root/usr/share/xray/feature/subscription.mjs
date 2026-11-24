"use strict";

import { readfile } from "fs";

export const SUBSCRIPTION_DIR = "/etc/xray/subscriptions";
export const SUBSCRIPTION_UPDATE_PORT = 1090;
const outbound_mark = 253;

function clone_deep(val) {
    if (type(val) == "array") {
        return map(val, v => clone_deep(v));
    }
    if (type(val) == "object") {
        let copy = {};
        for (let k in keys(val)) {
            copy[k] = clone_deep(val[k]);
        }
        return copy;
    }
    return val;
}

export function load_subscription_cache(sub_id) {
    if (!sub_id) {
        return null;
    }
    const raw = readfile(sprintf("%s/%s.json", SUBSCRIPTION_DIR, sub_id));
    if (!raw) {
        return null;
    }
    try {
        const parsed = json(raw);
        if (type(parsed) == "object") {
            return parsed;
        }
    } catch (e) {
    }
    return null;
};

export function subscription_outbounds(sub_id) {
    const cache = load_subscription_cache(sub_id);
    if (!cache || type(cache["nodes"]) != "array") {
        return [];
    }
    let result = [];
    for (let idx = 0; idx < length(cache["nodes"]); idx++) {
        const node = cache["nodes"][idx];
        if (type(node) != "object" || type(node["outbound"]) != "object") {
            continue;
        }
        let outbound = clone_deep(node["outbound"]);
        outbound["tag"] = sprintf("subscription_outbound:%s:%d", sub_id, idx);
        if (type(outbound["streamSettings"]) != "object") {
            outbound["streamSettings"] = {};
        }
        if (type(outbound["streamSettings"]["sockopt"]) != "object") {
            outbound["streamSettings"]["sockopt"] = {};
        }
        outbound["streamSettings"]["sockopt"]["mark"] = outbound_mark;
        push(result, outbound);
    }
    return result;
};

export function subscription_balancer(sub) {
    const sub_id = sub[".name"];
    const cache = load_subscription_cache(sub_id);
    const has_nodes = cache && type(cache["nodes"]) == "array" && length(cache["nodes"]) > 0;
    return {
        tag: sprintf("subscription_balancer:%s", sub_id),
        selector: has_nodes ? [sprintf("subscription_outbound:%s:", sub_id)] : ["direct"],
        strategy: {
            type: sub["balancer_strategy"] || "random"
        }
    };
};

export function subscription_update_inbound(subscriptions, config) {
    let accounts = [];
    for (let s in subscriptions) {
        const proxy_id = s["outbound_proxy"];
        if (proxy_id && proxy_id != "direct" && proxy_id != s[".name"] && config[proxy_id]) {
            push(accounts, {
                user: sprintf("sub_%s", s[".name"]),
                pass: "xray"
            });
        }
    }
    if (length(accounts) == 0) {
        return [];
    }
    return [
        {
            listen: "127.0.0.1",
            port: SUBSCRIPTION_UPDATE_PORT,
            protocol: "socks",
            tag: "subscription_update_inbound",
            settings: {
                auth: "password",
                accounts: accounts,
                udp: false
            }
        }
    ];
};

export function subscription_update_rules(subscriptions, config) {
    let result = [];
    for (let s in subscriptions) {
        const proxy_id = s["outbound_proxy"];
        if (!proxy_id || proxy_id == "direct" || proxy_id == s[".name"] || !config[proxy_id]) {
            continue;
        }
        let rule = {
            type: "field",
            inboundTag: ["subscription_update_inbound"],
            user: [sprintf("sub_%s", s[".name"])]
        };
        if (config[proxy_id][".type"] == "subscriptions") {
            rule["balancerTag"] = sprintf("subscription_balancer:%s", proxy_id);
        } else {
            rule["outboundTag"] = sprintf("balancer_outbound:%s", proxy_id);
        }
        push(result, rule);
    }
    return result;
};
