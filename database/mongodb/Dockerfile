FROM mongo:8.0

ARG TAILSCALE_VERSION=1.92.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        iproute2 \
        iptables \
        procps \
    && curl -fsSL \
        "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_amd64.tgz" \
        -o /tmp/tailscale.tgz \
    && tar -xzf /tmp/tailscale.tgz -C /tmp \
    && install -m 0755 /tmp/tailscale_${TAILSCALE_VERSION}_amd64/tailscale /usr/local/bin/tailscale \
    && install -m 0755 /tmp/tailscale_${TAILSCALE_VERSION}_amd64/tailscaled /usr/local/bin/tailscaled \
    && rm -rf /var/lib/apt/lists/* /tmp/tailscale*

COPY docker-entrypoint.sh /usr/local/bin/mongodb-tailscale-entrypoint

RUN chmod 0755 /usr/local/bin/mongodb-tailscale-entrypoint \
    && mkdir -p /var/lib/tailscale /var/run/tailscale

ENTRYPOINT ["/usr/local/bin/mongodb-tailscale-entrypoint"]

CMD ["mongod", "--bind_ip_all", "--auth"]