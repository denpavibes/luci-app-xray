'use strict';
'require dom';
'require fs';
'require poll';
'require uci';
'require ui';
'require view';
'require view.xray.shared as shared';

function bool_translate(v) {
    if (v === "1") {
        return _("available");
    }
    return _("unavailable");
}

function greater_than_zero(n) {
    if (n < 0) {
        return 0;
    }
    return n;
}

function get_inbound_uci_description(config, key) {
    const ks = key.split(":");
    switch (ks[0]) {
        case "https_inbound": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>https://0.0.0.0:443</strong> }`)]);
        }
        case "http_inbound": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>http://0.0.0.0:${uci.get_first(config, "general", "http_port") || 1081}</strong> }`)]);
        }
        case "socks_inbound": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>socks5://0.0.0.0:${uci.get_first(config, "general", "socks_port") || 1080}</strong> }`)]);
        }
        case "tproxy_tcp_inbound_v4": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_tcp://0.0.0.0:${uci.get_first(config, "general", "tproxy_port_tcp_v4") || 1082}</strong> }`)]);
        }
        case "tproxy_udp_inbound_v4": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_udp://0.0.0.0:${uci.get_first(config, "general", "tproxy_port_udp_v4") || 1084}</strong> }`)]);
        }
        case "tproxy_tcp_inbound_v6": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_tcp://[::]:${uci.get_first(config, "general", "tproxy_port_tcp_v6") || 1083}</strong> }`)]);
        }
        case "tproxy_udp_inbound_v6": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_udp://[::]:${uci.get_first(config, "general", "tproxy_port_udp_v6") || 1085}</strong> }`)]);
        }
        case "tproxy_tcp_inbound_f4": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_tcp://0.0.0.0:${uci.get_first(config, "general", "tproxy_port_tcp_f4") || 1086}</strong> }`)]);
        }
        case "tproxy_udp_inbound_f4": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_udp://0.0.0.0:${uci.get_first(config, "general", "tproxy_port_udp_f4") || 1088}</strong> }`)]);
        }
        case "tproxy_tcp_inbound_f6": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_tcp://[::]:${uci.get_first(config, "general", "tproxy_port_tcp_f6") || 1087}</strong> }`)]);
        }
        case "tproxy_udp_inbound_f6": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>tproxy_udp://[::]:${uci.get_first(config, "general", "tproxy_port_udp_f6") || 1089}</strong> }`)]);
        }
        case "metrics": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>http://0.0.0.0:${uci.get_first(config, "general", "metrics_server_port") || 18888}</strong> }`)]);
        }
        case "api": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>grpc://127.0.0.1:8080</strong> }`)]);
        }
        case "dns_server_inbound": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>dns://0.0.0.0:${ks[1]}</strong> }`)]);
        }
        case "subscription_update_inbound": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>socks5://127.0.0.1:1090</strong> }`)]);
        }
    }
    const uci_key = key.slice(-9);
    const uci_item = uci.get(config, uci_key);
    if (uci_item === null) {
        return key;
    }
    switch (uci_item[".type"]) {
        case "extra_inbound": {
            return E([], [key, " ", shared.badge(`{ listen: <strong>${uci_item["inbound_type"]}://${uci_item["inbound_addr"]}:${uci_item["inbound_port"]}</strong> }`)]);
        }
    }
    return key;
}

function outbound_format(server) {
    if (server["alias"]) {
        return server["alias"];
    }
    if (server["server"].includes(":")) {
        return `${server["transport"]},[${server["server"]}]:${server["server_port"]}`;
    }
    return `${server["transport"]},${server["server"]}:${server["server_port"]}`;
}

