FROM mcr.microsoft.com/devcontainers/base:bookworm

ARG TARGETARCH

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        git \
        jq \
        libjson-c-dev \
        pkg-config \
        shellcheck \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# Build standalone ucode + utpl symlink from upstream jow-/ucode
RUN git clone --depth 1 https://github.com/jow-/ucode.git /tmp/ucode \
    && mkdir -p /tmp/ucode/build \
    && cd /tmp/ucode/build \
    && cmake \
        -DCMAKE_INSTALL_PREFIX=/usr \
        -DUCI_SUPPORT=OFF \
        -DUBUS_SUPPORT=OFF \
        -DULOOP_SUPPORT=OFF \
        -DNL80211_SUPPORT=OFF \
        -DRTNL_SUPPORT=OFF \
        .. \
    && make -j"$(nproc)" \
    && make install \
    && ln -sf /usr/bin/ucode /usr/bin/utpl \
    && rm -rf /tmp/ucode

# Install Xray-core + geodata assets for xray run -test config validation
RUN case "${TARGETARCH}" in \
        amd64) XRAY_ZIP="Xray-linux-64.zip" ;; \
        arm64) XRAY_ZIP="Xray-linux-arm64-v8a.zip" ;; \
        *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL -L -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/latest/download/${XRAY_ZIP}" \
    && mkdir -p /usr/share/xray \
    && unzip -q /tmp/xray.zip -d /tmp/xray \
    && install -m 0755 /tmp/xray/xray /usr/local/bin/xray \
    && ln -sf /usr/local/bin/xray /usr/bin/xray \
    && install -m 0644 /tmp/xray/geoip.dat /usr/share/xray/geoip.dat \
    && install -m 0644 /tmp/xray/geosite.dat /usr/share/xray/geosite.dat \
    && rm -rf /tmp/xray /tmp/xray.zip
