# syntax=docker/dockerfile:1.7
FROM rust:1.90-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
COPY apps/engine ./apps/engine
RUN cargo build --release -p bbx-engine && strip target/release/bbx-engine

FROM debian:bookworm-slim AS runtime
ARG SERVICE_VERSION=0.1.0-dev
ENV SERVICE_VERSION=$SERVICE_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 blackbox && useradd -u 10001 -g blackbox -d /app -s /usr/sbin/nologin blackbox && mkdir -p /var/blackbox/data/engine /var/blackbox/logs && chown -R blackbox:blackbox /var/blackbox
COPY --from=build /src/target/release/bbx-engine /usr/local/bin/bbx-engine
USER blackbox
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bbx-engine"]