function get_outbound_uci_description(config, key) {
    if (!key) {
        return "direct";
    }
    const uci_key = key.slice(-9);
    const uci_item = uci.get(config, uci_key);
    if (uci_item === null) {
        return "direct";
    }
    switch (uci_item[".type"]) {
        case "servers": {
            return outbound_format(uci_item);
        }
        case "extra_inbound": {
            return `${uci_item["inbound_type"]}://${uci_item["inbound_addr"]}:${uci_item["inbound_port"]}`;
        }
        case "manual_tproxy": {
            return `${uci_item["source_addr"]}${uci_item["source_port"] ? ':' + uci_item["source_port"] : ""} -> ${uci_item["dest_addr"] || "</strong><i>original</i><strong>"}${uci_item["dest_port"] !== "0" ? ':' + uci_item["dest_port"] : ""}`;
        }
        case "fakedns": {
            return `${uci_item["fake_dns_domain_names"].length} ${_("domains")}\n${uci_item["fake_dns_domain_names"].join("\n")}`;
        }
    }
    return "direct";
}

function outbound_first_tag_format(tag_split, first_uci_description) {
    let result = [tag_split[0]];

    const first_tag = tag_split[0].split(":");
    if (first_tag.length === 1) {
        return result;
    }

    if (tag_split.length > 1) {
        switch (first_tag[0]) {
            case "extra_inbound": {
                if (tag_split.length < 3) {
                    result.push(" ", shared.badge(`{ listen: <strong>${first_uci_description}</strong> }`));
                } else {
                    result.push(" ", shared.badge(`{ listen <strong>...</strong> }`, first_uci_description));
                }
                break;
            }
            case "force_forward": {
                result.push(" ", shared.badge(`{ force_forward <strong>...</strong> }`, first_uci_description));
                break;
            }
            case "balancer_outbound": {
                if (tag_split.length < 4) {
                    result.push(" ", shared.badge(`{ balancer_outbound <strong>...</strong> }`, first_uci_description));
                }
                break;
            }
            case "fake_dns_tcp":
            case "fake_dns_udp": {
                result.push(" ", shared.badge(`{ fake_dns <strong>...</strong> }`, first_uci_description));
                break;
            }
            case "manual_tproxy": {
                break;
            }
            default: {
                result.push(" ", shared.badge(`{ <strong>...</strong> }`, first_uci_description));
                break;
            }
        }
    } else {
        result.push(" ", shared.badge(`{ <strong>${first_uci_description}</strong> }`, first_tag[0]));
    }
    return result;
}

function outbound_middle_tag_format(tag_split, first_uci_description, current_tag, current_uci_description) {
    switch (current_tag[0]) {
        case "extra_inbound": {
            if (tag_split.length < 3) {
                return shared.badge(`{ listen: <strong>${current_uci_description}</strong> }`, `${current_tag[0]}: ${current_uci_description} (${current_tag[1]})`);
            }
            return shared.badge(`{ listen <strong>...</strong> }`, `${current_tag[0]}: ${current_uci_description} (${current_tag[1]})`);
        }
        case "force_forward": {
            return shared.badge(`{ force_forward <strong>...</strong> }`, `${current_tag[0]}: ${current_uci_description} (${current_tag[1]})`);
        }
        case "balancer_outbound": {
            if (tag_split.length < 4) {
                return shared.badge(`{ balancer_outbound <strong>...</strong> }`, `${current_tag[0]}: ${current_uci_description} (${current_tag[1]})`);
            }
        }
        case "tcp_outbound": {
            if (tag_split.length < 4) {
                return shared.badge(`{ tcp: <strong>${first_uci_description}</strong> }`, current_tag[0]);
            }
            return shared.badge(`{ tcp <strong>...</strong> }`, `tcp: ${first_uci_description}`);
        }
        case "udp_outbound": {
            if (tag_split.length < 4) {
                return shared.badge(`{ udp: <strong>${first_uci_description}</strong> }`, current_tag[0]);
            }
            return shared.badge(`{ udp <strong>...</strong> }`, `udp: ${first_uci_description}`);
        }
        case "fake_dns_tcp":
        case "fake_dns_udp": {
            break;
        }
    }
    return shared.badge(`{ <strong>...</strong> }`, current_uci_description);
}

