"use strict";

import { server_outbound } from "./outbound.mjs";

export function bridges(bridge) {
    let result = [];
    for (let v in bridge) {
        push(result, {
            tag: sprintf("bridge_inbound:%s", v[".name"]),
            domain: v["domain"]
        });
    }
    return result;
};

export function bridge_outbounds(config, bridge) {
    let result = [];
    for (let v in bridge) {
        const bridge_server = config[v["upstream"]];
        push(result, {
            tag: sprintf("bridge_freedom_outbound:%s", v[".name"]),
            protocol: "freedom",
            settings: {
                redirect: v["redirect"]
            }
        });
        if (!bridge_server || bridge_server[".type"] != "subscriptions") {
            push(result, ...server_outbound(bridge_server, sprintf("bridge_upstream_outbound:%s", v[".name"]), config));
        }
    }
    return result;
};

export function bridge_rules(bridge, config) {
    let result = [];
    for (let v in bridge) {
        const upstream_id = v["upstream"];
        let upstream_rule = {
            type: "field",
            inboundTag: [sprintf("bridge_inbound:%s", v[".name"])],
            domain: [sprintf("full:%s", v["domain"])],
        };
        if (config && config[upstream_id] && config[upstream_id][".type"] == "subscriptions") {
            upstream_rule["balancerTag"] = sprintf("subscription_balancer:%s", upstream_id);
        } else {
            upstream_rule["outboundTag"] = sprintf("bridge_upstream_outbound:%s", v[".name"]);
        }
        push(result, upstream_rule, {
            type: "field",
            inboundTag: [sprintf("bridge_inbound:%s", v[".name"])],
            outboundTag: sprintf("bridge_freedom_outbound:%s", v[".name"])
        });
    }
    return result;
};
