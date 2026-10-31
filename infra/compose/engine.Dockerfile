FROM rust:1.90-slim-bookworm@sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9 AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY apps/engine apps/engine
RUN cargo build --release --locked -p blackbox-engine
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
COPY --from=build /src/target/release/blackbox-engine /usr/local/bin/blackbox-engine
USER node
CMD ["blackbox-engine"]