function outbound_last_tag_format(first_uci_description, last_tag, last_uci_description) {
    if (last_tag[0] === "tcp_outbound") {
        return shared.badge(`{ tcp: <strong>${first_uci_description}</strong> }`);
    } else if (last_tag[0] === "udp_outbound") {
        return shared.badge(`{ udp: <strong>${first_uci_description}</strong> }`);
    }
    return shared.badge(`{ ${last_tag[0]}: <strong>${last_uci_description}</strong> }`, last_tag[1]);
}

function get_outbound_description(config, tag, sub_caches) {
    if (tag && tag.startsWith("subscription_outbound:")) {
        const parts = tag.split(":");
        const sub_id = parts[1];
        const idx = parseInt(parts[2], 10);
        const sub = uci.get(config, sub_id);
        const cache = sub_caches && sub_caches[sub_id];
        const sub_name = (sub && sub.alias) || (cache && cache.meta && cache.meta.title) || sub_id;
        const node = (cache && Array.isArray(cache.nodes) && !isNaN(idx)) ? cache.nodes[idx] : null;
        if (node) {
            const node_label = node.remarks || `${node.protocol},${node.address}:${node.port}`;
            return E([], [
                `${sub_name}: ${node_label} `,
                shared.badge(`{ ${node.protocol}: <strong>${node.address}:${node.port}</strong> }`, `${node.network}/${node.security}`)
            ]);
        }
        return E([], [tag, " ", shared.badge(`{ subscription: <strong>${sub_name}</strong> }`)]);
    }
    const tag_split = tag.split("@");
    const first_uci_description = get_outbound_uci_description(config, tag_split[0].split(":")[1]);

    let result = outbound_first_tag_format(tag_split, first_uci_description);
    for (let i = 1; i < tag_split.length; i++) {
        const current_tag = tag_split[i].split(":");
        const current_uci_description = get_outbound_uci_description(config, current_tag[1]);
        if (i === tag_split.length - 1) {
            result.push(" ", outbound_last_tag_format(first_uci_description, current_tag, current_uci_description));
        } else {
            result.push(" ", outbound_middle_tag_format(tag_split, first_uci_description, current_tag, current_uci_description));
        }
    }
    return result;
}

function observatory(vars, config, sub_caches) {
    if (!vars["observatory"]) {
        return [];
    }
    const now_timestamp = new Date().getTime() / 1000;
    const entries = Object.entries(vars["observatory"]);
    const has_health_ping = entries.some(([_, v]) => v["health_ping"] || v["healthPing"]);
    const is_burst = has_health_ping || (uci.sections(config, "observatory") || []).some(s => s.type === "burstObservatory");

    const titles = has_health_ping ? [
        E('th', { 'class': 'th' }, _('Tag')),
        E('th', { 'class': 'th' }, _('Latency')),
        E('th', { 'class': 'th' }, _('Samples (Loss)')),
        E('th', { 'class': 'th' }, _('Min / Avg / Max')),
        E('th', { 'class': 'th' }, _('Last check')),
    ] : [
        E('th', { 'class': 'th' }, _('Tag')),
        E('th', { 'class': 'th' }, _('Latency')),
        E('th', { 'class': 'th' }, _('Last seen')),
        E('th', { 'class': 'th' }, _('Last check')),
    ];

    return [
        E('h3', is_burst ? _('Outbound Observatory (Burst)') : _('Outbound Observatory')),
        E('div', { 'class': 'cbi-map-descr' }, is_burst ?
            _("Availability and latency of outbound servers are monitored using burst connection probing.") :
            _("Availability of outbound servers are probed every few seconds.")),
        E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, titles),
            ...entries.map((v, index) => {
                const c = v[1];
                const latency = c["alive"] ? (c["delay"] + ' ' + _("ms")) : _("<i>unreachable</i>");
                if (has_health_ping) {
                    const hp = c["health_ping"] || c["healthPing"];
                    const samples = (hp && hp.all) ?
                        `${hp.all - (hp.fail || 0)}/${hp.all} (${Math.round(((hp.fail || 0) / hp.all) * 100)}% loss)` : '-';
                    const min_avg_max = (hp && hp.min !== undefined && hp.average !== undefined && hp.max !== undefined) ?
                        `${Math.round(hp.min / 1000000)} / ${Math.round(hp.average / 1000000)} / ${Math.round(hp.max / 1000000)} ms` : '-';
                    const last_check = (c["last_try_time"] && c["last_try_time"] > 0) ?
                        ('%d'.format(greater_than_zero(now_timestamp - c["last_try_time"])) + _('s ago')) :
                        _("<i>active</i>");

                    return E('tr', { 'class': `tr cbi-rowstyle-${index % 2 + 1}` }, [
                        E('td', { 'class': 'td' }, get_outbound_description(config, v[0], sub_caches)),
                        E('td', { 'class': 'td' }, latency),
                        E('td', { 'class': 'td' }, samples),
                        E('td', { 'class': 'td' }, min_avg_max),
                        E('td', { 'class': 'td' }, last_check),
                    ]);
                } else {
                    const last_seen = (c["last_seen_time"] && c["last_seen_time"] > 0) ?
                        ('%d'.format(greater_than_zero(now_timestamp - c["last_seen_time"])) + _('s ago')) :
                        _("<i>never</i>");
                    const last_check = (c["last_try_time"] && c["last_try_time"] > 0) ?
                        ('%d'.format(greater_than_zero(now_timestamp - c["last_try_time"])) + _('s ago')) :
                        _("<i>never</i>");

                    return E('tr', { 'class': `tr cbi-rowstyle-${index % 2 + 1}` }, [
                        E('td', { 'class': 'td' }, get_outbound_description(config, v[0], sub_caches)),
                        E('td', { 'class': 'td' }, latency),
                        E('td', { 'class': 'td' }, last_seen),
                        E('td', { 'class': 'td' }, last_check),
                    ]);
                }
            })
        ])
    ];
};

