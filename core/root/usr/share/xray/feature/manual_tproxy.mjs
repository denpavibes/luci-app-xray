"use strict";

import { server_outbound } from "./outbound.mjs";
import { load_subscription_cache } from "./subscription.mjs";

function manual_tproxy_redirect(v) {
    return sprintf("%s:%d", v["dest_addr"] || "", v["dest_port"] || 0);
}

function manual_tproxy_outbound_tag(v, name) {
    return `manual_tproxy:${v[".name"]}@${name}`;
}

function manual_tproxy_force_forward_tag(v, name, force_forward_key, server_key) {
    if (v[force_forward_key] !== "1" || v[server_key] == null) {
        return null;
    }
    return `manual_tproxy:${v[".name"]}@${name}@force_forward:${v[server_key]}`;
}

function manual_tproxy_needs_dialer_proxy(v, force_forward_key, server_key) {
    if (v[force_forward_key] !== "1") {
        return true;
    }
    if (v[server_key] == null) {
        return true;
    }
    if (manual_tproxy_redirect(v) !== ":0") {
        return true;
    }
    return false;
}

function manual_tproxy_is_subscription(config, v, force_forward_key, server_key) {
    if (v[force_forward_key] !== "1" || v[server_key] == null) {
        return false;
    }
    return config && config[v[server_key]] && config[v[server_key]][".type"] == "subscriptions";
}

function manual_tproxy_outbound(config, v, name, force_forward_key, server_key) {
    const is_sub = manual_tproxy_is_subscription(config, v, force_forward_key, server_key);
    const force_forward_tag = manual_tproxy_force_forward_tag(v, name, force_forward_key, server_key);
    let result = [];
    if (force_forward_tag != null && !is_sub) {
        push(result, ...server_outbound(config[v[server_key]], force_forward_tag, config));
    }
    if (manual_tproxy_needs_dialer_proxy(v, force_forward_key, server_key)) {
        let dp = force_forward_tag != null ? force_forward_tag : "direct";
        if (is_sub) {
            const cache = load_subscription_cache(v[server_key]);
            if (cache && length(cache["nodes"] || []) > 0) {
                dp = sprintf("subscription_outbound:%s:0", v[server_key]);
            } else {
                dp = "direct";
            }
        }
        push(result, {
            protocol: "freedom",
            tag: manual_tproxy_outbound_tag(v, name),
            settings: {
                redirect: manual_tproxy_redirect(v),
                domainStrategy: "AsIs"
            },
            streamSettings: {
                sockOpt: {
                    dialerProxy: dp
                }
            }
        });
    }
    return result;
}

function manual_tproxy_rule_target(config, v, name, force_forward_key, server_key) {
    if (manual_tproxy_needs_dialer_proxy(v, force_forward_key, server_key)) {
        return { outboundTag: manual_tproxy_outbound_tag(v, name) };
    }
    if (manual_tproxy_is_subscription(config, v, force_forward_key, server_key)) {
        return { balancerTag: sprintf("subscription_balancer:%s", v[server_key]) };
    }
    return { outboundTag: manual_tproxy_force_forward_tag(v, name, force_forward_key, server_key) };
}

export function manual_tproxy_outbounds(config, manual_tproxy) {
    let result = [];
    for (let v in manual_tproxy) {
        push(result, ...manual_tproxy_outbound(config, v, "tcp_outbound", "force_forward_tcp", "force_forward_server_tcp"));
        push(result, ...manual_tproxy_outbound(config, v, "udp_outbound", "force_forward_udp", "force_forward_server_udp"));
    }
    return result;
};

export function manual_tproxy_outbound_tags(manual_tproxy) {
    let result = [];
    for (let v in manual_tproxy) {
        const tcp_tag = manual_tproxy_force_forward_tag(v, "tcp_outbound", "force_forward_tcp", "force_forward_server_tcp");
        if (tcp_tag != null) {
            push(result, tcp_tag);
        }
        const udp_tag = manual_tproxy_force_forward_tag(v, "udp_outbound", "force_forward_udp", "force_forward_server_udp");
        if (udp_tag != null) {
            push(result, udp_tag);
        }
    }
    return result;
};

export function manual_tproxy_rules(manual_tproxy, config) {
    let result = [];
    for (let v in manual_tproxy) {
        const tcp_target = manual_tproxy_rule_target(config, v, "tcp_outbound", "force_forward_tcp", "force_forward_server_tcp");
        const udp_target = manual_tproxy_rule_target(config, v, "udp_outbound", "force_forward_udp", "force_forward_server_udp");
        splice(result, 0, 0, {
            type: "field",
            inboundTag: ["tproxy_tcp_inbound_v4", "tproxy_tcp_inbound_v6", "socks_inbound", "https_inbound", "http_inbound"],
            ip: [v["source_addr"]],
            port: v["source_port"],
            outboundTag: tcp_target["outboundTag"],
            balancerTag: tcp_target["balancerTag"]
        });
        splice(result, 0, 0, {
            type: "field",
            inboundTag: ["tproxy_udp_inbound_v4", "tproxy_udp_inbound_v6"],
            ip: [v["source_addr"]],
            port: v["source_port"],
            outboundTag: udp_target["outboundTag"],
            balancerTag: udp_target["balancerTag"]
        });
    }
    return result;
};
