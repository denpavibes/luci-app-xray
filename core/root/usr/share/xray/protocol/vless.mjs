"use strict";

import { port_array, stream_settings } from "../common/stream.mjs";
import { fallbacks, reality_inbound_settings, tls_inbound_settings } from "../common/tls.mjs";

function vless_inbound_user(k, flow) {
    return {
        id: k,
        email: k,
        flow: flow,
    };
}

export function vless_outbound(server, tag) {
    let flow = null;
    if (server["vless_tls"] == "tls") {
        flow = server["vless_flow_tls"];
    } else if (server["vless_tls"] == "reality") {
        flow = server["vless_flow_reality"];
    }
    if (flow == "none") {
        flow = null;
    }
    const stream_settings_object = stream_settings(server, "vless", tag);
    const stream_settings_result = stream_settings_object["stream_settings"];
    const dialer_proxy = stream_settings_object["dialer_proxy"];

    let user = {
        email: server["username"],
        id: server["password"],
        flow: flow,
        encryption: server["vless_encryption"] || "none"
    };

    let testpre = null;
    let testseed = null;

    if (flow == "xtls-rprx-vision" || flow == "xtls-rprx-vision-udp443") {
        if (server["vless_testseed"] != null) {
            let parsed_testseed = [];
            if (type(server["vless_testseed"]) === "array") {
                parsed_testseed = map(filter(server["vless_testseed"], v => v != null && v !== ""), v => int(v));
            } else if (server["vless_testseed"] !== "") {
                let s = replace(replace(server["vless_testseed"], "[", ""), "]", "");
                let parts = split(replace(s, " ", ","), ",");
                parsed_testseed = map(filter(parts, v => length(trim(v)) > 0), v => int(trim(v)));
            }
            if (length(parsed_testseed) === 4) {
                testseed = parsed_testseed;
            }
        }
        if (server["vless_testpre"] != null && server["vless_testpre"] !== "") {
            testpre = int(server["vless_testpre"]);
        }
    }

    let outbound_settings = {
        vnext: map(port_array(server["server_port"]), function (v) {
            return {
                address: server["server"],
                port: v,
                users: [
                    user
                ]
            };
        })
    };

    if (testpre != null) {
        outbound_settings["testpre"] = testpre;
    }
    if (testseed != null) {
        outbound_settings["testseed"] = testseed;
    }

    return {
        outbound: {
            protocol: "vless",
            tag: tag,
            settings: outbound_settings,
            streamSettings: stream_settings_result
        },
        dialer_proxy: dialer_proxy
    };
};

export function https_vless_inbound(proxy, config) {
    let flow = null;
    if (proxy["vless_tls"] == "tls") {
        flow = proxy["vless_flow_tls"];
    } else if (proxy["vless_tls"] == "reality") {
        flow = proxy["vless_flow_reality"];
    }
    if (flow == "none") {
        flow = null;
    }
    return {
        port: proxy["web_server_port"] || 443,
        protocol: "vless",
        tag: "https_inbound",
        settings: {
            clients: map(proxy["web_server_password"], k => vless_inbound_user(k, flow)),
            decryption: proxy["vless_decryption"] || "none",
            fallbacks: fallbacks(proxy, config)
        },
        streamSettings: {
            network: "tcp",
            security: proxy["vless_tls"],
            tlsSettings: proxy["vless_tls"] == "tls" ? tls_inbound_settings(proxy, "vless") : null,
            realitySettings: proxy["vless_tls"] == "reality" ? reality_inbound_settings(proxy, "vless") : null,
        }
    };
};