function outbound_stats(vars, config, sub_caches) {
    if (!vars["stats"]) {
        return [];
    }
    if (!vars["stats"]["outbound"]) {
        return [];
    }
    return [
        E('h3', _('Outbound Statistics')),
        E('div', { 'class': 'cbi-map-descr' }, _("Data transferred for outbounds since Xray start.")),
        E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('Tag')),
                E('th', { 'class': 'th' }, _('Downlink')),
                E('th', { 'class': 'th' }, _('Uplink')),
            ]), ...Object.entries(vars["stats"]["outbound"]).map((v, index, arr) => E('tr', { 'class': `tr cbi-rowstyle-${index % 2 + 1}` }, [
                E('td', { 'class': 'td' }, get_outbound_description(config, v[0], sub_caches)),
                E('td', { 'class': 'td' }, '%1024.2mB'.format(v[1]["downlink"])),
                E('td', { 'class': 'td' }, '%1024.2mB'.format(v[1]["uplink"])),
            ]))
        ])
    ];
};

function inbound_stats(vars, config) {
    if (!vars["stats"]) {
        return [];
    }
    if (!vars["stats"]["inbound"]) {
        return [];
    }
    return [
        E('h3', _('Inbound Statistics')),
        E('div', { 'class': 'cbi-map-descr' }, _("Data transferred for inbounds since Xray start.")),
        E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('Tag')),
                E('th', { 'class': 'th' }, _('Downlink')),
                E('th', { 'class': 'th' }, _('Uplink')),
            ]), ...Object.entries(vars["stats"]["inbound"]).map((v, index, arr) => E('tr', { 'class': `tr cbi-rowstyle-${index % 2 + 1}` }, [
                E('td', { 'class': 'td' }, get_inbound_uci_description(config, v[0])),
                E('td', { 'class': 'td' }, '%1024.2mB'.format(v[1]["downlink"])),
                E('td', { 'class': 'td' }, '%1024.2mB'.format(v[1]["uplink"])),
            ]))
        ])
    ];
};

