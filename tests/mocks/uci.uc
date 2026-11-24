"use strict";

import { readfile } from "fs";

export function cursor() {
    let loaded = {};
    return {
        load: function (pkg) {
            const p = getenv("XRAY_TEST_UCI_JSON");
            if (p) {
                const raw = readfile(p);
                if (raw) {
                    loaded = json(raw);
                }
            }
            return true;
        },
        get_all: function (pkg) {
            if (length(keys(loaded)) == 0) {
                const p = getenv("XRAY_TEST_UCI_JSON");
                if (p) {
                    const raw = readfile(p);
                    if (raw) {
                        loaded = json(raw);
                    }
                }
            }
            return loaded;
        }
    };
};