function subscriptions_tab(vars, config, sub_caches) {
    const subs = uci.sections(config, "subscriptions") || [];
    if (subs.length === 0) {
        return [
            E('h3', _('Subscriptions')),
            E('div', { 'class': 'cbi-map-descr' }, _("No subscriptions configured."))
        ];
    }
    let blocks = [
        E('h3', _('Subscriptions')),
        E('div', { 'class': 'cbi-map-descr' }, _("Subscription metadata, traffic usage, and parsed node list."))
    ];
    for (const s of subs) {
        const sub_id = s[".name"];
        const cache = sub_caches && sub_caches[sub_id];
        const meta = (cache && cache.meta) ? cache.meta : {};
        const title = s.alias || meta.title || s.url || sub_id;
        const header_links = [];
        if (meta.web_page_url && (meta.web_page_url.startsWith("https://") || meta.web_page_url.startsWith("http://"))) {
            header_links.push(" ", E('a', { 'href': meta.web_page_url, 'target': '_blank', 'rel': 'noopener' }, `[${_('Website')}]`));
        }
        if (meta.support_url && (meta.support_url.startsWith("https://") || meta.support_url.startsWith("http://"))) {
            header_links.push(" ", E('a', { 'href': meta.support_url, 'target': '_blank', 'rel': 'noopener' }, `[${_('Support')}]`));
        }
        blocks.push(E('h4', {}, [title, ...header_links]));

        if (meta.announce) {
            blocks.push(E('p', { 'class': 'cbi-map-descr' }, meta.announce));
        }

        const upload_str = meta.upload !== undefined ? '%1024.2mB'.format(meta.upload) : '-';
        const download_str = meta.download !== undefined ? '%1024.2mB'.format(meta.download) : '-';
        const total_str = meta.total !== undefined ? (meta.total > 0 ? '%1024.2mB'.format(meta.total) : _('Unlimited')) : '-';
        const refill_str = (meta.refill_date && meta.refill_date > 0) ? new Date(meta.refill_date * 1000).toLocaleString() : '-';
        const expire_str = (meta.expire && meta.expire > 0) ? new Date(meta.expire * 1000).toLocaleString() : '-';
        const updated_str = (cache && cache.updated_at) ? new Date(cache.updated_at * 1000).toLocaleString() : _('Never');
        const status_badge = (cache && cache.status === 'error')
            ? E([], [updated_str, " ", shared.badge(_('Error'), cache.error || _('Update failed'))])
            : updated_str;

        blocks.push(E('table', { 'class': 'table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, _('Upload')),
                E('th', { 'class': 'th' }, _('Download')),
                E('th', { 'class': 'th' }, _('Total')),
                E('th', { 'class': 'th' }, _('Refill Date')),
                E('th', { 'class': 'th' }, _('Expire Date')),
                E('th', { 'class': 'th' }, _('Last Updated')),
            ]),
            E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
                E('td', { 'class': 'td' }, upload_str),
                E('td', { 'class': 'td' }, download_str),
                E('td', { 'class': 'td' }, total_str),
                E('td', { 'class': 'td' }, refill_str),
                E('td', { 'class': 'td' }, expire_str),
                E('td', { 'class': 'td' }, status_badge),
            ])
        ]));

        const nodes = (cache && Array.isArray(cache.nodes)) ? cache.nodes : [];
        if (nodes.length > 0) {
            const obs_map = (vars && vars["observatory"]) ? vars["observatory"] : {};
            blocks.push(E('table', { 'class': 'table' }, [
                E('tr', { 'class': 'tr table-titles' }, [
                    E('th', { 'class': 'th' }, '#'),
                    E('th', { 'class': 'th' }, _('Remarks')),
                    E('th', { 'class': 'th' }, _('Protocol')),
                    E('th', { 'class': 'th' }, _('Server')),
                    E('th', { 'class': 'th' }, _('Latency')),
                ]),
                ...nodes.map((n, idx) => {
                    const ob_tag = `subscription_outbound:${sub_id}:${idx}`;
                    const ob_stat = obs_map[ob_tag];
                    let lat = '-';
                    if (ob_stat) {
                        lat = ob_stat["alive"] ? `${ob_stat["delay"]} ${_("ms")}` : _("<i>unreachable</i>");
                    }
                    return E('tr', { 'class': `tr cbi-rowstyle-${idx % 2 + 1}` }, [
                        E('td', { 'class': 'td' }, String(idx + 1)),
                        E('td', { 'class': 'td' }, n.remarks || '-'),
                        E('td', { 'class': 'td' }, `${n.protocol} / ${n.network} / ${n.security}`),
                        E('td', { 'class': 'td' }, n.address ? `${n.address}:${n.port}` : '-'),
                        E('td', { 'class': 'td' }, lat),
                    ]);
                })
            ]));
        } else {
            blocks.push(E('p', { 'class': 'cbi-map-descr' }, E('i', _('No cached nodes available.'))));
        }
    }
    return blocks;
}

return view.extend({
    load: function () {
        return Promise.all([
            uci.load(shared.variant),
            fs.read("/usr/share/xray/version.txt"),
            fs.list("/etc/xray/subscriptions").catch(function () { return []; })
        ]).then(function (results) {
            const sub_files = (results[2] || []).filter(f => f.name && f.name.endsWith(".json"));
            return Promise.all(sub_files.map(f =>
                fs.read("/etc/xray/subscriptions/" + f.name).then(function (content) {
                    return [f.name.slice(0, -5), JSON.parse(content)];
                }).catch(function () {
                    return [f.name.slice(0, -5), null];
                })
            )).then(function (entries) {
                let sub_caches = {};
                for (const entry of entries) {
                    if (entry[1]) {
                        sub_caches[entry[0]] = entry[1];
                    }
                }
                results[2] = sub_caches;
                return results;
            });
        });
    },

    render: function (load_result) {
        const config = load_result[0];
        const sub_caches = load_result[2] || {};
        if (uci.get_first(config, "general", "metrics_server_enable") !== "1") {
            return E([], [
                E('h2', _('Xray (status)')),
                E('p', { 'class': 'cbi-map-descr' }, _("Xray metrics server not enabled. Enable Xray metrics server to see details."))
            ]);
        }
        const version = load_result[1].split(" ");
        const stats_available = bool_translate(uci.get_first(config, "general", "stats"));
        const observatory_sections = uci.sections(config, "observatory") || [];
        let observatory_available = bool_translate(null);
        if (observatory_sections.length > 0) {
            const obs_type = observatory_sections[0].type || "observatory";
            observatory_available = obs_type === "burstObservatory" ? _("available (burst)") : _("available");
        } else if (uci.get_first(config, "general", "observatory") === "1") {
            observatory_available = _("available");
        }
        const info = E('p', { 'class': 'cbi-map-descr' }, `${version[0]} Version ${version[1]} (${version[2]}) Built ${new Date(version[3] * 1000).toLocaleString()}. Statistics: ${stats_available}. Observatory: ${observatory_available}.`);
        const detail = E('div', {});
        poll.add(function () {
            fs.exec_direct("/usr/bin/wget", ["-O", "-", `http://127.0.0.1:${uci.get_first(config, "general", "metrics_server_port") || 18888}/debug/vars`], "json").then(function (vars) {
                const result = E([], [
                    E('div', {}, [
                        E('div', { 'class': 'cbi-section', 'data-tab': 'observatory', 'data-tab-title': _('Observatory') }, observatory(vars, config, sub_caches)),
                        E('div', { 'class': 'cbi-section', 'data-tab': 'outbounds', 'data-tab-title': _('Outbounds') }, outbound_stats(vars, config, sub_caches)),
                        E('div', { 'class': 'cbi-section', 'data-tab': 'inbounds', 'data-tab-title': _('Inbounds') }, inbound_stats(vars, config)),
                        E('div', { 'class': 'cbi-section', 'data-tab': 'subscriptions', 'data-tab-title': _('Subscriptions') }, subscriptions_tab(vars, config, sub_caches))
                    ])
                ]);
                ui.tabs.initTabGroup(result.lastElementChild.childNodes);
                dom.content(detail, result);
            });
        });

        return E([], [
            E('h2', _('Xray (status)')),
            info,
            detail
        ]);
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
